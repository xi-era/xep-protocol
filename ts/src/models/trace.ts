/**
 * XEP-04 — Trace（因果溯源链）。
 * 每条协议动作都是一条 Trace Event；因果链可经 parent_event_id 向上追溯到根。
 */

export type TraceEventKind =
  | 'goal-create'
  | 'goal-split'
  | 'goal-migrate'
  | 'goal-suspend'
  | 'goal-resume'
  | 'goal-complete'
  | 'goal-fail'
  | 'goal-cancel'
  | 'fact-assert'
  | 'fact-refute'
  | 'agent-offline'
  | 'agent-online';

export interface OfflineGap {
  /** 断网开始时刻 (epoch ms) */
  from: number;
  /** 断网恢复时刻 (epoch ms) */
  to: number;
}

export interface TraceEvent {
  /** 因果链根 ID（通常 = 根 Goal 的 goal_id） */
  trace_id: string;
  event_id: string;
  /** 触发本事件的上游事件；根事件为 null */
  parent_event_id: string | null;
  kind: TraceEventKind;
  agent_id: string;
  /** 事件发生时刻（本地时钟），epoch ms。不要求全局时钟同步 */
  timestamp: number;
  /** 断网时间窗口：审计时可见任务哪段时间离线执行 */
  offline_gap?: OfflineGap;
  /** 事件附加信息（goal_id、fact_id 等） */
  detail?: Record<string, unknown>;
}

/** Envelope 顶层的溯源头 */
export interface TraceHeader {
  trace_id: string;
  event_id: string;
  parent_event_id: string | null;
  offline_gap?: OfflineGap;
}

export function traceHeaderToEvent(header: TraceHeader, kind: TraceEventKind, agentId: string, timestamp: number, detail?: Record<string, unknown>): TraceEvent {
  return {
    trace_id: header.trace_id,
    event_id: header.event_id,
    parent_event_id: header.parent_event_id,
    kind,
    agent_id: agentId,
    timestamp,
    offline_gap: header.offline_gap,
    detail,
  };
}

/** 按因果链拓扑排序（parent 在 child 之前）；用于审计展示。 */
export function topologicalSort(events: TraceEvent[]): TraceEvent[] {
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const visited = new Set<string>();
  const out: TraceEvent[] = [];
  const visit = (e: TraceEvent, stack: Set<string>) => {
    if (visited.has(e.event_id) || stack.has(e.event_id)) return;
    stack.add(e.event_id);
    if (e.parent_event_id) {
      const p = byId.get(e.parent_event_id);
      if (p) visit(p, stack);
    }
    stack.delete(e.event_id);
    visited.add(e.event_id);
    out.push(e);
  };
  for (const e of events) visit(e, new Set());
  return out;
}
