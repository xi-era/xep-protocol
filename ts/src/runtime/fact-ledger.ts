/**
 * FactLedger — 内存事实账本（追加式）。
 * refute 只新增记录、永不物理删除旧记录（XEP-02 §1.2）——保留完整冲突证据链。
 * 冲突仲裁不在协议内：FACT_CONFLICT 是提示性事件，交上层业务裁决。
 * 存储分级：本实现为内存态；持久化由部署方包装 sink 实现对应分级要求。
 */
import { Fact, validateFact } from '../models/fact.js';

export interface FactConflict {
  /** 新事实 ID */
  incoming: string;
  /** 被质疑的既有事实 ID 列表 */
  contradicted: string[];
  about: string;
}

export type FactSink = (fact: Fact) => void;

export class FactLedger {
  private facts = new Map<string, Fact>();

  constructor(private readonly sink?: FactSink) {}

  get(factId: string): Fact | undefined {
    return this.facts.get(factId);
  }

  /** 全部事实（含已被 refute 的旧记录 —— 追加式，永不删除） */
  all(): Fact[] {
    return [...this.facts.values()];
  }

  /** 按 about 过滤的有效视图（未被 refute 的记录） */
  active(about?: string): Fact[] {
    const refuted = new Set<string>();
    for (const f of this.facts.values()) {
      for (const r of f.refute_of ?? []) refuted.add(r);
    }
    return this.all().filter(
      (f) => !refuted.has(f.fact_id) && (about === undefined || f.about === about),
    );
  }

  /**
   * 追加一条事实。校验失败返回错误列表；与既有事实冲突时照常入账并返回冲突提示
   * （FACT_CONFLICT 语义：提示而非失败）。
   */
  append(fact: Fact): { problems: string[]; conflicts: FactConflict[] } {
    const problems = validateFact(fact);
    if (problems.length > 0) return { problems, conflicts: [] };

    const conflicts: FactConflict[] = [];
    if (fact.refute_of && fact.refute_of.length > 0) {
      conflicts.push({ incoming: fact.fact_id, contradicted: fact.refute_of, about: fact.about });
    } else {
      // 同一 about 的不同 statement 视为观测冲突（提示性）
      for (const existing of this.active(fact.about)) {
        if (JSON.stringify(existing.statement) !== JSON.stringify(fact.statement)) {
          conflicts.push({ incoming: fact.fact_id, contradicted: [existing.fact_id], about: fact.about });
        }
      }
    }

    this.facts.set(fact.fact_id, fact);
    this.sink?.(fact);
    return { problems: [], conflicts };
  }
}
