/**
 * XEP-08 §1 — 可插拔签名接口。
 * 传输安全完全继承 ACP 底层 TLS，XEP 层不重复加密；
 * 本模块只负责应用层身份签名（防报文篡改、伪造指令）。
 *
 * 分级要求（XEP-08 §1.2）：
 *  Level-0: NoopSigner（仅限内网可信局域网，警告风险）
 *  Level-1: 可选
 *  Level-2: 强制验签，未签名/验签失败拒收（SIGNATURE_INVALID）
 */

/**
 * 签名覆盖 Envelope 中除 signature 外的全部语义字段。
 * 规范化算法由实现约定并在 capability.hello 中宣告（如 ed25519-json-canonical）。
 */
export interface Signer {
  readonly algorithm: string;
  sign(canonicalBytes: Uint8Array): string;
  verify(canonicalBytes: Uint8Array, signature: string): boolean;
}

/** Level-0 minimal 实现：不做签名。仅限可信内网使用。 */
export class NoopSigner implements Signer {
  readonly algorithm = 'none';
  sign(): string {
    return '';
  }
  verify(): boolean {
    // Level-0 不校验：任何报文都放行（协议文档明确警告此风险）
    return true;
  }
}

/** 私钥接口：真实算法由部署方注入，参考实现不绑定具体密码学库。 */
export interface KeyMaterial {
  sign(bytes: Uint8Array): Promise<string> | string;
  verify(bytes: Uint8Array, signature: string): Promise<boolean> | boolean;
}

/**
 * 外置密钥的通用 Signer 适配器。部署方可用 Ed25519 / SM2 等任意算法实现 KeyMaterial。
 * 参考实现保持零密码学依赖。
 */
export class ExternalKeySigner implements Signer {
  constructor(
    readonly algorithm: string,
    private readonly key: KeyMaterial,
  ) {}

  sign(canonicalBytes: Uint8Array): string {
    return this.key.sign(canonicalBytes) as string;
  }

  verify(canonicalBytes: Uint8Array, signature: string): boolean {
    return this.key.verify(canonicalBytes, signature) as boolean;
  }
}

/**
 * Envelope 规范化序列化：按字段名排序的稳定 JSON（去掉 signature 自身）。
 * 保证签名方与验签方对同一语义字段得到相同字节。
 */
export function canonicalEnvelopeBytes(env: Record<string, unknown>): Uint8Array {
  const { signature: _sig, ...rest } = env;
  const canonical = stableStringify(rest);
  return new TextEncoder().encode(canonical);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
