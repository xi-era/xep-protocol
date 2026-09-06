# XEP-08 安全模型

> 由原 `04-security.md` 重新编号。传输安全完全继承 ACP 底层（TLS 1.3 等），**XEP 层不重复做加密**。本文档只定义应用层身份、签名与权限。

## 1. 身份与签名

### 1.1 签名范围

Full 实现（Level-2）：**Goal、Fact 必须携带 Agent 身份签名**，防止报文篡改、伪造指令（例：工业设备收到伪造的重启指令）。

### 1.2 分级要求

| 实现级别 | 签名要求 |
|---|---|
| Level-0 Minimal | 允许关闭签名（`NoopSigner`）。**仅限内网可信局域网使用，文档明确警告风险** |
| Level-1 Edge | 签名可选（Capability Mask 中 `signature` 位声明是否启用） |
| Level-2 Full | 签名强制。收到未签名或验签失败的 Goal/Fact 报文必须拒收（`SIGNATURE_INVALID`，见 [07-errors.md](07-errors.md)） |

### 1.3 签名对象

签名覆盖 Envelope 中除 `signature` 字段外的全部语义字段（`xep_version / kind / trace / from / to / timestamp / payload / ext` 的规范化序列化）。规范化算法（JSON 字段排序等）由实现约定并在 `capability.hello` 中宣告算法标识（如 `ed25519-json-canonical`）。

## 2. Capability-ACL（协作权限模型）

每个 Agent 声明权责边界，防止低权限设备被下发高危目标（例：工业设备被下发重启、改写 IO）。

### 2.1 ACL 声明（随 capability.hello 发布）

```jsonc
{
  "accepted_goal_types": ["sensor-read", "firmware-config"],  // 允许接收的 Goal 类型
  "denied_goal_types":   ["reboot", "io-rewrite"],            // 显式禁止（优先于 accepted）
  "writable_fact_about": ["sensor/*"],                        // 允许声明的 Fact 主体模式
  "max_priority": 200                                          // 可选：可接收的最高优先级
}
```

### 2.2 校验规则

1. 发起方下发达 `denied_goal_types` 中的目标 → 接收方回 `ACL_DENIED`，Goal 不进入生命周期。
2. Goal 类型不在 `accepted_goal_types` 且该字段存在 → 同样 `ACL_DENIED`。
3. Fact 的 `about` 不匹配 `writable_fact_about` 模式 → 账本方拒收（`ACL_DENIED`）。
4. ACL 由接收方本地校验，协议不定义中心化授权服务器（P2P 优先）。

## 3. 威胁模型边界（明确不解决）

- **不解决女巫攻击 / 身份信任链**：Agent ID 的可信根（PKI、预共享密钥）是部署方的选择，协议只定义签名携带与校验位置。
- **不做端到端内容加密**：机密性由 ACP 传输层 TLS 保证；多跳场景如需端到端加密属 Future Work。
- **不防恶意仲裁**：Fact 冲突仲裁在上层，协议保证的是证据链完整可审计，不是结论正确。
