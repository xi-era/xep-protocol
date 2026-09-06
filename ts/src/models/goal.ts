/**
 * XEP-01 §1 — Goal（目标，一等公民）与状态机。
 * 核心规则（XEP-06 §1.2）：网络不通不产生业务错误，Goal 转 suspended 而非 failed。
 */
import { XepError, XepErrorCode } from '../errors.js';

export type GoalState = 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';

export type MigrationHint = 'allowed' | 'forbidden';
export type RollbackPolicy = 'none' | 'local-rollback' | 'distributed-rollback';

export interface Goal {
  goal_id: string;
  state: GoalState;
  /** 优先级 0–255，数值越大越高，默认 128。低算力设备可直接丢弃低优先级 Goal */
  priority: number;
  /** 生效时间 (epoch ms)，可选。支持「未来触发任务」 */
  effective_time?: number;
  /** 过期时间 (epoch ms)，可选。到达后 → cancelled (GOAL_EXPIRED) */
  expire_time?: number;
  migration_hint?: MigrationHint;
  rollback_policy?: RollbackPolicy;
  /** 目标业务内容，对 XEP 不透明 */
  payload: Record<string, unknown>;
  /** 断点续跑上下文，执行方维护；suspended 时保留，恢复后从暂停点继续 */
  progress?: Record<string, unknown>;
  /** 父 Goal ID（子任务分发时由 splitGoal 设置） */
  parent_goal_id?: string;
  /** 子 Goal ID 列表（splitGoal 时填充） */
  children?: string[];
  signature?: string;
  /** 厂商私有扩展，未知实现必须忽略 */
  ext?: Record<string, unknown>;
}

/** 状态流转事件（XEP-06 §1.3 合法性表的列） */
export type GoalTransitionEvent =
  | 'activate'
  | 'suspend'
  | 'resume'
  | 'complete'
  | 'fail'
  | 'expire'
  | 'cancel';

/** XEP-06 §1.3 状态流转合法性表 */
const TRANSITIONS: Record<GoalState, Partial<Record<GoalTransitionEvent, GoalState>>> = {
  pending: { activate: 'running', suspend: 'suspended', fail: 'failed', expire: 'cancelled', cancel: 'cancelled' },
  running: { suspend: 'suspended', complete: 'completed', fail: 'failed', expire: 'cancelled', cancel: 'cancelled' },
  suspended: { resume: 'running', expire: 'cancelled', cancel: 'cancelled' },
  completed: {},
  failed: {},
  cancelled: {},
};

export const GOAL_STATES: readonly GoalState[] = ['pending', 'running', 'suspended', 'completed', 'failed', 'cancelled'];

export function isValidGoalState(s: unknown): s is GoalState {
  return typeof s === 'string' && (GOAL_STATES as readonly string[]).includes(s);
}

/**
 * 计算状态流转结果。非法流转返回 null（调用方必须拒绝且不改变状态）。
 * 纯函数，不修改入参。
 */
export function transitionGoal(from: GoalState, event: GoalTransitionEvent): GoalState | null {
  return TRANSITIONS[from][event] ?? null;
}

/** 对 Goal 做状态流转；非法流转抛 XepError，合法则返回 state 已更新的浅拷贝。 */
export function applyGoalTransition(goal: Goal, event: GoalTransitionEvent, progress?: Record<string, unknown>): Goal {
  const next = transitionGoal(goal.state, event);
  if (next === null) {
    throw new XepError(XepErrorCode.GOAL_REJECTED, `illegal transition: ${goal.state} --${event}-->`, {
      goalId: goal.goal_id,
    });
  }
  return { ...goal, state: next, progress: progress ?? goal.progress };
}

/** 到达 expire_time 即放弃执行（挂起恢复后也要检查，见 XEP-06 §1.2 规则 4） */
export function isGoalExpired(goal: Goal, now: number): boolean {
  return goal.expire_time !== undefined && now > goal.expire_time;
}

/** 是否到达 effective_time */
export function isGoalEffective(goal: Goal, now: number): boolean {
  return goal.effective_time === undefined || now >= goal.effective_time;
}
