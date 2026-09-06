# XEP-03 Agent-Capability（能力声明与裁剪）

> 从原 `01-core-models.md` 拆分。每个 Agent 对外宣告自己支持哪些 XEP 能力子集。发起方收到掩码后**自动裁剪报文**，不会下发对方不支持的字段——解决「云端完整报文发给 8 位单片机导致解析崩溃」。

## 1. Capability Mask 位标志

| bit | 标志 | 含义 |
|---|---|---|
| 0 | `goal_basic` | Goal 基础生命周期（propose/update/cancel）【所有级别必选】 |
| 1 | `goal_migrate` | 支持 Goal 迁移 |
| 2 | `fact_ledger` | 支持接收/维护 Fact 陈述 |
| 3 | `offline_suspend` | 支持断网 suspended 挂起与恢复 |
| 4 | `distributed_rollback` | 支持分布式回滚 |
| 5 | `signature` | 支持签名与验签 |
| 6 | `acl` | 支持 Capability-ACL 声明 |

Mask 用 `int` 位或 `string[]` 标志名列表传输（实现自选，推荐 string[] 以利于人读与扩展）。

## 2. Capability 声明结构

```jsonc
{
  "agent_id": "edge-gateway-01",
  "level": 1,                       // 实现分级 0/1/2，见 09-conformance-levels.md
  "mask": ["goal_basic", "offline_suspend", "fact_ledger"],
  "acl": {                          // 仅声明 acl 能力时出现
    "accepted_goal_types": ["sensor-read", "firmware-config"],
    "writable_fact_about": ["sensor/*"],
    "denied_goal_types": ["reboot", "io-rewrite"]
  },
  "ext": {}
}
```

## 3. 裁剪规则

1. 发送前，发送方用接收方 mask **剔除**对方不支持的模型字段（例：对方无 `fact_ledger`，则不发送 `fact.assert`；对方无 `offline_suspend`，断网时 Goal 直接按 failed 处理并告知发起方）。
2. 接收方遇到 mask 内没有的能力字段时：**忽略不崩溃**（parse-and-preserve，见 [05-envelope.md](05-envelope.md)）。
3. 双方能力通过 `capability.hello` 报文交换（见 [05-envelope.md](05-envelope.md)）。
