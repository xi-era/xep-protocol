# XEP-02 Fact（事实陈述）

> 从原 `01-core-models.md` 拆分。Fact 是**带证据的观测陈述**，不是全局唯一真理。XEP 不内置共识仲裁，多个 Agent 观测冲突时保留全部证据，由上层业务仲裁。

## 1.1 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fact_id` | string | ✅ | 事实唯一 ID（声明方生成） |
| `about` | string | ✅ | 事实主体（URI 或约定标识，如 `sensor/thermo-01/temperature`） |
| `statement` | any | ✅ | 观测值 / 陈述内容 |
| `confidence` | float 0–1 | ✅ | 置信度。来源可以是传感器、模型推理、人工输入 |
| `time_anchor` | int (epoch ms) | ✅ | 事实对应的时间锚点（观测时刻，非上报时刻） |
| `source_agent` | string | ✅ | 来源 Agent 标识 |
| `source_signature` | string | ⛔ | 来源 Agent 签名，防篡改。minimal 设备可省略，full 实现强制校验 |
| `refute_of` | string[] | ⛔ | 引用并推翻的旧 `fact_id` 列表，形成分布式事实辩论链 |
| `evidence` | object | ⛔ | 证据附加信息（原始读数、推理依据等），对 XEP 不透明 |

## 1.2 语义要点

- **追加式**：Fact Ledger 只追加。`refute_of` 通过新增一条 Fact 来推翻旧 Fact，**永不物理删除旧记录**——保留完整冲突证据链。
- **没有仲裁**：两条互相冲突的 Fact 可以同时存在于账本中。谁对谁错由上层应用按 confidence、来源可信度、时间新旧自行裁决。
- **存储分级**：minimal（Level-0）实现可以只在内存保存当前生效 Fact，不持久化；网关/云端节点做持久账本。协议不强制存储。
