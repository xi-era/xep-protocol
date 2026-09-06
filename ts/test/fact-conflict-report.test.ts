import { describe, expect, it } from 'vitest';
import { FlakyLinkTransport, MessageBus } from '../src/transport/mock.js';
import { XepAgent } from '../src/runtime/agent.js';
import { defaultMaskForLevel } from '../src/models/capability.js';
import { Fact } from '../src/models/fact.js';

let tick = 0;
const clock = () => (tick += 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkAgent(id: string, bus: MessageBus) {
  const t = new FlakyLinkTransport(bus);
  const agent = new XepAgent({
    agentId: id, clock,
    capability: { agent_id: id, level: 2, mask: defaultMaskForLevel(2) },
    transport: t,
  });
  return { agent, transport: t };
}

describe('v0.3 FACT_CONFLICT 上报：向冲突相关方发 trace.append', () => {
  it('Bob 发两条矛盾 fact 给 Alice → Alice 检测冲突 + 保留两条证据', async () => {
    const bus = new MessageBus();
    const { agent: alice } = mkAgent('alice', bus);
    const { agent: bob } = mkAgent('bob', bus);

    alice.start(); bob.start();
    alice.sendHello('bob'); bob.sendHello('alice');
    await sleep(20);

    // Bob 先发一条事实给 Alice
    const fact1: Fact = {
      fact_id: 'f-1', about: 'sensor/thermo-01/temperature',
      statement: { celsius: 28.5 }, confidence: 0.95,
      time_anchor: clock(), source_agent: 'bob',
    };
    await bob.assertFact('alice', fact1);
    await sleep(20);

    expect(alice.ledger.get('f-1')?.statement).toEqual({ celsius: 28.5 });

    // Bob 再发一条矛盾事实（不同值）给 Alice
    const fact2: Fact = {
      fact_id: 'f-2', about: 'sensor/thermo-01/temperature',
      statement: { celsius: 26.0 }, confidence: 0.88,
      time_anchor: clock(), source_agent: 'bob',
    };
    await bob.assertFact('alice', fact2);
    await sleep(20);

    // Alice 的账本保留两条冲突事实（追加式，不删除）
    expect(alice.ledger.all()).toHaveLength(2);

    // Alice 本地记录了 fact-refute 事件（含冲突详情）
    const conflictTrace = alice.traceLog.find(
      (t) => t.kind === 'fact-refute' && (t.detail as any)?.fact_id === 'f-2',
    );
    expect(conflictTrace).toBeDefined();
    expect((conflictTrace!.detail as any).conflicts).toHaveLength(1);
  });

  it('同 about 同值不报冲突', async () => {
    const bus = new MessageBus();
    const { agent: alice } = mkAgent('alice', bus);
    const { agent: bob } = mkAgent('bob', bus);

    alice.start(); bob.start();
    alice.sendHello('bob'); bob.sendHello('alice');
    await sleep(20);

    const fact1: Fact = {
      fact_id: 'f-same-1', about: 'sensor/thermo-01/temperature',
      statement: { celsius: 25.0 }, confidence: 0.9,
      time_anchor: clock(), source_agent: 'alice',
    };
    await alice.assertFact('bob', fact1);
    await sleep(20);

    const fact2: Fact = {
      fact_id: 'f-same-2', about: 'sensor/thermo-01/temperature',
      statement: { celsius: 25.0 }, confidence: 0.9,
      time_anchor: clock(), source_agent: 'bob',
    };
    await bob.assertFact('alice', fact2);
    await sleep(20);

    // 无冲突通知（值相同）
    const traceEvents = alice.traceLog.filter((t) => t.kind === 'trace-append' as any);
    const conflictNotification = traceEvents.find(
      (t) => (t.detail as any)?.incoming === 'f-same-2',
    );
    expect(conflictNotification).toBeUndefined();
  });
});
