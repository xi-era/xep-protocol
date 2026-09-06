# XEP 曦时代协议（Xi-Era Protocol）

> **异构智能体如何跨越设备、跨越断网、跨越时间，共同建立对现实世界的认知、协同完成长周期目标。**

XEP 是构建于 [ACP-Protocol](https://github.com/xi-era/acp-protocol) 之上的**上层语义编排协议**（公开 MIT 开放标准）。ACP 解决「组件怎么互相呼叫」，XEP 解决「Agent 群体如何像优秀人类团队一样协作」。

```text
┌─────────────────────────────────────────────┐
│ XEP 曦时代协议（本仓库）                      │ Goal 目标、Fact 事实账本、能力裁剪、
│                                             │ 跨设备长生命周期、因果溯源、ACL
├─────────────────────────────────────────────┤
│ ACP-Protocol                                │ 寻址、调用、多路复用、帧封装、传输抽象
├─────────────────────────────────────────────┤
│ TCP+TLS / WebSocket / QUIC / UnixSocket     │
└─────────────────────────────────────────────┘
```

## 核心特性

- **Goal 目标是一等公民**，不是函数调用：可暂停、可挂起、可断点续跑、可迁移、带优先级与生效/过期时间。
- **断网挂起 ≠ 失败**：链路中断时 Goal 进入 `suspended`，上下文保留，恢复后从断点自动续跑（绝大多数请求-响应式 Agent 协议作废任务）。
- **Fact 事实账本**：带证据的观测陈述（confidence / source_signature / refute_of[]），追加式保留完整冲突证据链，仲裁交上层。
- **能力裁剪（Capability Mask）**：Agent 宣告能力子集，发送方自动裁剪报文——云端完整报文不会发给 8 位单片机导致解析崩溃。
- **因果溯源（Trace）**：每步操作携带 `trace_id / parent_event_id`，断网窗口记入 `offline_gap`，支撑工业合规审计。
- **parse-and-preserve**：未知字段/未知 kind 忽略透传不崩溃，向前兼容。

## 目录结构

| 路径 | 内容 |
|---|---|
| [spec/](spec/) | 协议规范 v0.1（开篇、核心模型、Envelope、生命周期与错误、安全、一致性分级、报文示例） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 开发路线图（v0.2→v1.0）与 ACP↔XEP 报文映射方案 |
| [ts/](ts/) | TypeScript 参考实现（`@xi-era/xep-core`，零运行时依赖） |
| [examples/offline-goal-demo/](examples/offline-goal-demo/) | 断网续跑最小 Demo（MVP 验收场景） |

## 快速开始

```bash
cd ts
npm install
npm test      # 37 个单元测试
npm run demo  # 断网续跑端到端演示
```

Demo 输出（节选）：

```text
━━━ ⚠ 链路中断（模拟断网）━━━
[cloud] Goal g-temp-01 → suspended（suspended by link loss (not failed)）
[edge] 观测 #2: 26.5°C → fact.assert （链路断，缓存于 outbox）
━━━ 链路恢复 → 断点续跑 ━━━
[cloud] Goal g-temp-01 → running（resumed from progress (offline_gap recorded)）
[cloud] Fact f-0002 入账: {"celsius":26.5} @ confidence=0.95
```

## 三级实现分级

| 能力 | Level-0 Minimal（8位单片机） | Level-1 Edge（边缘网关） | Level-2 Full（云端/企业网关） |
|---|---|---|---|
| Goal 基础生命周期 | ✅ 必须 | ✅ 必须 | ✅ 必须 |
| 断网 suspended 续跑 | ❌ | ✅ 必须 | ✅ 必须 |
| Fact 账本 | ❌ | ✅ 必须 | ✅ 必须（持久化） |
| Trace 溯源 + offline_gap | 部分 | ✅ 必须 | ✅ 必须 |
| 签名 / ACL | ❌（仅限可信内网） | 可选 | ✅ 强制 |
| 分布式回滚 / Goal 迁移 | ❌ | ❌ | 可选 / ✅ |

详见 [spec/09-conformance-levels.md](spec/09-conformance-levels.md)。

## 边界声明

- **XEP 不重新定义传输、帧、握手、粘包处理**，全部复用 ACP。`ACP message.payload = XEP-Envelope`。
- 只需要组件调用的设备**可以完全不实现 XEP**，只实现 ACP。
- XEP 不绑定任何大模型、不绑定玄码、不绑定 xi-era 实现。`xuancode://` 与玄码内部 A2A **不属于** XEP 标准。
- 不做 Paxos/Raft 共识、不内置数据库、不绑定调度器、不做重型中心化服务。

详见 [spec/00-xep-overview.md](spec/00-xep-overview.md) 第 3、4 节。

## 替换为真实 ACP 底层

参考实现的传输通过适配层解耦（[ts/src/transport/types.ts](ts/src/transport/types.ts)），接入真实 [`@xi-era/acp-sdk`](https://github.com/xi-era/acp-protocol) 时只需实现 `XepTransport` 接口作为 adapter，runtime 与 spec 零改动。ACP↔XEP 报文映射方案见 [docs/ROADMAP.md](docs/ROADMAP.md) 附录 A：

```ts
import { XepTransport } from '@xi-era/xep-core';
import { AcpClient } from '@xi-era/acp-sdk/client';

class AcpSdkAdapter implements XepTransport { /* 包装 AcpClient，component 固定为 xep.gateway */ }
```

## License

MIT
