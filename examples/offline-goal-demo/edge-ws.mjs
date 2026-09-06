/**
 * 边缘网关 Agent（v0.2 真实 WS 版）
 * AcpServer 监听 port，接收 cloud 下发的 Goal，本地执行传感器监测，回传 Fact。
 *
 * 由 demo-ws.mjs 通过 child_process.fork() 启动。
 */
import {
  AcpSdkAdapter, XepAgent, defaultMaskForLevel,
} from '../../ts/dist/index.js';

const PORT = Number(process.env.PORT ?? 9001);
const CLOUD_PORT = Number(process.env.CLOUD_PORT ?? 9002);

const log = (...args) => process.send?.({ type: 'log', args }) ?? console.log('[edge]', ...args);

/* ── adapter ── */
const adapter = new AcpSdkAdapter({
  agentId: 'edge-gateway-01',
  port: PORT,
  peers: { 'cloud-agent-01': `ws://localhost:${CLOUD_PORT}/acp` },
});

const agent = new XepAgent({
  agentId: 'edge-gateway-01',
  capability: { agent_id: 'edge-gateway-01', level: 1, mask: defaultMaskForLevel(1) },
  transport: adapter,
  clock: () => Date.now(),
});

agent.start();

/* ── 事件监听 ── */
agent.onEvent((e) => {
  if (e.type === 'goal-state') process.send?.({ type: 'goal-state', goalId: e.goal.goal_id, state: e.goal.state, detail: e.detail });
  if (e.type === 'fact') process.send?.({ type: 'fact', factId: e.fact.fact_id, statement: e.fact.statement });
  if (e.type === 'link') process.send?.({ type: 'link', link: e.link });
  if (e.type === 'error-sent') process.send?.({ type: 'error', code: e.error.code, message: e.error.message });
});

/* ── 传感器执行器：目标生效后每隔 120ms 读一次温度 ── */
let readingCount = 0;
let intervalHandle = null;

agent.onGoal(async (goal) => {
  if (intervalHandle) return; // 避免重复启动
  log(`goal ${goal.goal_id} 生效，开始监测 sensor/thermo-01`);
  intervalHandle = setInterval(() => {
    readingCount += 1;
    const celsius = 26 + Math.round(Math.random() * 40) / 10;
    const factId = `f-${String(readingCount).padStart(4, '0')}`;
    void agent.assertFact('cloud-agent-01', {
      fact_id: factId,
      about: 'sensor/thermo-01/temperature',
      statement: { celsius },
      confidence: 0.95,
      time_anchor: Date.now(),
      source_agent: 'edge-gateway-01',
    });
    log(`观测 #${readingCount}: ${celsius}°C → fact.assert ${adapter.isOffline ? '（outbox 缓存）' : '（已发送）'}`);
    if (readingCount >= 4) {
      clearInterval(intervalHandle);
      intervalHandle = null;
      void agent.completeGoal(goal.goal_id, { last_read_ms: Date.now() }).then(() => {
        log(`目标 ${goal.goal_id} 执行完毕 → completed`);
      });
    }
  }, 120);
});

/* ── 启动 ── */
await adapter.start();
log(`edge AcpServer listening on port ${PORT}`);

/* ── 等待父进程指令 ── */
process.on('message', async (msg) => {
  if (msg.type === 'send-hello') {
    agent.sendHello('cloud-agent-01');
    log('sent capability.hello to cloud');
  }
  if (msg.type === 'set-link') {
    adapter.setLinkState(msg.state);
    log(`link state → ${msg.state}`);
  }
  if (msg.type === 'shutdown') {
    if (intervalHandle) clearInterval(intervalHandle);
    await adapter.shutdown();
    process.exit(0);
  }
});

process.send?.({ type: 'ready' });
