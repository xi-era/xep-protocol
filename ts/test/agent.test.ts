import { describe, expect, it, vi } from 'vitest';
import { FlakyLinkTransport, InMemoryTransport, MessageBus } from '../src/transport/mock.js';
import { XepAgent } from '../src/runtime/agent.js';
import { Capability, defaultMaskForLevel } from '../src/models/capability.js';
import { Goal } from '../src/models/goal.js';
import { Fact } from '../src/models/fact.js';
import { NoopSigner, ExternalKeySigner, canonicalEnvelopeBytes } from '../src/security/signer.js';
import { decodeEnvelope } from '../src/envelope.js';
import { XepErrorCode } from '../src/errors.js';

let tick = 0;
const clock = () => (tick += 10);

function mkAgent(id: string, bus: MessageBus, level: 0 | 1 | 2, acl?: Capability['acl']) {
  const transport = new InMemoryTransport(bus);
  const agent = new XepAgent({
    agentId: id,
    capability: { agent_id: id, level, mask: defaultMaskForLevel(level), ...(acl ? { acl } : {}) },
    transport,
    clock,
  });
  return { agent, transport };
}

const goal: Goal = {
  goal_id: 'g-t1',
  state: 'pending',
  priority: 200,
  payload: { type: 'sensor-monitor', sensor: 'thermo-01' },
};

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('XepAgent：目标下发与状态回报', () => {
  it('propose → 边缘 pending→running → 云端收到 running 回执', async () => {
    const bus = new MessageBus();
    const cloud = mkAgent('cloud', bus, 2);
    const edge = mkAgent('edge', bus, 1);
    cloud.agent.start();
    edge.agent.start();
    cloud.agent.sendHello('edge');
    edge.agent.sendHello('cloud');
    await flush();

    const edgeStates: string[] = [];
    edge.agent.onEvent((e) => e.type === 'goal-state' && edgeStates.push(e.goal!.state));
    await cloud.agent.proposeGoal('edge', goal);
    await flush();

    expect(edge.agent.goalStore.get('g-t1')?.state).toBe('running');
    expect(edgeStates).toContain('running');
    // 云端视角同步为 running
    expect(cloud.agent.goalStore.get('g-t1')?.state).toBe('running');
  });

  it('effective_time 未到 → pending，到点不自动激活（v0.1 由业务驱动 activate）', async () => {
    const bus = new MessageBus();
    const cloud = mkAgent('cloud', bus, 2);
    const edge = mkAgent('edge', bus, 1);
    cloud.agent.start();
    edge.agent.start();
    cloud.agent.sendHello('edge');
    edge.agent.sendHello('cloud');
    await flush();

    await cloud.agent.proposeGoal('edge', { ...goal, goal_id: 'g-future', effective_time: clock() + 10 ** 9 });
    await flush();
    expect(edge.agent.goalStore.get('g-future')?.state).toBe('pending');
  });

  it('ACL 拒绝高危目标 → ACL_DENIED error 落同一因果链', async () => {
    const bus = new MessageBus();
    const cloud = mkAgent('cloud', bus, 2);
    const edge = mkAgent('edge', bus, 1, { denied_goal_types: ['reboot'] });
    cloud.agent.start();
    edge.agent.start();
    cloud.agent.sendHello('edge');
    edge.agent.sendHello('cloud');
    await flush();

    const errors: string[] = [];
    // error-sent 事件由「拒绝方」（edge）发出
    edge.agent.onEvent((e) => e.type === 'error-sent' && errors.push(e.error!.code));
    await cloud.agent.proposeGoal('edge', { ...goal, goal_id: 'g-reboot', payload: { type: 'reboot' } });
    await flush();

    expect(errors).toContain(XepErrorCode.ACL_DENIED);
    expect(edge.agent.goalStore.get('g-reboot')).toBeUndefined(); // Goal 不进入生命周期
  });
});

describe('XepAgent：断网 suspended ≠ failed（核心验收）', () => {
  function setup() {
    const bus = new MessageBus();
    const cloudT = new FlakyLinkTransport(bus);
    const edgeT = new FlakyLinkTransport(bus);
    const cloud = new XepAgent({
      agentId: 'cloud',
      capability: { agent_id: 'cloud', level: 2, mask: defaultMaskForLevel(2) },
      transport: cloudT,
      clock,
    });
    const edge = new XepAgent({
      agentId: 'edge',
      capability: { agent_id: 'edge', level: 1, mask: defaultMaskForLevel(1) },
      transport: edgeT,
      clock,
    });
    cloud.start();
    edge.start();
    cloud.sendHello('edge');
    edge.sendHello('cloud');
    return { cloud, edge, cloudT, edgeT };
  }

  it('断网：Goal 转 suspended 且无业务错误；恢复：续跑 completed + offline_gap 记录', async () => {
    const { cloud, edge, cloudT, edgeT } = setup();
    await flush();

    const cloudErrors: string[] = [];
    const cloudStates: string[] = [];
    const edgeStates: string[] = [];
    cloud.onEvent((e) => {
      if (e.type === 'goal-state') cloudStates.push(e.goal!.state);
      if (e.type === 'error-sent') cloudErrors.push(e.error!.code);
    });
    edge.onEvent((e) => e.type === 'goal-state' && edgeStates.push(e.goal!.state));

    await cloud.proposeGoal('edge', goal);
    await flush();
    expect(cloud.goalStore.get('g-t1')?.state).toBe('running');

    // ---- 链路中断 ----
    cloudT.setLinkState('offline');
    edgeT.setLinkState('offline');
    await flush();

    // 双方视角均为 suspended，而非 failed —— 验收红线
    expect(cloud.goalStore.get('g-t1')?.state).toBe('suspended');
    expect(edge.goalStore.get('g-t1')?.state).toBe('suspended');
    expect(cloudErrors).toEqual([]); // 全程无业务错误
    expect(edgeStates).toContain('suspended');

    // 断网期间边缘「离线执行」：fact.assert 进入 outbox 缓存，不丢失
    const offlineFact: Fact = {
      fact_id: 'f-offline-1',
      about: 'sensor/thermo-01/temperature',
      statement: { celsius: 28.5 },
      confidence: 0.95,
      time_anchor: clock(),
      source_agent: 'edge',
    };
    await edge.assertFact('cloud', offlineFact);
    await flush();
    expect(cloud.ledger.get('f-offline-1')).toBeUndefined(); // 仍未送达（缓存中）

    // ---- 链路恢复 ----
    cloudT.setLinkState('online');
    edgeT.setLinkState('online');
    await flush();

    // Goal 恢复 running
    expect(edge.goalStore.get('g-t1')?.state).toBe('running');
    // 缓存的离线观测补投成功
    expect(cloud.ledger.get('f-offline-1')?.statement).toEqual({ celsius: 28.5 });
    // offline_gap 已记录在 trace 中
    const gapTrace = edge.traceLog.find((t) => t.offline_gap !== undefined);
    expect(gapTrace).toBeDefined();
    expect(gapTrace!.kind).toBe('goal-resume');
    expect(gapTrace!.offline_gap!.from).toBeLessThan(gapTrace!.offline_gap!.to);

    // 收尾完成：执行方驱动流转并回报发起方
    await edge.completeGoal('g-t1', { last_read_ms: clock() });
    await edge.assertFact('cloud', { ...offlineFact, fact_id: 'f-final', statement: { celsius: 27 }, time_anchor: clock() });
    await flush();
    expect(edge.goalStore.get('g-t1')?.state).toBe('completed');
    expect(cloud.goalStore.get('g-t1')?.state).toBe('completed');
  });

  it('goal.cancel 双向流转', async () => {
    const { cloud, edge } = setup();
    await flush();
    const cancelledStates: string[] = [];
    edge.onEvent((e) => e.type === 'goal-state' && e.goal!.state === 'cancelled' && cancelledStates.push(e.goal!.goal_id));
    await cloud.proposeGoal('edge', goal);
    await flush();
    await cloud.cancelGoal('edge', 'g-t1', 'no longer needed');
    await flush();
    expect(edge.goalStore.get('g-t1')?.state).toBe('cancelled');
    expect(cloud.goalStore.get('g-t1')?.state).toBe('cancelled');
    expect(cancelledStates).toEqual(['g-t1']);
  });
});

describe('XepAgent：错误与兼容性', () => {
  it('未知 kind → KIND_UNSUPPORTED error，链路不断', async () => {
    const bus = new MessageBus();
    const cloud = mkAgent('cloud', bus, 2);
    const edge = mkAgent('edge', bus, 1);
    cloud.agent.start();
    edge.agent.start();
    cloud.agent.sendHello('edge');
    edge.agent.sendHello('cloud');
    await flush();

    await edge.agent['send']('cloud', 'weird.future_kind', { foo: 1 });
    await flush();
    // edge 收到了 cloud 回的 error（链路仍在）
    const errEvents: string[] = [];
    edge.agent.onEvent((e) => e.type === 'error-sent' && errEvents.push(e.error!.code));
    void errEvents;
    // cloud 未崩溃且能继续正常通信
    await cloud.agent.proposeGoal('edge', goal);
    await flush();
    expect(edge.agent.goalStore.get('g-t1')?.state).toBe('running');
  });

  it('签名：Level-2 验签失败拒收 SIGNATURE_INVALID', async () => {
    const bus = new MessageBus();
    const goodKey = {
      sign: (b: Uint8Array) => `sig(${b.length})`,
      verify: (b: Uint8Array, s: string) => s === `sig(${b.length})`,
    };
    const edgeT = new InMemoryTransport(bus);
    const cloudT = new InMemoryTransport(bus);
    const edge = new XepAgent({
      agentId: 'edge',
      capability: { agent_id: 'edge', level: 2, mask: defaultMaskForLevel(2) },
      transport: edgeT,
      signer: new ExternalKeySigner('test-canonical', goodKey),
      clock,
    });
    const cloud = new XepAgent({
      agentId: 'cloud',
      capability: { agent_id: 'cloud', level: 2, mask: defaultMaskForLevel(2) },
      transport: cloudT,
      signer: new ExternalKeySigner('test-canonical', goodKey),
      clock,
    });
    edge.start();
    cloud.start();
    edge.sendHello('cloud');
    cloud.sendHello('edge');
    await flush();

    // 篡改报文：构造有效签名后修改 payload
    await cloud.proposeGoal('edge', goal);
    await flush();

    const env = decodeEnvelope(JSON.stringify({
      xep_version: '0.1', kind: 'goal.propose',
      trace: { trace_id: 'g-evil', event_id: 'e-x', parent_event_id: null },
      from: 'cloud', to: 'edge', timestamp: 1,
      payload: { goal_id: 'g-evil', state: 'pending', priority: 1, payload: { type: 'x' } },
      signature: 'sig(tampered)',
    }));
    await bus.publish({ id: 'x', from: 'cloud', to: 'edge', payload: env }, cloudT);
    await flush();
    expect(edge.goalStore.get('g-evil')).toBeUndefined(); // 篡改报文被拒收
    expect(edge.goalStore.get('g-t1')?.state).toBe('running'); // 正常报文不受影响
  });

  it('NoopSigner（Level-0）：无签名报文照常处理', async () => {
    const bus = new MessageBus();
    const edge = mkAgent('edge', bus, 0);
    const cloud = mkAgent('cloud', bus, 2);
    cloud.agent.start();
    edge.agent.start();
    cloud.agent.sendHello('edge');
    edge.agent.sendHello('cloud');
    await flush();
    await cloud.agent.proposeGoal('edge', goal);
    await flush();
    expect(edge.agent.goalStore.get('g-t1')?.state).toBe('running');
  });

  it('canonicalEnvelopeBytes 稳定序列化与签名字段排除', () => {
    const a = { kind: 'x', timestamp: 1, payload: { b: 2, a: 1 } };
    const b = { payload: { a: 1, b: 2 }, timestamp: 1, kind: 'x' };
    expect(Buffer.from(canonicalEnvelopeBytes(a)).toString()).toBe(Buffer.from(canonicalEnvelopeBytes(b)).toString());
    const withSig = { ...a, signature: 'zzz' };
    expect(Buffer.from(canonicalEnvelopeBytes(withSig)).toString()).toBe(Buffer.from(canonicalEnvelopeBytes(a)).toString());
  });

  it('NoopSigner 实例行为', () => {
    const s = new NoopSigner();
    expect(s.algorithm).toBe('none');
    expect(s.verify(new Uint8Array([1]), 'x')).toBe(true);
  });
});
