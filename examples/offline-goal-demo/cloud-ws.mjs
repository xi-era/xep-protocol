/**
 * 云端 Agent（v0.2 真实 WS 版）
 * AcpServer 监听 port，通过 AcpClient 向 edge 下发 Goal，接收 Fact 回传。
 *
 * 由 demo-ws.mjs 通过 child_process.fork() 启动，进程间通过 process.send/on('message') 协调。
 */
import {
  AcpSdkAdapter, XepAgent, defaultMaskForLevel,
} from '../../ts/dist/index.js';

const PORT = Number(process.env.PORT ?? 9002);
const EDGE_PORT = Number(process.env.EDGE_PORT ?? 9001);
const GOAL_ID = process.env.GOAL_ID ?? 'g-ws-01';

const log = (...args) => process.send?.({ type: 'log', args }) ?? console.log('[cloud]', ...args);

/* ── adapter ── */
const adapter = new AcpSdkAdapter({
  agentId: 'cloud-agent-01',
  port: PORT,
  peers: { 'edge-gateway-01': `ws://localhost:${EDGE_PORT}/acp` },
});

const agent = new XepAgent({
  agentId: 'cloud-agent-01',
  capability: { agent_id: 'cloud-agent-01', level: 2, mask: defaultMaskForLevel(2) },
  transport: adapter,
  clock: () => Date.now(),
});

agent.start();

/* ── 事件监听：向父进程报告关键事件 ── */
agent.onEvent((e) => {
  if (e.type === 'goal-state') process.send?.({ type: 'goal-state', goalId: e.goal.goal_id, state: e.goal.state, detail: e.detail });
  if (e.type === 'fact') process.send?.({ type: 'fact', factId: e.fact.fact_id, statement: e.fact.statement, confidence: e.fact.confidence });
  if (e.type === 'error-sent') process.send?.({ type: 'error', code: e.error.code, message: e.error.message });
});

/* ── 启动 ── */
await adapter.start();
log(`cloud AcpServer listening on port ${PORT}`);

/* ── 等待父进程指令 ── */
process.on('message', async (msg) => {
  if (msg.type === 'send-hello') {
    agent.sendHello('edge-gateway-01');
    log('sent capability.hello to edge');
  }
  if (msg.type === 'propose-goal') {
    await agent.proposeGoal('edge-gateway-01', {
      goal_id: msg.goalId ?? GOAL_ID,
      state: 'pending',
      priority: 200,
      payload: { type: 'sensor-monitor', sensor: 'thermo-01', interval_ms: 120 },
    });
    log(`proposed goal ${msg.goalId ?? GOAL_ID} to edge`);
  }
  if (msg.type === 'set-link') {
    adapter.setLinkState(msg.state);
    log(`link state → ${msg.state}`);
  }
  if (msg.type === 'shutdown') {
    await adapter.shutdown();
    process.exit(0);
  }
});

process.send?.({ type: 'ready' });
