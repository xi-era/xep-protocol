/**
 * XEP-07 §1 — XEP 业务错误模型（v1.0 冻结）。
 * XEP 错误码空间独立于 ACP 传输层错误码（ACP 报网络/寻址/解析错误，XEP 报业务错误）。
 *
 * ⚠ 冻结声明（v1.0）：以下错误码已定稿，新增码只增不改，已有码不得修改语义。
 * 未来版本如需扩展，只在枚举末尾追加新值。
 */

export enum XepErrorCode {
  /** 接收方 Capability Mask / ACL 不支持该目标，Goal 不进入生命周期 */
  GOAL_REJECTED = 'GOAL_REJECTED',
  /** 到达 expire_time 放弃执行，Goal → cancelled */
  GOAL_EXPIRED = 'GOAL_EXPIRED',
  /** 观测事实冲突（提示性，非失败）。账本同时保留冲突 Fact，交上层仲裁 */
  FACT_CONFLICT = 'FACT_CONFLICT',
  /** 目标无法投递/迁移。不失败：Goal → suspended，等待上线 */
  AGENT_OFFLINE_UNREACHABLE = 'AGENT_OFFLINE_UNREACHABLE',
  /** 收到无法识别的 kind。回 error 报文，不断链 */
  KIND_UNSUPPORTED = 'KIND_UNSUPPORTED',
  /** 主版本不兼容 */
  VERSION_UNSUPPORTED = 'VERSION_UNSUPPORTED',
  /** 验签失败（Level-2 强制），拒收该报文 */
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  /** 违反 Capability-ACL（高危目标、越权 Fact） */
  ACL_DENIED = 'ACL_DENIED',
  /** Goal 迁移被禁止（migration_hint: forbidden） */
  MIGRATION_FORBIDDEN = 'MIGRATION_FORBIDDEN',
}

export interface XepErrorPayload {
  code: XepErrorCode;
  /** 关联目标，可选 */
  goal_id?: string;
  /** 关联事实，可选 */
  fact_id?: string;
  message: string;
}

export class XepError extends Error {
  readonly code: XepErrorCode;
  readonly goalId?: string;
  readonly factId?: string;

  constructor(code: XepErrorCode, message: string, opts?: { goalId?: string; factId?: string }) {
    super(`[${code}] ${message}`);
    this.name = 'XepError';
    this.code = code;
    this.goalId = opts?.goalId;
    this.factId = opts?.factId;
  }

  toPayload(): XepErrorPayload {
    return { code: this.code, goal_id: this.goalId, fact_id: this.factId, message: this.message };
  }
}
