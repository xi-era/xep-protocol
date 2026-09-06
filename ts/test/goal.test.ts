import { describe, expect, it } from 'vitest';
import { Goal, GOAL_STATES, applyGoalTransition, isGoalEffective, isGoalExpired, transitionGoal } from '../src/models/goal.js';
import { XepErrorCode } from '../src/errors.js';

const baseGoal: Goal = {
  goal_id: 'g-1',
  state: 'pending',
  priority: 128,
  payload: { type: 'sensor-monitor' },
};

describe('XEP-06 §1.3 状态流转合法性表', () => {
  it('合法流转全部覆盖', () => {
    // pending
    expect(transitionGoal('pending', 'activate')).toBe('running');
    expect(transitionGoal('pending', 'suspend')).toBe('suspended');
    expect(transitionGoal('pending', 'fail')).toBe('failed');
    expect(transitionGoal('pending', 'expire')).toBe('cancelled');
    expect(transitionGoal('pending', 'cancel')).toBe('cancelled');
    // running
    expect(transitionGoal('running', 'suspend')).toBe('suspended');
    expect(transitionGoal('running', 'complete')).toBe('completed');
    expect(transitionGoal('running', 'fail')).toBe('failed');
    expect(transitionGoal('running', 'expire')).toBe('cancelled');
    expect(transitionGoal('running', 'cancel')).toBe('cancelled');
    // suspended —— 核心特性：恢复续跑而非重来
    expect(transitionGoal('suspended', 'resume')).toBe('running');
    expect(transitionGoal('suspended', 'expire')).toBe('cancelled');
    expect(transitionGoal('suspended', 'cancel')).toBe('cancelled');
  });

  it('非法流转返回 null（拒绝且状态不变）', () => {
    expect(transitionGoal('completed', 'activate')).toBeNull();
    expect(transitionGoal('failed', 'complete')).toBeNull();
    expect(transitionGoal('cancelled', 'resume')).toBeNull();
    expect(transitionGoal('pending', 'complete')).toBeNull();
    expect(transitionGoal('pending', 'resume')).toBeNull();
    expect(transitionGoal('suspended', 'activate')).toBeNull();
    expect(transitionGoal('suspended', 'complete')).toBeNull();
    expect(transitionGoal('running', 'resume')).toBeNull();
  });

  it('终态不可离开', () => {
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      for (const event of ['activate', 'suspend', 'resume', 'complete', 'fail', 'expire', 'cancel'] as const) {
        expect(transitionGoal(terminal, event)).toBeNull();
      }
    }
  });

  it('applyGoalTransition 非法流转抛 GOAL_REJECTED 且不改原对象', () => {
    const completed: Goal = { ...baseGoal, state: 'completed' };
    expect(() => applyGoalTransition(completed, 'activate')).toThrowError(expect.objectContaining({ code: XepErrorCode.GOAL_REJECTED }));
    expect(completed.state).toBe('completed');
  });

  it('applyGoalTransition 合法流转返回新对象并保留 progress', () => {
    const running = applyGoalTransition({ ...baseGoal, progress: { last_read_ms: 1 } }, 'activate');
    expect(running.state).toBe('running');
    expect(running.progress).toEqual({ last_read_ms: 1 });
    const suspended = applyGoalTransition(running, 'suspend');
    expect(suspended.state).toBe('suspended');
    // 恢复时更新断点
    const resumed = applyGoalTransition(suspended, 'resume', { last_read_ms: 99 });
    expect(resumed.state).toBe('running');
    expect(resumed.progress).toEqual({ last_read_ms: 99 });
    // 原 goal 未被突变
    expect(baseGoal.state).toBe('pending');
  });

  it('状态集合完整', () => {
    expect(GOAL_STATES).toHaveLength(6);
  });
});

describe('时间语义（XEP-01 §1.1）', () => {
  it('expire_time 判定', () => {
    const g: Goal = { ...baseGoal, expire_time: 1000 };
    expect(isGoalExpired(g, 1000)).toBe(false);
    expect(isGoalExpired(g, 1001)).toBe(true);
    expect(isGoalExpired({ ...baseGoal }, 99999)).toBe(false); // 未设 expire_time 永不过期
  });

  it('effective_time 判定', () => {
    const g: Goal = { ...baseGoal, effective_time: 2000 };
    expect(isGoalEffective(g, 1999)).toBe(false);
    expect(isGoalEffective(g, 2000)).toBe(true);
    expect(isGoalEffective({ ...baseGoal }, 0)).toBe(true);
  });
});
