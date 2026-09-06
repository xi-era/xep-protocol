/** XEP (Xi-Era Protocol) 曦时代协议 — TypeScript 参考实现公共导出 */

// Envelope（XEP-05）
export { Envelope, EnvelopeKind, XEP_VERSION, KNOWN_KINDS, decodeEnvelope, encodeEnvelope, encodeEnvelopeJson, checkVersion } from './envelope.js';

// 核心模型（XEP-01）
export { Goal, GoalState, GoalTransitionEvent, MigrationHint, RollbackPolicy, GOAL_STATES, isValidGoalState, transitionGoal, applyGoalTransition, isGoalExpired, isGoalEffective } from './models/goal.js';
export { Fact, validateFact } from './models/fact.js';
export { Capability, CapabilityAcl, CapabilityFlag, CAPABILITY_FLAGS, hasCapability, defaultMaskForLevel, aclAllowsGoal, aclAllowsFactAbout, canSendKind } from './models/capability.js';
export { TraceEvent, TraceEventKind, TraceHeader, OfflineGap, traceHeaderToEvent, topologicalSort } from './models/trace.js';

// 错误模型（XEP-07）
export { XepError, XepErrorCode, XepErrorPayload } from './errors.js';

// 安全（XEP-08）
export { Signer, KeyMaterial, NoopSigner, ExternalKeySigner, canonicalEnvelopeBytes } from './security/signer.js';
export { Ed25519KeyMaterial, Ed25519KeyPair } from './security/ed25519-signer.js';

// 传输适配层（对齐 ACP message 形状）
export { XepTransport, AcpMessageShape, LinkState, makeAcpMessage } from './transport/types.js';
export { InMemoryTransport, FlakyLinkTransport, MessageBus } from './transport/mock.js';

/**
 * ACP SDK 真实适配器（peerDependency: @xi-era/acp-sdk）。
 * 运行时按需加载，不在 core 零依赖中引入。
 * 映射规则见 docs/ROADMAP.md 附录 A。
 */
export type { AcpSdkAdapterOptions } from './transport/acp-sdk-adapter.js';
export { AcpSdkAdapter } from './transport/acp-sdk-adapter.js';

// 运行时
export { XepAgent, AgentOptions, AgentEvent, AgentEventType, GoalExecutor } from './runtime/agent.js';
export { GoalStore } from './runtime/goal-store.js';
export { FactLedger, FactConflict } from './runtime/fact-ledger.js';

// 持久化（v0.4）
export { JsonFileStore, JsonFileStoreOptions, createJsonFileStore } from './persistence/index.js';
