/**
 * XEP-02 §1 — Fact（事实陈述）。
 * Fact 是带证据的观测陈述，不是全局唯一真理；XEP 不内置共识仲裁，
 * 冲突证据全部保留，由上层业务仲裁。
 */

export interface Fact {
  fact_id: string;
  /** 事实主体（URI 或约定标识，如 sensor/thermo-01/temperature） */
  about: string;
  /** 观测值 / 陈述内容 */
  statement: unknown;
  /** 置信度 0–1：传感器、模型推理、人工输入 */
  confidence: number;
  /** 时间锚点：观测时刻（非上报时刻），epoch ms */
  time_anchor: number;
  source_agent: string;
  /** 来源 Agent 签名。minimal 设备可省略，full 实现强制校验 */
  source_signature?: string;
  /** 引用并推翻的旧 fact_id 列表，形成分布式事实辩论链 */
  refute_of?: string[];
  /** 证据附加信息（原始读数、推理依据），对 XEP 不透明 */
  evidence?: Record<string, unknown>;
}

export function validateFact(fact: Fact): string[] {
  const problems: string[] = [];
  if (!fact.fact_id) problems.push('fact_id is required');
  if (!fact.about) problems.push('about is required');
  if (typeof fact.confidence !== 'number' || fact.confidence < 0 || fact.confidence > 1) {
    problems.push('confidence must be a number in [0,1]');
  }
  if (typeof fact.time_anchor !== 'number' || fact.time_anchor < 0) {
    problems.push('time_anchor must be epoch ms');
  }
  if (!fact.source_agent) problems.push('source_agent is required');
  if (fact.refute_of && fact.refute_of.includes(fact.fact_id)) {
    problems.push('a fact cannot refute itself');
  }
  return problems;
}
