/**
 * XEP 断网续跑最小 Demo（MVP 验收场景，对应 spec/10-wire-examples.md）
 *
 *  流程：云端下发 Goal → 边缘开始执行 → 链路中断（Goal suspended，不失败）
 *      → 边缘离线期间继续观测（fact.assert 缓存在 outbox）
 *      → 链路恢复（offline_gap 记录，缓存补投，Goal 续跑）→ completed
 *
 *  运行：cd ts && npm run build && node ../examples/offline-goal-demo/demo.mjs
 */
import {
  MessageBus, FlakyLinkTransport, XepAgent, defaultMaskForLevel,
} from '../../ts/dist/index.js';

const log = (...args) => console.log(...args);
const banner = (t) => log(`\n━━━━━━━━━━ ${t} ━━━━━━━━━━`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let clock = Date.now();

/* ───────────── 1. 组网：云端 + 边缘网关，链路可断 ───────────── */
const bus = new MessageBus();
const cloudT = new FlakyLinkTransport(bus);
const edgeT = new FlakyLinkTransport(bus);

const cloud = new XepAgent({
  agentId: 'cloud-agent-01',
  capability: { agent_id: 'cloud-agent-01', level: 2, mask: defaultMaskForLevel(2) },
  transport: cloudT,
  clock: () => clock,
});

const edge = new XepAgent({
  agentId: 'edge-gateway-01',
  // Level-1 Edge：完整 Goal 生命周期 + 断网挂起 + Fact，无签名
  capability: { agent_id: 'edge-gateway-01', level: 1, mask: defaultMaskForLevel(1) },
  transport: edgeT,
  clock: () => clock,
});

cloud.start();
edge.start();

/* ───────────── 2. 能力握手（capability.hello 互换 mask） ───────────── */
cloud.sendHello('edge-gateway-01');
edge.sendHello('cloud-agent-01');
await sleep(20);
banner('能力握手完成');
log('cloud 视角 edge 能力:', cloud.peerOf('edge-gateway-01')?.mask);

/* ───────────── 3. 边缘注册执行器：温度监测（业务逻辑在协议之外） ───────────── */
const GOAL_ID = 'g-temp-01';
let readingCount = 0;
let intervalHandle = null;

edge.onGoal(async (goal) => {
  if (goal.goal_id !== GOAL_ID || intervalHandle) return; // 恢复续跑时避免重复起表
  log(`[edge] 目标生效，开始监测 sensor/thermo-01（priority=${goal.priority}）`);
  intervalHandle = setInterval(() => {
    readingCount += 1;
    const celsius = 26 + Math.round(Math.random() * 40) / 10;
    clock += 1000;
    void edge.assertFact('cloud-agent-01', {
      fact_id: `f-${String(readingCount).padStart(4, '0')}`,
      about: 'sensor/thermo-01/temperature',
      statement: { celsius },
      confidence: 0.95,
      time_anchor: clock,
      source_agent: 'edge-gateway-01',
    });
    log(`[edge] 观测 #${readingCount}: ${celsius}°C → fact.assert ${edgeT.state === 'offline' ? '（链路断，缓存于 outbox）' : '（已发送）'}`);
    if (readingCount >= 4) {
      clearInterval(intervalHandle);
      intervalHandle = null;
      void edge.completeGoal(GOAL_ID, { last_read_ms: clock }).then(() => log('[edge] 目标执行完毕 → completed'));
    }
  }, 120);
});

/* ───────────── 4. 云端观察者 ───────────── */
cloud.onEvent((e) => {
  if (e.type === 'goal-state') log(`[cloud] Goal ${e.goal.goal_id} → ${e.goal.state}${e.detail ? `（${e.detail}）` : ''}`);
  if (e.type === 'fact') log(`[cloud] Fact ${e.fact.fact_id} 入账: ${JSON.stringify(e.fact.statement)} @ confidence=${e.fact.confidence}`);
  if (e.type === 'error-sent') log(`[cloud] 业务错误: ${JSON.stringify(e.error)}`);
});

/* ───────────── 5. 云端下发 Goal ───────────── */
banner('云端下发 Goal');
await cloud.proposeGoal('edge-gateway-01', {
  goal_id: GOAL_ID,
  state: 'pending',
  priority: 200,
  expire_time: clock + 86400000,
  migration_hint: 'allowed',
  rollback_policy: 'none',
  payload: { type: 'sensor-monitor', sensor: 'thermo-01', interval_ms: 120 },
});
await sleep(150);

/* ───────────── 6. 链路中断 → suspended（≠ failed） ───────────── */
banner('⚠ 链路中断（模拟断网）');
cloudT.setLinkState('offline');
edgeT.setLinkState('offline');
await sleep(300); // 离线期间边缘继续观测，报文缓存

banner('链路恢复 → 断点续跑');
cloudT.setLinkState('online');
edgeT.setLinkState('online');
await sleep(400);

/* ───────────── 7. 结果验收 ───────────── */
banner('验收结果');
log('云端 Goal 终态      :', cloud.goalStore.get(GOAL_ID)?.state, '（期望 completed）');
log('边缘 Goal 终态      :', edge.goalStore.get(GOAL_ID)?.state, '（期望 completed）');
log('云端账本 Fact 数    :', cloud.ledger.all().length, '（期望 ≥4，含离线期间补投）');
log('离线观测是否送达    :', cloud.ledger.all().some((f) => f.fact_id === 'f-0002') ? '✅ 已补投' : '❌ 丢失');
const gap = edge.traceLog.find((t) => t.offline_gap);
log('offline_gap 记录    :', gap ? `✅ ${JSON.stringify(gap.offline_gap)}` : '❌ 缺失');

banner('因果链（edge 视角，拓扑排序）');
for (const t of edge.traceLog) {
  log(`  ${t.event_id} ← ${t.parent_event_id ?? 'ROOT'}  ${t.kind.padEnd(14)} ${t.offline_gap ? `offline_gap=[${t.offline_gap.from}→${t.offline_gap.to}]` : ''}`);
}

banner('线上报文样例（goal.propose，与 spec/10-wire-examples.md 对齐）');
// 捕获总线：重放一条 propose 报文并截获其线上 JSON
const captureBus = new MessageBus();
let captured = null;
captureBus.subscribe({ deliver: (m) => (captured = m), send: async () => {}, onMessage: () => {}, publish: () => {} });
const capT = new FlakyLinkTransport(captureBus);
const capAgent = new XepAgent({
  agentId: 'cloud-agent-01',
  capability: { agent_id: 'cloud-agent-01', level: 2, mask: defaultMaskForLevel(2) },
  transport: capT,
  clock: () => 1725500001000,
});
capAgent.start();
capT.onMessage(() => {});
await capAgent.proposeGoal('edge-gateway-01', {
  goal_id: 'g-temp-01', state: 'pending', priority: 200,
  effective_time: 1725500002000, expire_time: 1725586402000,
  migration_hint: 'allowed', rollback_policy: 'none',
  payload: { type: 'sensor-monitor', sensor: 'thermo-01', interval_ms: 1000 },
});
await sleep(20);
log(JSON.stringify(captured?.payload ?? samples, null, 2));

banner('Demo 结束');
process.exit(0);
