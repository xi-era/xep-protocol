/**
 * JSON 文件持久化 — GoalStore + FactLedger 的磁盘持久化参考实现。
 * 对应 XEP-09 Level-2 MUST 项：Goal/Fact Ledger 持久化（跨重启恢复）。
 *
 * 用法：
 *   const { goalStore, ledger, load, save } = createJsonFileStore({ dir: './data' });
 *   const agent = new XepAgent({ ..., goalStore, ledger });
 *   await load();  // 启动时加载
 *   // ... agent 运行 ...
 *   await save();  // 关闭时保存（或由 sink 自动保存）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Goal } from '../models/goal.js';
import { Fact } from '../models/fact.js';
import { GoalStore, GoalSink } from '../runtime/goal-store.js';
import { FactLedger, FactSink } from '../runtime/fact-ledger.js';

export interface JsonFileStoreOptions {
  /** 数据目录路径（默认 ./xep-data） */
  dir?: string;
  /** Goal 文件名（默认 goals.json） */
  goalsFile?: string;
  /** Fact 文件名（默认 facts.json） */
  factsFile?: string;
  /** 是否在每次 sink 调用时自动保存（默认 true）。设为 false 则需手动调用 save() */
  autoSave?: boolean;
}

export interface JsonFileStore {
  goalStore: GoalStore;
  ledger: FactLedger;
  /** 从磁盘加载数据 */
  load(): void;
  /** 保存当前数据到磁盘 */
  save(): void;
}

export function createJsonFileStore(opts: JsonFileStoreOptions = {}): JsonFileStore {
  const dir = opts.dir ?? './xep-data';
  const goalsPath = join(dir, opts.goalsFile ?? 'goals.json');
  const factsPath = join(dir, opts.factsFile ?? 'facts.json');
  const autoSave = opts.autoSave !== false;

  // 确保目录存在
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // 内存态数据
  let goals = new Map<string, Goal>();
  let facts = new Map<string, Fact>();

  const saveGoals = () => {
    const arr = [...goals.values()];
    writeFileSync(goalsPath, JSON.stringify(arr, null, 2), 'utf-8');
  };

  const saveFacts = () => {
    const arr = [...facts.values()];
    writeFileSync(factsPath, JSON.stringify(arr, null, 2), 'utf-8');
  };

  // GoalStore sink：每次变更时写入
  const goalSink: GoalSink = (goal) => {
    goals.set(goal.goal_id, goal);
    if (autoSave) saveGoals();
  };

  // FactLedger sink：每次变更时写入
  const factSink: FactSink = (fact) => {
    facts.set(fact.fact_id, fact);
    if (autoSave) saveFacts();
  };

  const goalStore = new GoalStore(goalSink);
  const ledger = new FactLedger(factSink);

  return {
    goalStore,
    ledger,

    load() {
      // 加载 Goals
      if (existsSync(goalsPath)) {
        try {
          const raw = readFileSync(goalsPath, 'utf-8');
          const arr = JSON.parse(raw) as Goal[];
          for (const g of arr) {
            if (g && typeof g.goal_id === 'string') {
              goals.set(g.goal_id, g);
              // 直接写入 GoalStore 内部 map（绕过 sink 避免重复写入）
              (goalStore as any).goals.set(g.goal_id, g);
            }
          }
        } catch { /* 文件损坏时静默忽略，从空状态启动 */ }
      }
      // 加载 Facts
      if (existsSync(factsPath)) {
        try {
          const raw = readFileSync(factsPath, 'utf-8');
          const arr = JSON.parse(raw) as Fact[];
          for (const f of arr) {
            if (f && typeof f.fact_id === 'string') {
              facts.set(f.fact_id, f);
              (ledger as any).facts.set(f.fact_id, f);
            }
          }
        } catch { /* 文件损坏时静默忽略 */ }
      }
    },

    save() {
      saveGoals();
      saveFacts();
    },
  };
}
