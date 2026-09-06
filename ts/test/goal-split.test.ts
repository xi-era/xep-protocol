import { describe, expect, it } from 'vitest';
import { FlakyLinkTransport, MessageBus } from '../src/transport/mock.js';
import { XepAgent } from '../src/runtime/agent.js';
import { defaultMaskForLevel } from '../src/models/capability.js';
import { Goal } from '../src/models/goal.js';

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

const parentGoal: Goal = {
  goal_id: 'g-parent', state: 'running', priority: 200,
  payload: { type: 'batch-sensor', sensors: ['thermo-01', 'thermo-02'] },
};

describe('v0.3 goal-split：子任务分发与聚合', () => {
  it('splitGoal → 2 个子 Goal 分发 → 各自完成 → 父 Goal 自动聚合 completed', async () => {
    const bus = new MessageBus();
    const { agent: master } = mkAgent('master', bus);
    const { agent: worker1 } = mkAgent('worker1', bus);
    const { agent: worker2 } = mkAgent('worker2', bus);

    master.start(); worker1.start(); worker2.start();
    master.sendHello('worker1'); master.sendHello('worker2');
    worker1.sendHello('master'); worker2.sendHello('master');
    await sleep(20);

    // 注册执行器：worker 收到子 Goal 后立即完成
    worker1.onGoal(async (goal) => { await worker1.completeGoal(goal.goal_id); });
    worker2.onGoal(async (goal) => { await worker2.completeGoal(goal.goal_id); });

    // 父 Goal 已 running
    master.goalStore.upsert({ ...parentGoal });

    // 拆分
    const child1: Goal = { goal_id: 'g-child-1', state: 'pending', priority: 100, payload: { sensor: 'thermo-01' } };
    const child2: Goal = { goal_id: 'g-child-2', state: 'pending', priority: 100, payload: { sensor: 'thermo-02' } };
    await master.splitGoal('g-parent', [
      { goal: child1, to: 'worker1' },
      { goal: child2, to: 'worker2' },
    ]);
    await sleep(100);

    // 子 Goal 终态
    expect(worker1.goalStore.get('g-child-1')?.state).toBe('completed');
    expect(worker2.goalStore.get('g-child-2')?.state).toBe('completed');
    // 父 Goal 聚合为 completed
    expect(master.goalStore.get('g-parent')?.state).toBe('completed');
  });

  it('splitGoal → 子 Goal failed + rollback_policy=none → 父 Goal failed', async () => {
    const bus = new MessageBus();
    const { agent: master } = mkAgent('master', bus);
    const { agent: worker } = mkAgent('worker', bus);

    master.start(); worker.start();
    master.sendHello('worker'); worker.sendHello('master');
    await sleep(20);

    // worker 收到 Goal 后立即失败
    worker.onGoal(async (goal) => { await worker.failGoal(goal.goal_id); });

    master.goalStore.upsert({ ...parentGoal, rollback_policy: 'none' });

    await master.splitGoal('g-parent', [
      { goal: { goal_id: 'g-fail', state: 'pending', priority: 100, payload: {} }, to: 'worker' },
    ]);
    await sleep(200);

    expect(master.goalStore.get('g-parent')?.state).toBe('failed');
  });

  it('splitGoal 拒绝非 running 父 Goal', async () => {
    const bus = new MessageBus();
    const { agent: master } = mkAgent('master', bus);
    master.start();
    master.goalStore.upsert({ ...parentGoal, state: 'pending' });

    await expect(
      master.splitGoal('g-parent', [{ goal: { goal_id: 'g-x', state: 'pending', priority: 1, payload: {} }, to: 'w' }]),
    ).rejects.toThrow();
  });
});
