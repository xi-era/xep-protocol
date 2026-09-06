# XEP-07 XEP 业务错误模型（v1.0 冻结）

> 由原 `03-lifecycle-and-errors.md` 拆分（状态机见 [06-lifecycle.md](06-lifecycle.md)）。
> XEP 错误码空间**独立于 ACP 传输层错误码**（ACP 报网络/寻址/解析错误，XEP 报业务错误），见 [05-envelope.md](05-envelope.md) 第 5 节。
>
> ⚠ **冻结声明（v1.0）**：以下错误码已定稿，新增码只增不改，已有码不得修改语义。未来版本如需扩展，只在枚举末尾追加新值。

## 1. 错误码注册表

| 错误码 | 含义 | 触发方行为 |
|---|---|---|
| `GOAL_REJECTED` | 接收方 Capability Mask / ACL 不支持该目标 | 拒绝，Goal 不进入生命周期 |
| `GOAL_EXPIRED` | 到达 `expire_time` 放弃执行 | Goal → `cancelled` |
| `FACT_CONFLICT` | 观测事实冲突（提示性错误，非失败） | 账本同时保留冲突 Fact，交上层仲裁 |
| `AGENT_OFFLINE_UNREACHABLE` | 目标无法投递/迁移 | **不失败**：Goal → `suspended`，等待上线 |
| `KIND_UNSUPPORTED` | 收到无法识别的 `kind` | 回 error 报文，不断链 |
| `VERSION_UNSUPPORTED` | 主版本不兼容 | 回 error 报文 |
| `SIGNATURE_INVALID` | 验签失败（Level-2 强制） | 拒收该报文 |
| `ACL_DENIED` | 违反 Capability-ACL（高危目标、越权 Fact） | 拒绝并回 error |
| `MIGRATION_FORBIDDEN` | Goal 迁移被禁止（migration_hint: forbidden） | 拒绝迁移 |

## 2. 错误报文结构

```jsonc
// kind: "error"
{
  "payload": {
    "code": "GOAL_REJECTED",
    "goal_id": "g-...",          // 可选，关联目标
    "fact_id": "f-...",          // 可选，关联事实
    "message": "capability mask lacks offline_suspend"
  }
}
```

`error` 报文必须复用所响应报文的 `trace_id`，使错误落入同一因果链。
