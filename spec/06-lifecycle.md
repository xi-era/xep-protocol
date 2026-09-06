# XEP-06 Goal 生命周期

> 由原 `03-lifecycle-and-errors.md` 拆分（错误模型独立为 [07-errors.md](07-errors.md)）。

## 1. Goal 状态机

```text
                    ┌──────────────────────────────────────────┐
                    │            cancel（任意态可达）            │
                    ▼                                          │
pending ──effective_time 到──▶ running ──完成──▶ completed      │
                                 │                             │
                                 ├─ 失败 ──▶ failed             │
                                 │           (按 rollback_policy 处理)
                                 ├─ expire_time 到 ──▶ cancelled (GOAL_EXPIRED)
                                 │
                                 └─ 链路断 / Agent 离线 ──▶ suspended ──恢复──▶ running
                                                            （断点续跑，progress 保留）
```

### 1.1 状态定义

| 状态 | 含义 |
|---|---|
| `pending` | 已接收，等待 `effective_time` 生效 |
| `running` | 执行中 |
| `suspended` | **挂起**：因链路断开、对方 Agent 离线、或显式暂停。上下文（`progress`）保留，等待恢复 |
| `completed` | 成功完成 |
| `failed` | 执行失败（业务性失败，非网络原因） |
| `cancelled` | 被取消（cancel 指令或 `GOAL_EXPIRED`） |

### 1.2 核心规则：suspended ≠ failed

> **网络不通不产生业务错误。** Goal 进入 `suspended` 挂起状态，而不是直接失败。这是 XEP 区别于绝大多数 Agent 协议（请求-响应模型）的核心特性。

1. 链路断开 / 对端 Agent 不可达时：执行方（或发起方视角）将 Goal 置为 `suspended`，产生 `goal-suspend` Trace 事件。
2. 挂起期间：`progress` 断点上下文必须保留（内存或持久化由实现分级决定，见 [09-conformance-levels.md](09-conformance-levels.md)）。
3. 链路恢复 / Agent 上线：Goal 自动回 `running`，产生 `goal-resume` 事件（携带 `offline_gap` 窗口），从 `progress` 断点继续，**不重放、不推倒重来**。
4. 挂起不重置 `expire_time`：若恢复时已过 `expire_time`，转 `cancelled`（`GOAL_EXPIRED`）。
5. 对端无 `offline_suspend` 能力（Capability Mask 未置位）时，发起方在 Goal 下发前即知道：断网按 `failed` 处理。是否下发由发起方决定。

### 1.3 状态流转合法性表

| from \ event | activate | suspend | resume | complete | fail | expire | cancel |
|---|---|---|---|---|---|---|---|
| `pending` | → running | → suspended | — | — | → failed | → cancelled | → cancelled |
| `running` | — | → suspended | — | → completed | → failed | → cancelled | → cancelled |
| `suspended` | — | — | → running | — | — | → cancelled | → cancelled |
| `completed` / `failed` / `cancelled` | 终态，所有事件非法 | | | | | | |

非法流转必须拒绝且不改变状态。

## 2. 子任务分发与聚合（goal-split）✅ v0.3 已实现

1. 主 Agent 将大目标拆为多个子 Goal（新 `goal_id`），Trace 记 `goal-split` 事件（`parent_event_id` 指向拆分决策事件）。
2. 子 Goal 下发遵循与普通 Goal 相同的状态机。
3. 聚合与失败策略：
   - 子 Goal `failed` 时按父 Goal 的 `rollback_policy` 处理：`none`（忽略）/ `local-rollback`（本机撤销已执行副作用）/ `distributed-rollback`（向相关子 Goal 发送补偿 Goal，高阶能力）。
   - 部分子 Goal `suspended` 时，父 Goal 允许保持 `running` 等待，或按业务自行 `cancel`——协议不做强制。

> **参考实现**：`XepAgent.splitGoal(parentGoalId, children[])` — 子 Goal 设 `parent_goal_id`，Trace 记 `goal-split`；`GoalStore.checkAggregate` 监听子 Goal 终态自动聚合父 Goal。
