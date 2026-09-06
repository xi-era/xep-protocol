/**
 * GoalStore — Goal 持有与状态流转（内存实现）。
 * 持久化是实现的选择（XEP-09：L2 MUST / L1 MAY / L0 MUST NOT），不在协议内强制。
 * 部署方可注入 sink 在状态变更时持久化。
 */
import { Envelope } from '../envelope.js';
import { Goal, GoalState, GoalTransitionEvent, applyGoalTransition, isGoalExpired } from '../models/goal.js';
import { TraceEvent } from '../models/trace.js';

export type GoalSink = (goal: Goal) => void;

export class GoalStore {
  private goals = new Map<string, Goal>();

  constructor(private readonly sink?: GoalSink) {}

  get(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  list(): Goal[] {
    return [...this.goals.values()];
  }

  upsert(goal: Goal): void {
    this.goals.set(goal.goal_id, goal);
    this.sink?.(goal);
  }

  /**
   * 流转：非法流转静默拒绝（不改变状态），合法则更新并返回新 Goal。
   * expire 检查内建：resume 后若已过 expire_time 自动转 cancelled（XEP-06 §1.2 规则 4）。
   */
  transition(goalId: string, event: GoalTransitionEvent, now: number, progress?: Record<string, unknown>): Goal | null {
    const goal = this.goals.get(goalId);
    if (!goal) return null;
    try {
      let next = applyGoalTransition(goal, event, progress);
      if (isGoalExpired({ ...next, state: next.state }, now) && next.state !== 'cancelled') {
        // 挂起恢复等场景过期的兜底
        next = applyGoalTransition(goal, event === 'resume' ? 'expire' : event, progress);
      }
      this.upsert(next);
      return next;
    } catch {
      return null; // 非法流转：拒绝且状态不变
    }
  }

  /** 响应 goal.propose / goal.update 等报文时的整体 upsert */
  replaceFromEnvelope(payload: Record<string, unknown>): Goal | null {
    const goal = payload as unknown as Goal;
    if (!goal || typeof goal.goal_id !== 'string') return null;
    this.upsert(goal);
    return goal;
  }

  /* ─── v0.3：子任务分发与聚合 ─── */

  /** 查询某父 Goal 的所有子 Goal */
  getChildren(parentGoalId: string): Goal[] {
    const parent = this.goals.get(parentGoalId);
    if (!parent?.children) return [];
    return parent.children.map((id) => this.goals.get(id)).filter((g): g is Goal => g !== undefined);
  }

  /** 建立父子关系：设置 child 的 parent_goal_id，并将 child id 加入 parent.children */
  setParent(childGoalId: string, parentGoalId: string): void {
    const child = this.goals.get(childGoalId);
    const parent = this.goals.get(parentGoalId);
    if (!child || !parent) return;
    const updatedChild = { ...child, parent_goal_id: parentGoalId };
    this.upsert(updatedChild);
    const siblings = parent.children ?? [];
    if (!siblings.includes(childGoalId)) {
      const updatedParent = { ...parent, children: [...siblings, childGoalId] };
      this.upsert(updatedParent);
    }
  }

  /**
   * 检查所有子 Goal 终态，返回聚合结果（XEP-06 §2）：
   * - 全部终态（completed/failed/cancelled）→ 返回主导终态
   * - 仍有 running/suspended → null（继续等待）
   *
   * 聚合规则：
   *  - 全部 completed → 'completed'
   *  - 任一 failed 且 rollback_policy='none' → 'failed'
   *  - 任一 cancelled 且无其他 running → 'cancelled'
   */
  checkAggregate(parentGoalId: string): GoalState | null {
    const children = this.getChildren(parentGoalId);
    if (children.length === 0) return null;

    const terminal = ['completed', 'failed', 'cancelled'] as const;
    const allTerminal = children.every((c) => (terminal as readonly string[]).includes(c.state));
    if (!allTerminal) return null; // 仍有活跃子 Goal

    const hasFailed = children.some((c) => c.state === 'failed');
    const hasCancelled = children.some((c) => c.state === 'cancelled');
    const allCompleted = children.every((c) => c.state === 'completed');

    if (allCompleted) return 'completed';
    if (hasFailed) return 'failed';
    if (hasCancelled) return 'cancelled';
    return null;
  }
}

/** Goal 状态 → Trace 事件 kind 映射 */
export function traceKindForGoalState(state: GoalState): string | null {
  switch (state) {
    case 'pending':
      return 'goal-create';
    case 'running':
      return 'goal-resume'; // running 可由 activate 或 resume 进入，调用方可覆盖
    case 'suspended':
      return 'goal-suspend';
    case 'completed':
      return 'goal-complete';
    case 'failed':
      return 'goal-fail';
    case 'cancelled':
      return 'goal-cancel';
  }
}

/** 从 goal.update 报文构造 trace detail */
export function goalTraceDetail(goal: Goal): Record<string, unknown> {
  return { goal_id: goal.goal_id, state: goal.state };
}

export function makeGoalUpdateEnvelope(base: Envelope, goal: Goal): Envelope {
  return {
    ...base,
    kind: 'goal.update',
    payload: { goal_id: goal.goal_id, state: goal.state, progress: goal.progress },
  };
}
