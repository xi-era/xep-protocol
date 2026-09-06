import { describe, expect, it } from 'vitest';
import { FlakyLinkTransport, MessageBus } from '../src/transport/mock.js';
import { XepAgent } from '../src/runtime/agent.js';
import { defaultMaskForLevel } from '../src/models/capability.js';
import { Goal } from '../src/models/goal.js';
import { XepErrorCode } from '../src/errors.js';

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

describe('v0.3 goal.migrate：目标迁移', () => {
  it('migrateGoal → 新执行方收到 Goal + progress → 原 Goal cancelled', async () => {
    const bus = new MessageBus();
    const { agent: alice } = mkAgent('alice', bus);
    const { agent: bob } = mkAgent('bob', bus);

    alice.start(); bob.start();
    alice.sendHello('bob'); bob.sendHello('alice');
    await sleep(20);

    // Alice 有一个 running Goal，带 progress
    alice.goalStore.upsert({
      goal_id: 'g-mig', state: 'running', priority: 100,
      migration_hint: 'allowed',
      progress: { last_step: 3 },
      payload: { type: 'sensor-read' },
    });

    // Bob 注册执行器：收到迁移 Goal 后确认
    let receivedProgress: Record<string, unknown> | undefined;
    bob.onGoal(async (goal) => {
      receivedProgress = goal.progress;
      await bob.completeGoal(goal.goal_id);
    });

    await alice.migrateGoal('g-mig', 'bob');
    await sleep(100);

    // 原 Goal cancelled
    expect(alice.goalStore.get('g-mig')?.state).toBe('cancelled');
    // Bob 收到 Goal 并完成，progress 保留
    expect(receivedProgress).toEqual({ last_step: 3 });
    expect(bob.goalStore.get('g-mig')?.state).toBe('completed');
  });

  it('migration_hint: forbidden → 抛 MIGRATION_FORBIDDEN', async () => {
    const bus = new MessageBus();
    const { agent: alice } = mkAgent('alice', bus);
    alice.start();
    alice.goalStore.upsert({
      goal_id: 'g-fixed', state: 'running', priority: 100,
      migration_hint: 'forbidden',
      payload: { type: 'local-sensor' },
    });

    await expect(alice.migrateGoal('g-fixed', 'bob')).rejects.toThrow(
      expect.objectContaining({ code: XepErrorCode.MIGRATION_FORBIDDEN }),
    );
  });
});
