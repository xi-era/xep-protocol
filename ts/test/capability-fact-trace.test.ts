import { describe, expect, it } from 'vitest';
import { Capability, aclAllowsFactAbout, aclAllowsGoal, canSendKind, defaultMaskForLevel } from '../src/models/capability.js';
import { Fact } from '../src/models/fact.js';
import { FactLedger } from '../src/runtime/fact-ledger.js';
import { topologicalSort, TraceEvent } from '../src/models/trace.js';

describe('XEP-03 Capability Mask 与裁剪', () => {
  it('三级分级默认掩码（XEP-09 能力矩阵）', () => {
    expect(defaultMaskForLevel(0)).toEqual(['goal_basic']);
    expect(defaultMaskForLevel(1)).toEqual(['goal_basic', 'offline_suspend', 'fact_ledger']);
    const l2 = defaultMaskForLevel(2);
    expect(l2).toContain('signature');
    expect(l2).toContain('acl');
    expect(l2).toContain('distributed_rollback');
  });

  it('发送裁剪：Level-0 对端收不了 fact.assert / goal.migrate', () => {
    const l0: Capability = { agent_id: 'mcu', level: 0, mask: defaultMaskForLevel(0) };
    expect(canSendKind('goal.propose', l0)).toBe(true);
    expect(canSendKind('capability.hello', l0)).toBe(true);
    expect(canSendKind('error', l0)).toBe(true);
    expect(canSendKind('fact.assert', l0)).toBe(false);
    expect(canSendKind('fact.refute', l0)).toBe(false);
    expect(canSendKind('goal.migrate', l0)).toBe(false);
    const l1: Capability = { agent_id: 'edge', level: 1, mask: defaultMaskForLevel(1) };
    expect(canSendKind('fact.assert', l1)).toBe(true);
  });
});

describe('XEP-08 §2 Capability-ACL', () => {
  const acl = {
    accepted_goal_types: ['sensor-read', 'firmware-config'],
    denied_goal_types: ['reboot', 'io-rewrite'],
    writable_fact_about: ['sensor/*'],
    max_priority: 200,
  };

  it('denied 优先拒绝（高危目标场景）', () => {
    expect(aclAllowsGoal(acl, 'reboot', 10)).toBe(false);
    expect(aclAllowsGoal(acl, 'io-rewrite', 10)).toBe(false);
  });

  it('accepted 白名单外拒绝', () => {
    expect(aclAllowsGoal(acl, 'sensor-read', 10)).toBe(true);
    expect(aclAllowsGoal(acl, 'unknown-type', 10)).toBe(false);
  });

  it('超优先级拒绝', () => {
    expect(aclAllowsGoal(acl, 'sensor-read', 201)).toBe(false);
    expect(aclAllowsGoal(acl, 'sensor-read', 200)).toBe(true);
  });

  it('无 ACL 声明 = 不限制', () => {
    expect(aclAllowsGoal(undefined, 'reboot', 255)).toBe(true);
    expect(aclAllowsFactAbout(undefined, 'anything')).toBe(true);
  });

  it('Fact 主体通配匹配', () => {
    expect(aclAllowsFactAbout({ writable_fact_about: ['sensor/*'] }, 'sensor/thermo-01/temperature')).toBe(true);
    expect(aclAllowsFactAbout({ writable_fact_about: ['sensor/*'] }, 'actuator/valve-01')).toBe(false);
    expect(aclAllowsFactAbout({ writable_fact_about: ['*'] }, 'anything/at/all')).toBe(true);
  });
});

describe('XEP-02 §1 Fact Ledger：追加式与辩论链', () => {
  const mkFact = (id: string, statement: unknown, refute_of?: string[]): Fact => ({
    fact_id: id,
    about: 'sensor/thermo-01/temperature',
    statement,
    confidence: 0.9,
    time_anchor: 1000,
    source_agent: 'edge',
    refute_of,
  });

  it('追加：refute 不删除旧记录', () => {
    const ledger = new FactLedger();
    ledger.append(mkFact('f-1', { celsius: 28.5 }));
    ledger.append(mkFact('f-2', { celsius: 26.1 }, ['f-1']));
    expect(ledger.all()).toHaveLength(2); // f-1 仍在 —— 保留完整冲突证据
    expect(ledger.active()).toHaveLength(1);
    expect(ledger.active()[0].fact_id).toBe('f-2');
  });

  it('同 about 不同值 → FACT_CONFLICT 提示（不拒绝）', () => {
    const ledger = new FactLedger();
    ledger.append(mkFact('f-1', { celsius: 28.5 }));
    const { conflicts } = ledger.append(mkFact('f-2', { celsius: 26.1 }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].contradicted).toEqual(['f-1']);
    expect(ledger.all()).toHaveLength(2); // 双双保留，交上层仲裁
  });

  it('同 about 同值不报冲突', () => {
    const ledger = new FactLedger();
    ledger.append(mkFact('f-1', { celsius: 28 }));
    const { conflicts } = ledger.append(mkFact('f-2', { celsius: 28 }));
    expect(conflicts).toHaveLength(0);
  });

  it('校验失败拒绝入账', () => {
    const ledger = new FactLedger();
    const { problems } = ledger.append(mkFact('f-x', 1));
    expect(problems).toHaveLength(0);
    const bad = { ...mkFact('f-bad', 1), confidence: 1.5 };
    expect(ledger.append(bad).problems.length).toBeGreaterThan(0);
    expect(ledger.get('f-bad')).toBeUndefined();
    const selfRefute = mkFact('f-self', 1, ['f-self']);
    expect(ledger.append(selfRefute).problems.length).toBeGreaterThan(0);
  });
});

describe('XEP-04 Trace 因果链', () => {
  it('拓扑排序：parent 恒在 child 之前', () => {
    const events: TraceEvent[] = [
      { trace_id: 't', event_id: 'e3', parent_event_id: 'e2', kind: 'goal-complete', agent_id: 'a', timestamp: 3 },
      { trace_id: 't', event_id: 'e1', parent_event_id: null, kind: 'goal-create', agent_id: 'a', timestamp: 1 },
      { trace_id: 't', event_id: 'e2', parent_event_id: 'e1', kind: 'goal-suspend', agent_id: 'a', timestamp: 2 },
    ];
    const sorted = topologicalSort(events);
    expect(sorted.map((e) => e.event_id)).toEqual(['e1', 'e2', 'e3']);
  });
});
