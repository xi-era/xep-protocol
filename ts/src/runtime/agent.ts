/**
 * XepAgent — XEP 运行时。
 * 职责：收发 Envelope、能力握手与裁剪、ACL/签名校验、Goal 状态机驱动、
 * 断网 suspended/恢复续跑、Trace 因果链记录。
 * 不做：调度（本地逻辑）、持久化（实现选择）、共识仲裁（上层业务）。
 */
import { Envelope, XEP_VERSION, KNOWN_KINDS, decodeEnvelope, encodeEnvelope, checkVersion } from '../envelope.js';
import { XepError, XepErrorCode, XepErrorPayload } from '../errors.js';
import { Capability, aclAllowsFactAbout, aclAllowsGoal, canSendKind, hasCapability } from '../models/capability.js';
import { Goal, GoalTransitionEvent } from '../models/goal.js';
import { Fact } from '../models/fact.js';
import { TraceEvent, TraceHeader, traceHeaderToEvent } from '../models/trace.js';
import { Signer, NoopSigner, canonicalEnvelopeBytes } from '../security/signer.js';
import { AcpMessageShape, LinkState, XepTransport, makeAcpMessage } from '../transport/types.js';
import { FactLedger } from './fact-ledger.js';
import { GoalStore } from './goal-store.js';

let eventCounter = 0;
function genEventId(prefix: string): string {
  eventCounter += 1;
  return `${prefix}-${eventCounter.toString(16).padStart(6, '0')}`;
}

export interface AgentOptions {
  agentId: string;
  capability: Capability;
  transport: XepTransport;
  /** 默认 NoopSigner（Level-0）。Level-2 必须注入真实 Signer */
  signer?: Signer;
  clock?: () => number;
}

export type AgentEventType = 'goal-state' | 'fact' | 'trace' | 'error-sent' | 'peer-hello' | 'link';

export interface AgentEvent {
  type: AgentEventType;
  /** goal-state: 目标状态变化；fact: 新事实入账；error-sent: 发出的业务错误；link: 链路变化 */
  goal?: Goal;
  fact?: Fact;
  error?: XepErrorPayload;
  trace?: TraceEvent;
  link?: LinkState;
  peer?: Capability;
  detail?: string;
}

export type GoalExecutor = (goal: Goal, agent: XepAgent) => void | Promise<void>;

export class XepAgent {
  readonly agentId: string;
  readonly capability: Capability;
  readonly goalStore: GoalStore;
  readonly ledger: FactLedger;

  private readonly transport: XepTransport;
  private readonly signer: Signer;
  private readonly clock: () => number;
  private readonly peers = new Map<string, Capability>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();
  private readonly executors = new Set<GoalExecutor>();
  /** 本地为每条 trace 记录最后产生的事件 ID，作为下一条事件的 parent */
  private readonly lastEventByTrace = new Map<string, string>();
  private readonly traces: TraceEvent[] = [];
  /** 我方视角下因链路断开而挂起的目标（goal_id → suspend 起点） */
  private readonly suspendedAt = new Map<string, number>();
  /** 接收的目标的原发起方（goal_id → from），用于执行方回报状态 */
  private readonly goalOrigin = new Map<string, string>();
  private started = false;

  constructor(opts: AgentOptions) {
    this.agentId = opts.agentId;
    this.capability = opts.capability;
    this.transport = opts.transport;
    this.signer = opts.signer ?? new NoopSigner();
    this.clock = opts.clock ?? Date.now;
    this.goalStore = new GoalStore();
    this.ledger = new FactLedger();
  }

  /* ------------------------------- 生命周期 ------------------------------- */

  start(): void {
    if (this.started) return;
    this.started = true;
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onLinkStateChange?.((state) => this.onLinkState(state));
  }

  /** 能力握手（XEP-03 §3）：连接建立后向对端首发 */
  sendHello(to: string): void {
    this.send(to, 'capability.hello', {
      agent_id: this.agentId,
      level: this.capability.level,
      xep_versions: this.capability.xep_versions ?? [XEP_VERSION],
      mask: this.capability.mask,
      ...(this.capability.acl ? { acl: this.capability.acl } : {}),
    });
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 注册目标执行器（业务逻辑）；协议层不定义「该交给谁跑」 */
  onGoal(executor: GoalExecutor): void {
    this.executors.add(executor);
  }

  get traceLog(): readonly TraceEvent[] {
    return this.traces;
  }

  peerOf(agentId: string): Capability | undefined {
    return this.peers.get(agentId);
  }

  /* --------------------------------- 发送 --------------------------------- */

  /** 下发 Goal（发起方） */
  async proposeGoal(to: string, goal: Goal): Promise<void> {
    // 发送方裁剪：对方无 offline_suspend 能力，提前告知调用方断网即 failed（XEP-06 §1.2 规则 5）
    const peer = this.peers.get(to);
    if (!canSendKind('goal.propose', peer)) {
      throw new XepError(XepErrorCode.GOAL_REJECTED, `peer ${to} lacks goal_basic capability`, { goalId: goal.goal_id });
    }
    const stored = { ...goal, state: goal.state ?? 'pending' };
    this.goalStore.upsert(stored);
    this.emitTrace('goal-create', this.header(stored.goal_id), { goal_id: stored.goal_id });
    await this.send(to, 'goal.propose', stored as unknown as Record<string, unknown>);
  }

  async cancelGoal(to: string, goalId: string, reason?: string): Promise<void> {
    const goal = this.goalStore.transition(goalId, 'cancel', this.clock());
    if (goal) {
      this.emitTrace('goal-cancel', this.header(goalId, true), { goal_id: goalId, reason });
      this.emit({ type: 'goal-state', goal });
    }
    await this.send(to, 'goal.cancel', { goal_id: goalId, reason });
  }

  /**
   * 执行方驱动本地状态流转，并回报给原发起方（若有）。
   * 例：completeGoal('g-1') → 本地 completed + 向发起方发 goal.update。
   */
  async updateGoalState(goalId: string, event: GoalTransitionEvent, progress?: Record<string, unknown>): Promise<Goal | null> {
    const goal = this.goalStore.transition(goalId, event, this.clock(), progress);
    if (!goal) return null;
    const kind: TraceEvent['kind'] =
      event === 'complete' ? 'goal-complete' : event === 'fail' ? 'goal-fail' : event === 'cancel' ? 'goal-cancel' : event === 'activate' ? 'goal-create' : event === 'suspend' ? 'goal-suspend' : 'goal-resume';
    this.emitTrace(kind, this.header(goalId, true), { goal_id: goalId, state: goal.state });
    this.emit({ type: 'goal-state', goal });
    const origin = this.goalOrigin.get(goalId);
    if (origin) {
      await this.send(origin, 'goal.update', { goal_id: goalId, state: goal.state, progress: goal.progress });
    }
    return goal;
  }

  /** 语义化别名 */
  completeGoal(goalId: string, progress?: Record<string, unknown>): Promise<Goal | null> {
    return this.updateGoalState(goalId, 'complete', progress);
  }

  failGoal(goalId: string, progress?: Record<string, unknown>): Promise<Goal | null> {
    return this.updateGoalState(goalId, 'fail', progress);
  }

  /* ─── v0.3：子任务分发（goal-split） ─── */

  /**
   * 将父 Goal 拆分为多个子 Goal 并分发给指定执行方（XEP-06 §2）。
   * 子 Goal 遵循相同状态机；父 Goal 在所有子 Goal 终态后自动聚合。
   */
  async splitGoal(parentGoalId: string, children: Array<{ goal: Goal; to: string }>): Promise<void> {
    const parent = this.goalStore.get(parentGoalId);
    if (!parent || parent.state !== 'running') {
      throw new XepError(XepErrorCode.GOAL_REJECTED, `parent goal ${parentGoalId} not running`, { goalId: parentGoalId });
    }
    const parentHeader = this.header(parentGoalId, true);
    this.emitTrace('goal-split', parentHeader, { goal_id: parentGoalId, child_count: children.length });

    for (const { goal, to } of children) {
      const childGoal: Goal = { ...goal, parent_goal_id: parentGoalId, state: 'pending' };
      // 先 proposeGoal（将子 Goal 写入 GoalStore），再 setParent（建立父子关系）
      await this.proposeGoal(to, childGoal);
      this.goalStore.setParent(childGoal.goal_id, parentGoalId);
    }
    // 聚合检查由 handleGoalUpdate 在子 Goal 终态变化时自动触发
  }

  /* ─── v0.3：目标迁移（goal.migrate） ─── */

  /**
   * 将 Goal 迁移到其他执行方（XEP-01 §1.2 migration_hint）。
   * 打包 progress 断点 → 新执行方收到后从断点继续 → 原 Goal cancelled。
   */
  async migrateGoal(goalId: string, toAgentId: string): Promise<void> {
    const goal = this.goalStore.get(goalId);
    if (!goal) throw new XepError(XepErrorCode.GOAL_REJECTED, `goal ${goalId} not found`, { goalId });
    if (goal.migration_hint === 'forbidden') {
      throw new XepError(XepErrorCode.MIGRATION_FORBIDDEN, `goal ${goalId} migration forbidden`, { goalId });
    }
    const header = this.header(goalId, true);
    this.emitTrace('goal-migrate', header, { goal_id: goalId, from_agent: this.agentId, to_agent: toAgentId });

    // 向新执行方发 goal.migrate（携带完整 Goal + progress）
    await this.send(toAgentId, 'goal.migrate', goal as unknown as Record<string, unknown>);
    // 原 Goal 转 cancelled
    await this.updateGoalState(goalId, 'cancel', { migrated_to: toAgentId });
  }

  /* ─── v0.3：effective_time Scheduler ─── */

  private schedulerHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * 启动定时扫描器：自动激活到期的 pending Goals。
   * minimal 实现可不调用此方法（effective_time 由业务驱动）。
   */
  startScheduler(intervalMs: number = 1000): void {
    if (this.schedulerHandle) return;
    this.schedulerHandle = setInterval(() => {
      const now = this.clock();
      for (const goal of this.goalStore.list()) {
        if (goal.state !== 'pending') continue;
        if (goal.effective_time !== undefined && now >= goal.effective_time) {
          const activated = this.goalStore.transition(goal.goal_id, 'activate', now);
          if (activated) {
            this.emit({ type: 'goal-state', goal: activated });
            for (const executor of this.executors) void executor(activated, this);
          }
        }
      }
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }
  }

  /** 声明事实（观测方 → 账本持有方） */
  async assertFact(to: string, fact: Fact): Promise<void> {
    await this.send(to, 'fact.assert', fact as unknown as Record<string, unknown>);
  }

  /** 推翻事实（只追加，不删除） */
  async refuteFact(to: string, fact: Fact, refuting: string[]): Promise<void> {
    await this.send(to, 'fact.refute', { ...fact, refute_of: refuting } as unknown as Record<string, unknown>);
  }

  private async send(to: string, kind: string, payload: Record<string, unknown>, traceOverride?: TraceHeader): Promise<void> {
    const traceId = (traceOverride?.trace_id ?? (payload.goal_id as string) ?? (payload.trace_id as string) ?? 't-anon') as string;
    const header = traceOverride ?? this.header(traceId);
    const env: Envelope = {
      xep_version: XEP_VERSION,
      kind,
      trace: header,
      from: this.agentId,
      to,
      timestamp: this.clock(),
      payload,
    };
    this.lastEventByTrace.set(traceId, header.event_id);
    const outKind = this.kindToTraceKind(kind);
    if (outKind) this.emitTrace(outKind, header, payload);

    const wire = encodeEnvelope(env);
    if (this.signer.algorithm !== 'none') {
      env.signature = this.signer.sign(canonicalEnvelopeBytes(wire));
      wire.signature = env.signature;
    }
    // 报文入队即记录事件（离线时由 transport 排队缓存）
    await this.transport.send(makeAcpMessage(this.agentId, to, env));
  }

  private header(traceId: string, isRoot = false): TraceHeader {
    const parent = isRoot ? null : this.lastEventByTrace.get(traceId) ?? null;
    return { trace_id: traceId, event_id: genEventId('e'), parent_event_id: parent };
  }

  /* --------------------------------- 接收 --------------------------------- */

  private async handleMessage(msg: AcpMessageShape): Promise<void> {
    let env: Envelope;
    try {
      env = decodeEnvelope(msg.payload);
    } catch (err) {
      this.emit({ type: 'error-sent', error: (err as XepError).toPayload?.() ?? { code: XepErrorCode.KIND_UNSUPPORTED, message: String(err) } });
      return;
    }

    try {
      checkVersion(env.xep_version);
      await this.verifySignature(env);
      await this.dispatch(env);
    } catch (err) {
      const xerr = err instanceof XepError ? err : new XepError(XepErrorCode.KIND_UNSUPPORTED, String(err));
      await this.replyError(env, xerr);
    }
  }

  private async verifySignature(env: Envelope): Promise<void> {
    if (this.signer.algorithm === 'none') return; // Level-0/未启用签名
    if (!env.signature) throw new XepError(XepErrorCode.SIGNATURE_INVALID, 'missing signature', { goalId: env.payload.goal_id as string });
    const ok = this.signer.verify(canonicalEnvelopeBytes(encodeEnvelope(env)), env.signature);
    if (!ok) throw new XepError(XepErrorCode.SIGNATURE_INVALID, 'signature mismatch', { goalId: env.payload.goal_id as string });
  }

  private async dispatch(env: Envelope): Promise<void> {
    if (!KNOWN_KINDS.includes(env.kind)) {
      throw new XepError(XepErrorCode.KIND_UNSUPPORTED, `unknown kind: ${env.kind}`); // 回 error，不断链
    }
    // 记录对端溯源头（收到即入本地 trace 日志）；无法映射的 kind 跳过事件化
    const remoteKind = this.kindToTraceKind(env.kind);
    if (remoteKind) this.traces.push(traceHeaderToEvent(env.trace, remoteKind, env.from, env.timestamp));

    switch (env.kind) {
      case 'capability.hello':
        this.handleHello(env);
        break;
      case 'goal.propose':
        await this.handleGoalPropose(env);
        break;
      case 'goal.update':
        this.handleGoalUpdate(env);
        break;
      case 'goal.cancel':
        await this.handleGoalCancel(env);
        break;
      case 'goal.migrate':
        await this.handleGoalMigrate(env);
        break;
      case 'fact.assert':
      case 'fact.refute':
        this.handleFact(env);
        break;
      case 'trace.append':
      case 'error':
        // trace.append 落日志即可（已在 remoteKind 前记录）；error 由发起方处理
        break;
    }
  }

  private handleHello(env: Envelope): void {
    const cap = env.payload as unknown as Capability;
    if (cap && cap.agent_id) {
      this.peers.set(cap.agent_id, cap);
      this.emit({ type: 'peer-hello', peer: cap });
    }
  }

  private async handleGoalPropose(env: Envelope): Promise<void> {
    const goal = env.payload as unknown as Goal;
    if (!goal || typeof goal.goal_id !== 'string') {
      throw new XepError(XepErrorCode.GOAL_REJECTED, 'goal.propose missing goal_id', { goalId: env.payload.goal_id as string });
    }
    // ACL 校验（XEP-08 §2.2）
    const goalType = (goal.payload as Record<string, unknown> | undefined)?.type as string | undefined;
    if (!aclAllowsGoal(this.capability.acl, goalType, goal.priority)) {
      throw new XepError(XepErrorCode.ACL_DENIED, `goal type '${goalType}' not allowed by ACL`, { goalId: goal.goal_id });
    }
    // 能力校验：goal_basic 所有级别必选；Goal 内含 progress 要求离线挂起能力由执行方自行判断
    const stored: Goal = { ...goal, state: 'pending', progress: goal.progress };
    this.goalStore.upsert(stored);
    this.goalOrigin.set(goal.goal_id, env.from);
    this.lastEventByTrace.set(env.trace.trace_id, env.trace.event_id);

    const now = this.clock();
    const effective = goal.effective_time === undefined || now >= goal.effective_time;
    const started = effective ? this.goalStore.transition(goal.goal_id, 'activate', now) : null;
    const current = started ?? stored;
    this.emit({ type: 'goal-state', goal: current });
    // 回执状态给发起方
    await this.send(env.from, 'goal.update', { goal_id: goal.goal_id, state: current.state });
    if (started) {
      for (const executor of this.executors) await executor(current, this);
    }
  }

  private handleGoalUpdate(env: Envelope): void {
    const { goal_id, state, progress } = env.payload as { goal_id?: string; state?: Goal['state']; progress?: Record<string, unknown> };
    if (!goal_id || !state) return;
    const existing = this.goalStore.get(goal_id);
    if (!existing) return;
    // 终态不可逆：已 cancelled/completed/failed 的 Goal 不接受外部状态变更
    const terminal = ['completed', 'failed', 'cancelled'] as const;
    if ((terminal as readonly string[]).includes(existing.state)) return;
    if (existing.state !== state) {
      const updated = { ...existing, state, progress: progress ?? existing.progress };
      this.goalStore.upsert(updated);
      this.lastEventByTrace.set(env.trace.trace_id, env.trace.event_id);
      this.emit({ type: 'goal-state', goal: updated });
      // v0.3：子 Goal 终态变化时检查父 Goal 聚合
      if (updated.parent_goal_id) {
        void this.checkAndAggregateParent(updated.parent_goal_id);
      }
    } else if (progress) {
      const updated = { ...existing, progress };
      this.goalStore.upsert(updated);
    }
  }

  /** 检查父 Goal 聚合状态，若所有子 Goal 终态则更新父 Goal */
  private async checkAndAggregateParent(parentGoalId: string): Promise<void> {
    const result = this.goalStore.checkAggregate(parentGoalId);
    if (!result) return;
    const parent = this.goalStore.get(parentGoalId);
    if (!parent || parent.state === result) return;
    await this.updateGoalState(parentGoalId, result === 'completed' ? 'complete' : result === 'failed' ? 'fail' : 'cancel');
  }

  private async handleGoalCancel(env: Envelope): Promise<void> {
    const { goal_id, reason } = env.payload as { goal_id?: string; reason?: string };
    if (!goal_id) return;
    const cancelled = this.goalStore.transition(goal_id, 'cancel', this.clock());
    this.lastEventByTrace.set(env.trace.trace_id, env.trace.event_id);
    if (cancelled) {
      this.emitTrace('goal-cancel', env.trace, { goal_id, reason });
      this.emit({ type: 'goal-state', goal: cancelled });
      await this.send(env.from, 'goal.update', { goal_id, state: 'cancelled' });
    }
  }

  /** 收到 goal.migrate：接收方作为新 Goal propose 处理（从断点继续） */
  private async handleGoalMigrate(env: Envelope): Promise<void> {
    const goal = env.payload as unknown as Goal;
    if (!goal || typeof goal.goal_id !== 'string') return;
    // 迁移的 Goal 带 progress 断点，作为新 propose 处理
    await this.handleGoalPropose({ ...env, kind: 'goal.propose', payload: goal as unknown as Record<string, unknown> });
  }

  private handleFact(env: Envelope): void {
    const fact = env.payload as unknown as Fact;
    if (!fact || typeof fact.fact_id !== 'string') return;
    // ACL：可写的 Fact 主体范围（XEP-08 §2.2 规则 3）
    if (!aclAllowsFactAbout(this.capability.acl, fact.about)) {
      throw new XepError(XepErrorCode.ACL_DENIED, `fact about '${fact.about}' not writable`, { factId: fact.fact_id });
    }
    const { problems, conflicts } = this.ledger.append(fact);
    this.lastEventByTrace.set(env.trace.trace_id, env.trace.event_id);
    if (problems.length > 0) {
      throw new XepError(XepErrorCode.GOAL_REJECTED, `invalid fact: ${problems.join('; ')}`, { factId: fact.fact_id });
    }
    if (conflicts.length > 0) {
      // FACT_CONFLICT：提示性。账本已保留全部冲突证据，交上层仲裁
      this.emitTrace('fact-refute', env.trace, { fact_id: fact.fact_id, conflicts });
      // v0.3：向被引用旧 fact 的 source_agent 发送 trace.append 通知
      for (const conflict of conflicts) {
        for (const refutedId of conflict.contradicted) {
          const refutedFact = this.ledger.get(refutedId);
          if (refutedFact && refutedFact.source_agent !== this.agentId) {
            void this.send(refutedFact.source_agent, 'trace.append', {
              trace_id: env.trace.trace_id,
              kind: 'fact-refute',
              detail: { incoming: conflict.incoming, contradicted: refutedId, about: conflict.about },
            });
          }
        }
      }
    } else {
      this.emitTrace(env.kind === 'fact.refute' ? 'fact-refute' : 'fact-assert', env.trace, { fact_id: fact.fact_id });
    }
    this.emit({ type: 'fact', fact });
  }

  private async replyError(env: Envelope, err: XepError): Promise<void> {
    this.emit({ type: 'error-sent', error: err.toPayload() });
    // error 报文复用所响应报文的 trace_id，落入同一因果链（XEP-07 §2）
    await this.send(env.from, 'error', err.toPayload() as unknown as Record<string, unknown>, {
      trace_id: env.trace.trace_id,
      event_id: genEventId('e'),
      parent_event_id: env.trace.event_id,
    });
  }

  /* ---------------------------- 断网 suspended 逻辑 ---------------------------- */

  /**
   * 核心特性（XEP-06 §1.2）：网络不通不产生业务错误。
   * offline → 我方 running 的 Goal 转 suspended；
   * online → suspended 转 running，携带 offline_gap，从 progress 断点续跑。
   */
  private onLinkState(state: LinkState): void {
    const now = this.clock();
    this.emit({ type: 'link', link: state });
    if (state === 'offline') {
      for (const goal of this.goalStore.list()) {
        if (goal.state === 'running') {
          const updated = this.goalStore.transition(goal.goal_id, 'suspend', now);
          if (updated) {
            this.suspendedAt.set(goal.goal_id, now);
            this.emitTrace('goal-suspend', this.header(goal.goal_id, true), { goal_id: goal.goal_id, reason: 'AGENT_OFFLINE_UNREACHABLE' });
            this.emit({ type: 'goal-state', goal: updated, detail: 'suspended by link loss (not failed)' });
          }
        }
      }
    } else {
      for (const goal of this.goalStore.list()) {
        if (goal.state === 'suspended') {
          const suspendedFrom = this.suspendedAt.get(goal.goal_id) ?? now;
          const updated = this.goalStore.transition(goal.goal_id, 'resume', now);
          if (updated) {
            this.suspendedAt.delete(goal.goal_id);
            const h = this.header(goal.goal_id, true);
            h.offline_gap = { from: suspendedFrom, to: now };
            this.emitTrace('goal-resume', h, { goal_id: goal.goal_id, offline_gap: h.offline_gap });
            this.emit({ type: 'goal-state', goal: updated, detail: 'resumed from progress (offline_gap recorded)' });
            for (const executor of this.executors) void executor(updated, this);
          }
        }
      }
    }
  }

  /* --------------------------------- 内部 --------------------------------- */

  private kindToTraceKind(kind: string): TraceEvent['kind'] | null {
    switch (kind) {
      case 'goal.propose': return 'goal-create';
      case 'goal.update': return 'goal-resume';
      case 'goal.cancel': return 'goal-cancel';
      case 'fact.assert': return 'fact-assert';
      case 'fact.refute': return 'fact-refute';
      case 'trace.append':
      case 'error':
      case 'goal.migrate':
      default: return null;
    }
  }

  private emitTrace(kind: TraceEvent['kind'], header: TraceHeader, detail?: Record<string, unknown>): void {
    const event = traceHeaderToEvent(header, kind, this.agentId, this.clock(), detail);
    this.traces.push(event);
    this.emit({ type: 'trace', trace: event });
  }

  private emit(e: AgentEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  /** 测试/调试用：对端能力掩码查询 */
  peerHasCapability(agentId: string, flag: Parameters<typeof hasCapability>[1]): boolean {
    return hasCapability(this.peers.get(agentId), flag);
  }
}
