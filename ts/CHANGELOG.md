# Changelog

## [1.0.0] - 2026-09-06

### Changed
- **协议版本冻结**：`xep_version: "0.1"` → `"1.0"`（正式版）
- **Spec 冻结**：`XEP-v0.1（草案）` → `XEP-v1.0（正式）`
- **错误码注册表冻结**：9 个错误码定稿，新增码只增不改

### Added
- **C↔TS 互通验证**：Level-0 C 实现解析 TS 生成的 Envelope（25 个 C 测试全绿）
- **版本检查升级**：C 实现支持 XEP-0.x 和 XEP-1.x

## [0.2.0] - 2026-09-06

### Added
- **AcpSdkAdapter**：XepTransport 的真实 ACP 实现，兼容 `@xi-era/acp-sdk@0.1.0` ~ `0.2.0`
  - 服务端注册 `xep.gateway` 元件接收 XEP-Envelope
  - 客户端按 agent_id→URL 映射维护 AcpClient 连接池
  - 程序化断网 `setLinkState()` + 被动检测（call 抛连接错误自动进入 offline）
  - peerDependency `@xi-era/acp-sdk >= 0.1.0`
- **双进程 WS Demo**：`examples/offline-goal-demo/`（cloud-ws.mjs + edge-ws.mjs + demo-ws.mjs 编排器）
- **Spec 修订**：`05-envelope.md` §5 从假设的 `ACP message { to/from }` 修正为真实 API `AcpRequest { acp, id, op, component, input }`
- **集成测试**：`acp-sdk-adapter.test.ts`（真实 AcpServer + AcpClient WS 传输）

### Changed
- README 更新 adapter 示例为真实 ACP API
- ROADMAP.md v0.2 标记完成

## [0.1.1] - 2026-09-06

### Added
- **goal-split 子任务分发与聚合**：`splitGoal(parentId, children[])` + `GoalStore.checkAggregate`
- **goal.migrate 目标迁移**：`migrateGoal(goalId, toAgentId)` + dispatch `goal.migrate`
- **effective_time Scheduler**：`startScheduler(intervalMs)` / `stopScheduler()`
- **FACT_CONFLICT 事件上报**：向被引用旧 fact 的 source_agent 发 `trace.append`
- **MIGRATION_FORBIDDEN** 错误码
- 10 个新测试（goal-split / goal-migrate / scheduler / fact-conflict-report）

## [0.1.0] - 2026-09-06

### Added
- **Spec 规范**（12 份文档）：00-overview / 01-04 模型 / 05-envelope / 06-lifecycle / 07-errors / 08-security / 09-conformance / 10-wire-examples / conformance-checklist
- **TypeScript 参考实现**（`@xi-era/xep-core`）：
  - XEP-Envelope 编解码（parse-and-preserve）
  - 4 个核心模型：Goal / Fact / Capability / Trace
  - XepAgent 运行时：能力握手、ACL/签名校验、断网 suspended/恢复续跑
  - Transport 适配层：InMemoryTransport / FlakyLinkTransport
  - NoopSigner + ExternalKeySigner（可插拔签名）
- **断网续跑 Demo**：单进程内存版（demo.mjs）
- **40 个单元测试**：Goal 状态机 / Envelope 解析 / Capability 裁剪 / Fact 追加式 / Agent 运行时
