/**
 * XEP-05 — XEP-Envelope：XEP 唯一报文封装，整体作为 ACP message.payload 传输。
 * 不改动 ACP 底层报文头，不定义传输/帧/握手/粘包处理。
 *
 * parse-and-preserve（XEP-05 §3，强制兼容性规则）：
 * 遇到未知字段忽略语义但保留透传；未知 kind 返回 error 不断链不崩溃。
 */
import { TraceHeader } from './models/trace.js';
import { XepError, XepErrorCode } from './errors.js';

export const XEP_VERSION = '1.0';

export type EnvelopeKind =
  | 'capability.hello'
  | 'goal.propose'
  | 'goal.update'
  | 'goal.cancel'
  | 'goal.migrate'
  | 'fact.assert'
  | 'fact.refute'
  | 'trace.append'
  | 'error';

/** Envelope payload 按 kind 分发；保留 Record 以允许未知扩展结构透传 */
export interface Envelope {
  xep_version: string;
  kind: EnvelopeKind | string; // 未知 kind 不在类型层崩溃，运行时校验
  trace: TraceHeader;
  from: string;
  to: string;
  timestamp: number;
  payload: Record<string, unknown>;
  signature?: string;
  /** 厂商扩展（如玄码 xuangcode_ext）。未知实现必须忽略 */
  ext?: Record<string, unknown>;
  /** parse-and-preserve：反序列化时保留的本实现不理解的顶层字段，转发时原样带回 */
  _unknown?: Record<string, unknown>;
}

/** 已知的顶层字段；其余字段进 `_unknown` 保留 */
const KNOWN_TOP_LEVEL = new Set(['xep_version', 'kind', 'trace', 'from', 'to', 'timestamp', 'payload', 'signature', 'ext']);

/** 反序列化（XEP-05 §3）：永不因未知字段抛错。 */
export function decodeEnvelope(raw: unknown): Envelope {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new XepError(XepErrorCode.KIND_UNSUPPORTED, 'payload is not valid JSON');
    }
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new XepError(XepErrorCode.KIND_UNSUPPORTED, 'envelope must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const unknown: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL.has(key)) unknown[key] = obj[key];
  }
  const env: Envelope = {
    xep_version: typeof obj.xep_version === 'string' ? obj.xep_version : 'unknown',
    kind: typeof obj.kind === 'string' ? obj.kind : '',
    trace: (obj.trace as TraceHeader) ?? { trace_id: '', event_id: '', parent_event_id: null },
    from: typeof obj.from === 'string' ? obj.from : '',
    to: typeof obj.to === 'string' ? obj.to : '',
    timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : 0,
    payload: (obj.payload as Record<string, unknown>) ?? {},
    _unknown: Object.keys(unknown).length > 0 ? unknown : undefined,
  };
  if (typeof obj.signature === 'string') env.signature = obj.signature;
  if (typeof obj.ext === 'object' && obj.ext !== null) env.ext = obj.ext as Record<string, unknown>;
  return env;
}

/** 序列化：_unknown 中保留的未知字段原样透传（转发场景不得丢弃）。 */
export function encodeEnvelope(env: Envelope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    xep_version: env.xep_version,
    kind: env.kind,
    trace: env.trace,
    from: env.from,
    to: env.to,
    timestamp: env.timestamp,
    payload: env.payload,
  };
  if (env.signature !== undefined) out.signature = env.signature;
  if (env.ext !== undefined) out.ext = env.ext;
  if (env._unknown !== undefined) Object.assign(out, env._unknown);
  return out;
}

export function encodeEnvelopeJson(env: Envelope): string {
  return JSON.stringify(encodeEnvelope(env));
}

/**
 * 版本兼容检查（XEP-05 §4 规则 4）：
 * 同主版本 → 可按本版本规则解析（忽略未知字段）；主版本更高 → VERSION_UNSUPPORTED。
 */
export function checkVersion(remoteVersion: string, supported: string = XEP_VERSION): void {
  if (remoteVersion === supported) return;
  const remoteMajor = remoteVersion.split('.')[0];
  const localMajor = supported.split('.')[0];
  if (remoteMajor !== localMajor) {
    throw new XepError(XepErrorCode.VERSION_UNSUPPORTED, `envelope version ${remoteVersion} incompatible with ${supported}`);
  }
}

/** 已知 kind 集合；未知 kind 由调用方产生 KIND_UNSUPPORTED error 报文（不断链）。 */
export const KNOWN_KINDS: readonly string[] = [
  'capability.hello',
  'goal.propose',
  'goal.update',
  'goal.cancel',
  'goal.migrate',
  'fact.assert',
  'fact.refute',
  'trace.append',
  'error',
];
