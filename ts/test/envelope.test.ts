import { describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeEnvelope, encodeEnvelopeJson, checkVersion, Envelope } from '../src/envelope.js';
import { XepErrorCode } from '../src/errors.js';

describe('XEP-05 parse-and-preserve', () => {
  const known: Envelope = {
    xep_version: '1.0',
    kind: 'goal.propose',
    trace: { trace_id: 'g-1', event_id: 'e-1', parent_event_id: null },
    from: 'cloud',
    to: 'edge',
    timestamp: 1000,
    payload: { goal_id: 'g-1', state: 'pending' },
  };

  it('未知顶层字段被保留并随 encode 透传，不丢弃不报错', () => {
    const raw = { ...encodeEnvelope(known), future_field: { nested: true }, another: 42 };
    const decoded = decodeEnvelope(raw);
    expect(decoded._unknown).toEqual({ future_field: { nested: true }, another: 42 });
    const reEncoded = encodeEnvelope(decoded);
    expect(reEncoded.future_field).toEqual({ nested: true });
    expect(reEncoded.another).toBe(42);
    // 已知字段完好
    expect(reEncoded.kind).toBe('goal.propose');
    expect(reEncoded.trace).toEqual(known.trace);
  });

  it('payload 内未知字段原样保留', () => {
    const decoded = decodeEnvelope({ ...encodeEnvelope(known), payload: { goal_id: 'g-1', vendor_thing: [1, 2] } });
    expect(decoded.payload.vendor_thing).toEqual([1, 2]);
  });

  it('ext 扩展字段保留（玄码 xuangcode_ext 场景）', () => {
    const decoded = decodeEnvelope({ ...encodeEnvelope(known), ext: { xuangcode_ext: { foo: 1 } } });
    expect(decoded.ext).toEqual({ xuangcode_ext: { foo: 1 } });
    expect(encodeEnvelope(decoded).ext).toEqual({ xuangcode_ext: { foo: 1 } });
  });

  it('畸形输入不崩溃（minimal 设备健壮性）', () => {
    expect(() => decodeEnvelope('not json{')).toThrow();
    const empty = decodeEnvelope({});
    expect(empty.kind).toBe('');
    expect(empty.payload).toEqual({});
    expect(() => decodeEnvelope(42)).toThrow(); // 非对象报错（KIND_UNSUPPORTED 类）
    expect(() => decodeEnvelope(null)).toThrow();
  });

  it('JSON 往返一致', () => {
    const json = encodeEnvelopeJson(known);
    const decoded = decodeEnvelope(json);
    expect(decoded.kind).toBe('goal.propose');
    expect(decoded.trace.trace_id).toBe('g-1');
  });
});

describe('XEP-05 §4 版本策略', () => {
  it('同版本与同主版本小版本差均可解析', () => {
    expect(() => checkVersion('1.0')).not.toThrow();
    expect(() => checkVersion('1.9')).not.toThrow();
  });

  it('主版本不同抛 VERSION_UNSUPPORTED', () => {
    try {
      checkVersion('2.0');
      expect.fail('should throw');
    } catch (err) {
      expect((err as { code: string }).code).toBe(XepErrorCode.VERSION_UNSUPPORTED);
    }
  });
});
