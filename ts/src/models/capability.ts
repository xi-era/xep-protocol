/**
 * XEP-03 — Agent-Capability（能力声明与裁剪）。
 * 每个 Agent 宣告自己支持的 XEP 能力子集；发送方按对方 mask 裁剪报文，
 * 不会下发对方无法解析的字段 —— 解决云端完整报文发给 8 位单片机导致解析崩溃。
 * 接收方遇到 mask 外字段：忽略不崩溃（parse-and-preserve）。
 */

export const CAPABILITY_FLAGS = [
  'goal_basic',            // Goal 基础生命周期（propose/update/cancel）—— 所有级别必选
  'goal_migrate',          // Goal 迁移
  'fact_ledger',           // 接收/维护 Fact 陈述
  'offline_suspend',       // 断网 suspended 挂起与恢复
  'distributed_rollback',  // 分布式回滚
  'signature',             // 签名与验签
  'acl',                   // Capability-ACL 声明
] as const;

export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

export interface CapabilityAcl {
  /** 允许接收的 Goal 类型（payload.type） */
  accepted_goal_types?: string[];
  /** 显式禁止，优先于 accepted */
  denied_goal_types?: string[];
  /** 允许声明的 Fact 主体模式（如 sensor/*） */
  writable_fact_about?: string[];
  /** 可接收的最高优先级（可选） */
  max_priority?: number;
}

export interface Capability {
  agent_id: string;
  /** 实现分级 0/1/2（XEP-09） */
  level: 0 | 1 | 2;
  mask: CapabilityFlag[];
  acl?: CapabilityAcl;
  /** 支持的 XEP 协议版本列表，双方取共同最高版本 */
  xep_versions?: string[];
  ext?: Record<string, unknown>;
}

export function hasCapability(cap: Capability | undefined, flag: CapabilityFlag): boolean {
  return cap?.mask.includes(flag) ?? false;
}

/** Level → 默认 mask 的参考映射（XEP-09 能力矩阵）。实现可在此基础上增减。 */
export function defaultMaskForLevel(level: 0 | 1 | 2): CapabilityFlag[] {
  switch (level) {
    case 0:
      return ['goal_basic'];
    case 1:
      return ['goal_basic', 'offline_suspend', 'fact_ledger'];
    case 2:
      return [...CAPABILITY_FLAGS];
  }
}

/* ---------------------------------- ACL 校验 ---------------------------------- */

/** Goal 是否被 ACL 允许接收（XEP-08 §2.2）。无 acl 声明 = 不限制。 */
export function aclAllowsGoal(acl: CapabilityAcl | undefined, goalType: string | undefined, priority: number): boolean {
  if (!acl) return true;
  if (acl.max_priority !== undefined && priority > acl.max_priority) return false;
  const denied = acl.denied_goal_types ?? [];
  if (goalType !== undefined && denied.includes(goalType)) return false;
  const accepted = acl.accepted_goal_types;
  if (accepted && (goalType === undefined || !accepted.includes(goalType))) return false;
  return true;
}

/** Fact 主体是否被 ACL 允许写入（简单通配：`sensor/*` 匹配 `sensor/anything`）。 */
export function aclAllowsFactAbout(acl: CapabilityAcl | undefined, about: string): boolean {
  if (!acl || !acl.writable_fact_about) return true;
  return acl.writable_fact_about.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.endsWith('/*')) return about.startsWith(pattern.slice(0, -1));
    return about === pattern;
  });
}

/* --------------------------------- 报文裁剪器 --------------------------------- */

/** Envelope kind 集合 → 所需能力位 */
const KIND_CAPABILITY: Record<string, CapabilityFlag> = {
  'goal.migrate': 'goal_migrate',
  'fact.assert': 'fact_ledger',
  'fact.refute': 'fact_ledger',
  'trace.append': 'fact_ledger', // trace 依赖账本能力，Level-0 不接收
};

/**
 * 按接收方 mask 裁剪：返回该 kind 是否可发送（XEP-03 §3 规则 1）。
 * goal_basic 类报文（goal.propose/update/cancel、capability.hello、error）对任何级别开放。
 */
export function canSendKind(kind: string, receiver: Capability | undefined): boolean {
  const required = KIND_CAPABILITY[kind];
  if (!required) return true;
  return hasCapability(receiver, required);
}
