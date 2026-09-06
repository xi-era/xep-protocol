/**
 * AcpSdkAdapter 集成测试：两个 XepAgent 通过真实 @xi-era/acp-sdk WS 传输交换 XEP-Envelope。
 * 覆盖：消息收发、capability.hello 握手、goal.propose→running、断网 suspended→恢复续跑、offline_gap 记录。
 */
import { describe, expect, it, afterAll } from 'vitest';
import { AcpSdkAdapter } from '../src/transport/acp-sdk-adapter.js';
import { XepAgent } from '../src/runtime/agent.js';
import { defaultMaskForLevel } from '../src/models/capability.js';
import { Goal } from '../src/models/goal.js';
import { Fact } from '../src/models/fact.js';
import { FlakyLinkTransport, MessageBus } from '../src/transport/mock.js';

let tick = 0;
const clock = () => (tick += 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ─────────── 集成测试：真实 AcpSdkAdapter + 内存 fallback ───────────
 * 真实 WS 测试需要两个 adapter 互连，端口分配避免冲突。
 * 若 @xi-era/acp-sdk 未安装则 skip（peerDependency optional）。
 */

let sdkAvailable = true;
try { await import('@xi-era/acp-sdk/server'); } catch { sdkAvailable = false; }

const describeSdk = sdkAvailable ? describe : describe.skip;

describeSdk('AcpSdkAdapter：真实 AcpServer + AcpClient WS 传输', () => {
  let cloudAdapter: AcpSdkAdapter;
  let edgeAdapter: AcpSdkAdapter;
  let cloud: XepAgent;
  let edge: XepAgent;

  afterAll(async () => {
    await cloudAdapter?.shutdown();
    await edgeAdapter?.shutdown();
  });

  it('两个 adapter 启动、握手、goal.propose→running，验证真实 ACP 投递', async () => {
    // 使用临时端口（port=0 由 OS 分配），避免固定端口冲突
    cloudAdapter = new AcpSdkAdapter({ agentId: 'cloud', port: 0, peers: {} });
    edgeAdapter = new AcpSdkAdapter({ agentId: 'edge', port: 0, peers: {} });

    cloud = new XepAgent({
      agentId: 'cloud',
      capability: { agent_id: 'cloud', level: 2, mask: defaultMaskForLevel(2) },
      transport: cloudAdapter,
      clock,
    });
    edge = new XepAgent({
      agentId: 'edge',
      capability: { agent_id: 'edge', level: 1, mask: defaultMaskForLevel(1) },
      transport: edgeAdapter,
      clock,
    });

    cloud.start();
    edge.start();

    // 启动真实 AcpServer，拿到实际端口后互配 peer URL
    await edgeAdapter.start();
    await cloudAdapter.start();
    cloudAdapter.setPeerUrl('edge', `ws://localhost:${edgeAdapter.listenPort}/acp`);
    edgeAdapter.setPeerUrl('cloud', `ws://localhost:${cloudAdapter.listenPort}/acp`);
    await sleep(100); // 等待 WS 服务就绪

    // 能力握手
    cloud.sendHello('edge');
    edge.sendHello('cloud');
    await sleep(300);

    expect(cloud.peerOf('edge')?.mask).toContain('offline_suspend');
    expect(edge.peerOf('cloud')?.mask).toContain('goal_migrate');

    // Goal 下发：cloud → edge 走真实 WS
    const goal: Goal = {
      goal_id: 'g-ws-01',
      state: 'pending',
      priority: 200,
      payload: { type: 'sensor-monitor', sensor: 'thermo-01' },
    };

    const edgeStates: string[] = [];
    edge.onEvent((e) => e.type === 'goal-state' && edgeStates.push(e.goal!.state));

    await cloud.proposeGoal('edge', goal);
    await sleep(200);

    expect(edge.goalStore.get('g-ws-01')?.state).toBe('running');
    expect(edgeStates).toContain('running');
    // cloud 也收到 goal.update running 回执
    expect(cloud.goalStore.get('g-ws-01')?.state).toBe('running');
  });

  it('程序化断网→suspended，恢复→续跑，offline_gap 记录', async () => {
    // 断网
    edgeAdapter.setLinkState('offline');
    cloudAdapter.setLinkState('offline');
    await sleep(50);

    expect(edge.goalStore.get('g-ws-01')?.state).toBe('suspended');
    expect(cloud.goalStore.get('g-ws-01')?.state).toBe('suspended');

    // 离线期间 edge 仍可本地执行，fact.assert 进入 outbox
    const offlineFact: Fact = {
      fact_id: 'f-ws-offline-1',
      about: 'sensor/thermo-01/temperature',
      statement: { celsius: 28.5 },
      confidence: 0.95,
      time_anchor: clock(),
      source_agent: 'edge',
    };
    await edge.assertFact('cloud', offlineFact);
    await sleep(50);
    expect(cloud.ledger.get('f-ws-offline-1')).toBeUndefined(); // 未送达（缓存中）

    // 恢复
    edgeAdapter.setLinkState('online');
    cloudAdapter.setLinkState('online');
    await sleep(300);

    expect(edge.goalStore.get('g-ws-01')?.state).toBe('running');
    expect(cloud.ledger.get('f-ws-offline-1')?.statement).toEqual({ celsius: 28.5 });

    // offline_gap 已记录
    const gap = edge.traceLog.find((t) => t.offline_gap !== undefined);
    expect(gap).toBeDefined();
    expect(gap!.kind).toBe('goal-resume');
    expect(gap!.offline_gap!.from).toBeLessThan(gap!.offline_gap!.to);

    // 完成
    await edge.completeGoal('g-ws-01');
    await sleep(200);
    expect(cloud.goalStore.get('g-ws-01')?.state).toBe('completed');
  });
});

/* ─────────── 回归测试：原有 FlakyLinkTransport 不受影响 ─────────── */
describe('FlakyLinkTransport 回归：断网续跑（纯内存，不依赖 ACP SDK）', () => {
  it('端到端：propose → suspended → resume → completed + offline_gap', async () => {
    const bus = new MessageBus();
    const cloudT = new FlakyLinkTransport(bus);
    const edgeT = new FlakyLinkTransport(bus);
    const cloud = new XepAgent({
      agentId: 'cloud', clock,
      capability: { agent_id: 'cloud', level: 2, mask: defaultMaskForLevel(2) },
      transport: cloudT,
    });
    const edge = new XepAgent({
      agentId: 'edge', clock,
      capability: { agent_id: 'edge', level: 1, mask: defaultMaskForLevel(1) },
      transport: edgeT,
    });
    cloud.start(); edge.start();
    cloud.sendHello('edge'); edge.sendHello('cloud');
    await sleep(20);

    await cloud.proposeGoal('edge', { goal_id: 'g-fl-01', state: 'pending', priority: 100, payload: { type: 'test' } });
    await sleep(20);
    expect(edge.goalStore.get('g-fl-01')?.state).toBe('running');

    cloudT.setLinkState('offline'); edgeT.setLinkState('offline');
    await sleep(20);
    expect(cloud.goalStore.get('g-fl-01')?.state).toBe('suspended');

    cloudT.setLinkState('online'); edgeT.setLinkState('online');
    await sleep(20);
    expect(edge.goalStore.get('g-fl-01')?.state).toBe('running');

    await edge.completeGoal('g-fl-01');
    await sleep(20);
    expect(cloud.goalStore.get('g-fl-01')?.state).toBe('completed');
    expect(edge.traceLog.some((t) => t.offline_gap !== undefined)).toBe(true);
  });
});
