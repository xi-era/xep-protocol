# XEP-04 Trace（因果溯源链）

> 从原 `01-core-models.md` 拆分。每一条协议动作都是一条 Trace Event，构成完整事件因果链，支撑工业/IoT/自动驾驶的合规审计。

## 1. 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `trace_id` | string | ✅ | 一条因果链的根 ID（通常 = 根 Goal 的 goal_id） |
| `event_id` | string | ✅ | 本事件唯一 ID |
| `parent_event_id` | string \| null | ✅ | 触发本事件的上游事件。根事件为 `null` |
| `kind` | string | ✅ | 事件分类，见第 2 节 |
| `agent_id` | string | ✅ | 产生事件的 Agent |
| `timestamp` | int (epoch ms) | ✅ | 事件发生时刻 |
| `offline_gap` | object | ⛔ | `{ "from": epoch_ms, "to": epoch_ms }`，记录断网时间窗口。审计时可见任务哪段时间离线执行 |
| `detail` | object | ⛔ | 事件附加信息（goal_id、fact_id 等） |

## 2. 事件分类 `event.kind`

| kind | 含义 |
|---|---|
| `goal-create` | Goal 创建/下发 |
| `goal-split` | Goal 拆分为子任务并委派 |
| `goal-migrate` | Goal 迁移到其他 Agent |
| `goal-suspend` | Goal 进入 suspended（携带 offline_gap 起点或断因） |
| `goal-resume` | Goal 从 suspended 恢复（携带 offline_gap 终点） |
| `goal-complete` / `goal-fail` / `goal-cancel` | 终态事件 |
| `fact-assert` | 新 Fact 声明 |
| `fact-refute` | 事实推翻（引用 refute_of） |
| `agent-offline` / `agent-online` | Agent 链路状态变化 |

## 3. 语义要点

- Trace 事件**随业务报文同路传输**（Envelope 的 `trace` 字段，见 [05-envelope.md](05-envelope.md)），不要求独立通道。
- 每条事件的因果链可向上追溯到根：`parent_event_id` → `event_id` → … → 根事件。
- Trace 不要求全局时钟同步，以各 Agent 本地 `timestamp` 记录，审计方按因果链拓扑排序。
