# XEP-00 XEP 曦时代协议 Overview（Xi-Era Protocol）

> **一句话定位**：XEP 曦时代协议，是异构智能体如何跨越设备、跨越断网、跨越时间，共同建立对现实世界的认知、协同完成长周期目标的**上层开放语义协议**，构建于 ACP-Protocol 之上。

## 0. 设计本源：借鉴顶级人类理性协作范式

XEP 不是模拟人脑，不模拟情绪、直觉、潜意识。它只萃取顶尖人类理性协作的**外化行为模型**，转化为分布式协议规则：

| 人类理性特质 | XEP 机制 |
|---|---|
| 以终为始，持有长期目标，可暂停/移交/设截止 | Goal 一等公民：`effective_time / expire_time / migration_hint / rollback_policy / priority` |
| 区分客观观测与主观信念，保留证据链 | Fact：`confidence / source_signature / refute_of[]`，追加式不删旧记录 |
| 条件不满足先搁置，条件恢复再继续，不推倒重来 | 断网/离线时 Goal 进入 `suspended` 挂起，恢复后断点续跑 |
| 清晰自知能力边界，按对方能力调整信息复杂度 | Capability Mask + 三级实现分级（Level-0/1/2） |
| 复盘时完整追溯因果链 | Trace：`trace_id / parent_event_id / event.kind / offline_gap` |
| 权责边界清晰，高危指令不能随意下发 | Capability-ACL：约束可接收的 Goal 类型与可写的 Fact 范围 |
| 遇到听不懂的新概念不宕机，忽略未知部分 | parse-and-preserve：未知字段原样忽略透传 |

个体 Agent 可以是大模型，也可以是无 AI 的单片机固件。**协议本身不带智能，只规定群体如何像优秀人类团队一样协作。**

## 1. 层级全景

```text
┌─────────────────────────────────────────────┐
│ XEP 曦时代协议 (Xi-Era Protocol)             │ 【时代级元协同层】
│ Goal 目标、Fact 事实账本、能力裁剪、           │
│ 跨设备长生命周期、因果溯源、ACL                │
├─────────────────────────────────────────────┤
│ ACP-Protocol                                │ 【组件互操作层】
│ 寻址、调用、多路复用、帧封装、传输抽象          │
├─────────────────────────────────────────────┤
│ Transport: TCP+TLS / WebSocket / QUIC / UnixSocket
└─────────────────────────────────────────────┘
```

- **ACP-Protocol**：解决异构组件如何互相呼叫（寻址、投递、传输）。已独立开源（xi-era/acp-protocol, MIT）。
- **XEP**：解决异构智能体如何共同认知世界、协同完成跨越时间与设备的目标。

**核心关系**：`ACP message.payload = XEP-Envelope`。XEP 是 ACP payload 内的上层语义载荷，不改动 ACP 底层报文头、不重新定义传输/帧/握手/粘包处理。

## 2. 差异化支点（对标现存 Agent 协议的缺口）

现存 A2A / Agent 协议大多：面向云上大模型强依赖 GPU；只解决单机/云内互调；不处理离线、断网、低算力固件；任务生命周期绑定进程；缺少统一的事实锚点。

XEP 顶层设计瞄准这五个缺口：

1. **时间-空间-事实三元共识层**：内置轻量事实账本（Fact Ledger），异构 Agent 之间对外部现实状态达成可溯源共识。Fact 是带证据的观测陈述，不是全局唯一真理。
2. **断网友好的长周期目标驱动**：Goal 是一等公民而非函数调用。目标可迁移、可休眠、可断点续跑，设备重启、硬件替换后仍可恢复上下文。
3. **算力自适应降级**：能力裁剪语义（Capability Mask）。同一套规范，云端实现全部能力，8 位单片机只实现最小子集且不会解析崩溃。
4. **因果溯源与可审计协作链**：每一步目标拆分、子任务委派、事实修改都携带签名溯源。
5. **元扩展体系**：不锁死模型（LLM/小模型/无模型固件均可）、不锁死传输（复用 ACP）、不锁死业务（ext 扩展字段）。

## 3. 边界声明（必须随协议发布）

### 3.1 与 ACP 的边界

- ACP 管「怎么把消息可靠送到组件」；XEP 管「Agent 之间如何协同」。
- 只需要组件调用的设备**可以完全不实现 XEP**，只实现 ACP，协议向前兼容。
- XEP 不重复做：传输握手、帧格式、粘包处理、编解码帧（复用 ACP 的 Protobuf/JSON 能力）。

### 3.2 与玄码体系的隔离

| 项目 | 运行域 | 开放属性 | 底层载体 |
|---|---|---|---|
| `xuancode://` | 玄码桌面客户端内部 | 私有应用 URI 路由（类似 `vscode://`） | Electron URI |
| 玄码内部 A2A | 玄码 IDE 沙箱内 Agent | 内部私有接口 | 内部消息总线 |
| **XEP 曦时代协议** | 跨机器 / 边缘 / IoT 工业网络 | **公开 MIT 开放标准** | 构建在 ACP-Protocol 之上 |

- `xuancode://` **不属于** XEP 协议。
- 玄码内部 A2A 是 XEP 的**一个本地实现实例**，可携带私有扩展字段 `xuangcode_ext:{}`；该扩展不属于 XEP 标准，外部实现应当忽略未知扩展字段。
- XEP 的规范、数据结构**不依赖玄码任何代码**。任何设备实现 ACP 报文 + XEP payload 即可接入，不需要安装玄码。

### 3.3 协议中立

XEP 不绑定任何大模型、不绑定玄码、不绑定 xi-era 实现。任何厂商、硬件、语言均可独立实现。

## 4. 协议不做的事（避坑红线）

1. ❌ **不做分布式强共识算法**（Paxos/Raft）。事实冲突交给上层业务仲裁，协议只提供证据陈述结构。
2. ❌ **不内置数据库**。持久化是实现的选择：minimal 设备只在内存保存当前生效 Fact，网关/云端才做持久账本。
3. ❌ **不绑定调度器**。目标调度、分配由 Agent 本地逻辑完成，协议只定义目标描述格式，不定义「该交给谁跑」。
4. ❌ **不做重型中心化服务**。P2P 优先，网关只是可选中间件。
5. ❌ **不做成 SDK 应用框架**。XEP 是协议规范，各语言/硬件厂商独立实现。
6. ❌ **不把玄码 IDE 内部业务带入规范**，所有语义必须脱离桌面客户端独立可用。

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| [01-model-goal.md](01-model-goal.md) | Goal 目标模型：字段、优先级、迁移、回滚策略 |
| [02-model-fact.md](02-model-fact.md) | Fact 事实陈述：置信度、来源签名、refute 辩论链 |
| [03-model-capability.md](03-model-capability.md) | Agent-Capability：能力掩码、ACL、报文裁剪 |
| [04-model-trace.md](04-model-trace.md) | Trace 因果溯源链：事件分类、offline_gap |
| [05-envelope.md](05-envelope.md) | XEP-Envelope 结构、版本策略、扩展字段忽略规则 |
| [06-lifecycle.md](06-lifecycle.md) | Goal 状态机、断网挂起语义、子任务分发 |
| [07-errors.md](07-errors.md) | XEP 业务错误模型 |
| [08-security.md](08-security.md) | 签名模型、Capability-ACL、分级签名要求 |
| [09-conformance-levels.md](09-conformance-levels.md) | Level-0/1/2 实现分级与一致性要求 |
| [10-wire-examples.md](10-wire-examples.md) | JSON 报文完整示例（断网挂起/恢复全流程） |
| [conformance-checklist.md](conformance-checklist.md) | 实现方一致性自检清单 |

## 6. Future Work（v1 不实现）

- Goal 模板系统：下发模板 ID 代替完整报文，节省低带宽 IoT 链路。
- 多 Agent 投票仲裁模型（Fact 冲突解决）。
- XEP over 低带宽无线链路（LoRa 等）的报文压缩子集。

## 7. 版本

当前规范版本：**XEP-v1.0（正式）**。语义版本策略见 [05-envelope.md](05-envelope.md) 第 4 节。

> 许可：MIT。仓库：`xi-era/xep-protocol`。
