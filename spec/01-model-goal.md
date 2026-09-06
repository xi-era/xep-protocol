# XEP-01 Goal（目标，一等公民）

> 从原 `01-core-models.md` 拆分。Goal 是 XEP 的一等公民，**不是函数调用**。目标可跨设备迁移、可休眠、可断点续跑。状态机与断网语义见 [06-lifecycle.md](06-lifecycle.md)。

## 1.1 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `goal_id` | string | ✅ | 目标唯一 ID（发起方生成，UUID 或等价物） |
| `state` | string | ✅ | 生命周期状态，见 [06-lifecycle.md](06-lifecycle.md) |
| `priority` | int 0–255 | ✅ | 优先级。边缘设备资源调度依据；低算力设备可直接丢弃低优先级 Goal。数值越大优先级越高，默认 128 |
| `effective_time` | int (epoch ms) | ⛔ | 生效时间。支持「未来触发任务」，离线设备重启后自动判断是否执行 |
| `expire_time` | int (epoch ms) | ⛔ | 过期时间。到达后放弃执行，转 `cancelled`（`GOAL_EXPIRED`） |
| `migration_hint` | string | ⛔ | `allowed` / `forbidden`。绑定本地硬件传感器的目标禁止迁移 |
| `rollback_policy` | string | ⛔ | `none`（默认）/ `local-rollback` / `distributed-rollback`（高阶能力，minimal 可忽略） |
| `payload` | object | ✅ | 目标业务内容（执行什么），对 XEP 不透明 |
| `progress` | object | ⛔ | 断点续跑上下文。由执行方维护，`suspended` 时保留，恢复后从暂停点继续 |
| `signature` | string | ⛔ | 发起方签名，见 [08-security.md](08-security.md) |
| `ext` | object | ⛔ | 厂商私有扩展。未知实现必须忽略 |

## 1.2 语义要点

- **priority 舍取**：资源不足时，Agent 本地逻辑按 priority 取舍，协议不规定调度算法（不做调度器）。
- **migration_hint**：迁移是显式授权行为，未声明 `allowed` 的 Goal 不得被转发给其他 Agent。
- **progress**：是「断网续跑」的载体。Goal 挂起恢复不靠重放，靠 `progress` 中执行方自报的断点。
