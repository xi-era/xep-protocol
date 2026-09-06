import { describe, expect, it, afterEach } from 'vitest';
import { createJsonFileStore } from '../src/persistence/json-file-store.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname ?? '.', '.test-xep-data');

describe('v0.4 JSON 文件持久化', () => {
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('写入 Goal → 保存 → 重新加载 → 状态一致', () => {
    const store1 = createJsonFileStore({ dir: TEST_DIR });
    store1.goalStore.upsert({
      goal_id: 'g-persist-1', state: 'running', priority: 200,
      payload: { type: 'sensor-read' },
    });
    store1.goalStore.upsert({
      goal_id: 'g-persist-2', state: 'suspended', priority: 100,
      progress: { last_step: 5 },
      payload: { type: 'batch' },
    });
    store1.save();

    // 重新加载
    const store2 = createJsonFileStore({ dir: TEST_DIR });
    store2.load();

    expect(store2.goalStore.get('g-persist-1')?.state).toBe('running');
    expect(store2.goalStore.get('g-persist-2')?.state).toBe('suspended');
    expect(store2.goalStore.get('g-persist-2')?.progress).toEqual({ last_step: 5 });
  });

  it('写入 Fact → 保存 → 重新加载 → 数据完整', () => {
    const store1 = createJsonFileStore({ dir: TEST_DIR });
    store1.ledger.append({
      fact_id: 'f-persist-1', about: 'sensor/thermo-01/temperature',
      statement: { celsius: 28.5 }, confidence: 0.95,
      time_anchor: 1000, source_agent: 'edge',
    });
    store1.save();

    const store2 = createJsonFileStore({ dir: TEST_DIR });
    store2.load();

    expect(store2.ledger.get('f-persist-1')?.statement).toEqual({ celsius: 28.5 });
    expect(store2.ledger.all()).toHaveLength(1);
  });

  it('autoSave 模式：每次 upsert 自动写入', () => {
    const store = createJsonFileStore({ dir: TEST_DIR, autoSave: true });
    store.goalStore.upsert({
      goal_id: 'g-auto', state: 'completed', priority: 50, payload: {},
    });
    // autoSave 应已写入
    expect(existsSync(join(TEST_DIR, 'goals.json'))).toBe(true);

    const store2 = createJsonFileStore({ dir: TEST_DIR });
    store2.load();
    expect(store2.goalStore.get('g-auto')?.state).toBe('completed');
  });

  it('空目录启动不报错', () => {
    const store = createJsonFileStore({ dir: TEST_DIR });
    store.load(); // 无文件，静默
    expect(store.goalStore.list()).toHaveLength(0);
    expect(store.ledger.all()).toHaveLength(0);
  });
});
