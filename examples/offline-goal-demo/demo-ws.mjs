/**
 * v0.2 双进程 Demo 编排器：云端 + 边缘走真实 ACP WebSocket 传输，断网续跑。
 *
 * 流程：
 *  1. fork edge 进程（先启动，等 cloud 连接）
 *  2. fork cloud 进程
 *  3. 双方 capability.hello 握手
 *  4. cloud 下发 goal.propose → edge 接收执行（sensor-monitor）
 *  5. 程序化断网（setLinkState offline）→ 双方 suspended，edge 缓存 fact.assert
 *  6. 恢复链路 → offline_gap 记录，fact 补投，goal completed
 *
 * 运行：cd ts && npm run build && node ../examples/offline-goal-demo/demo-ws.mjs
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (tag, ...args) => console.log(`[${tag}]`, ...args);
const banner = (t) => console.log(`\n━━━━━━━━━━ ${t} ━━━━━━━━━━`);

/* ── fork 子进程 ── */
function startAgent(script, env = {}) {
  return new Promise((resolve) => {
    const child = fork(join(__dirname, script), {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    const messages = [];
    child.on('message', (msg) => {
      messages.push(msg);
      if (msg.type === 'ready') resolve({ child, messages });
    });
    child.stdout?.on('data', (d) => log(script.replace('.mjs', ''), d.toString().trim()));
    child.stderr?.on('data', (d) => log(script.replace('.mjs', '') + '!', d.toString().trim()));
  });
}

/* ── 主流程 ── */
banner('v0.2 双进程 Demo（真实 ACP WebSocket 传输）');

const edge = await startAgent('edge-ws.mjs');
log('edge', `edge 进程就绪 (pid=${edge.child.pid})`);

const cloud = await startAgent('cloud-ws.mjs');
log('cloud', `cloud 进程就绪 (pid=${cloud.child.pid})`);

/* ── 事件收集器（从一开始就监听） ── */
const cloudGoalStates = [];
const edgeGoalStates = [];
const cloudFacts = [];
const edgeLinks = [];

cloud.child.on('message', (m) => {
  if (m.type === 'goal-state' && m.goalId === 'g-ws-01') cloudGoalStates.push(m.state);
  if (m.type === 'fact') cloudFacts.push(m.factId);
  if (m.type === 'error') log('cloud-error', m.code, m.message);
});
edge.child.on('message', (m) => {
  if (m.type === 'goal-state' && m.goalId === 'g-ws-01') edgeGoalStates.push(m.state);
  if (m.type === 'link') edgeLinks.push(m.link);
  if (m.type === 'error') log('edge-error', m.code, m.message);
});

// 1. 能力握手
banner('① 能力握手（capability.hello via ACP WS）');
cloud.child.send({ type: 'send-hello' });
edge.child.send({ type: 'send-hello' });
await sleep(300);

// 2. 云端下发 Goal
banner('② 云端下发 Goal（goal.propose via ACP WS）');
cloud.child.send({ type: 'propose-goal', goalId: 'g-ws-01' });
await sleep(500);

// 3. 断网
banner('③ ⚠ 链路中断（setLinkState offline）');
cloud.child.send({ type: 'set-link', state: 'offline' });
edge.child.send({ type: 'set-link', state: 'offline' });
await sleep(600); // 离线期间 edge 继续观测，fact 进入 outbox

// 4. 恢复
banner('④ 链路恢复 → 断点续跑');
cloud.child.send({ type: 'set-link', state: 'online' });
edge.child.send({ type: 'set-link', state: 'online' });
await sleep(1200); // 等待补投 + goal 完成

// 5. 验收
banner('⑤ 验收结果');
log('cloud goal 终态', cloudGoalStates.join(' → '));
log('edge  goal 终态', edgeGoalStates.join(' → '));
log('cloud 收到 fact 数', cloudFacts.length, cloudFacts.length >= 3 ? '✅' : '❌');
log('cloud facts', cloudFacts.join(', '));
log('edge link 事件', edgeLinks.join(', '));

banner('Demo 完成（真实 ACP WebSocket 传输）');

// 清理
cloud.child.send({ type: 'shutdown' });
edge.child.send({ type: 'shutdown' });
await sleep(200);
cloud.child.kill();
edge.child.kill();
process.exit(0);
