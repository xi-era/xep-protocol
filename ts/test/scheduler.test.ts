import { describe, expect, it, afterEach } from 'vitest';
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

describe('v0.3 effective_time Scheduler', () => {
  let agents: XepAgent[] = [];
  afterEach(() => { for (const a of agents) a.stopScheduler(); agents = []; });

  it('pending Goal 到期自动 activate + 调用 executor', async () => {
    const bus = new MessageBus();
    const { agent } = mkAgent('edge', bus);
    agents = [agent];
    agent.start();

    let activated = false;
    agent.onGoal(async (goal) => {
      if (goal.goal_id === 'g-sched') activated = true;
    });

    // 插入一个 pending Goal，effective_time 设为未来 50ms
    const futureTime = clock() + 50;
    agent.goalStore.upsert({
      goal_id: 'g-sched', state: 'pending', priority: 100,
      effective_time: futureTime,
      payload: { type: 'timer-task' },
    });

    agent.startScheduler(20); // 每 20ms 扫描一次
    await sleep(200); // 等待足够时间

    expect(agent.goalStore.get('g-sched')?.state).toBe('running');
    expect(activated).toBe(true);
  });

  it('stopScheduler 停止扫描', async () => {
    const bus = new MessageBus();
    const { agent } = mkAgent('edge', bus);
    agents = [agent];
    agent.start();

    agent.goalStore.upsert({
      goal_id: 'g-stop', state: 'pending', priority: 100,
      effective_time: clock() + 20,
      payload: {},
    });

    agent.startScheduler(10);
    agent.stopScheduler();
    await sleep(100);

    // 未激活（scheduler 已停止）
    expect(agent.goalStore.get('g-stop')?.state).toBe('pending');
  });

  it('已 running 的 Goal 不受影响', async () => {
    const bus = new MessageBus();
    const { agent } = mkAgent('edge', bus);
    agents = [agent];
    agent.start();

    agent.goalStore.upsert({
      goal_id: 'g-run', state: 'running', priority: 100,
      payload: {},
    });

    agent.startScheduler(20);
    await sleep(60);

    expect(agent.goalStore.get('g-run')?.state).toBe('running');
  });
});
