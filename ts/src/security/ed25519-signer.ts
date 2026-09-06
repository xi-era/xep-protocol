/**
 * Ed25519 参考签名 — 基于 @noble/ed25519 的 KeyMaterial 实现。
 * 对应 XEP-08 Level-2 MUST 项：签名强制校验。
 *
 * peerDependency：@noble/ed25519（不在 core 零依赖中引入，运行时按需加载）。
 *
 * 用法：
 *   import { Ed25519KeyMaterial } from '@xi-era/xep-core/security/ed25519';
 *   const key = Ed25519KeyMaterial.fromPrivateKey(privateKeyBytes);
 *   const signer = new ExternalKeySigner('ed25519', key);
 *   const agent = new XepAgent({ ..., signer });
 */
import type { KeyMaterial } from './signer.js';

let _noble: typeof import('@noble/ed25519') | null = null;

async function loadNoble() {
  if (!_noble) {
    _noble = await import('@noble/ed25519');
    // 设置 sha512 哈希函数：使用 Node.js 内置 crypto（@noble/ed25519 要求）
    if (!_noble.hashes.sha512) {
      const { createHash } = await import('node:crypto');
      _noble.hashes.sha512 = ((msg: Uint8Array) => {
        return createHash('sha512').update(msg).digest() as unknown as Uint8Array;
      }) as any;
    }
  }
  return _noble;
}

// Re-export noble types for convenience
export type NobleEd25519 = typeof import('@noble/ed25519');

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export class Ed25519KeyMaterial implements KeyMaterial {
  readonly algorithm = 'ed25519';
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  private constructor(priv: Uint8Array, pub: Uint8Array) {
    this.privateKey = priv;
    this.publicKey = pub;
  }

  /** 从 32 字节 Ed25519 私钥创建 */
  static fromPrivateKey(priv: Uint8Array): Ed25519KeyMaterial {
    // 公钥由私钥派生（同步，@noble/ed25519 有 getPublicKeyAsync）
    // 这里用同步方式：先返回实例，sign/verify 时再异步加载
    const pub = new Uint8Array(32); // 占位，实际由 sign 时派生
    return new Ed25519KeyMaterial(priv, pub);
  }

  /** 从密钥对创建 */
  static fromKeyPair(pair: Ed25519KeyPair): Ed25519KeyMaterial {
    return new Ed25519KeyMaterial(pair.privateKey, pair.publicKey);
  }

  /** 生成随机密钥对 */
  static async generate(): Promise<Ed25519KeyPair> {
    const noble = await loadNoble();
    const kp = await noble.keygenAsync();
    return { privateKey: kp.secretKey, publicKey: kp.publicKey };
  }

  sign(bytes: Uint8Array): string {
    // 使用同步 API（@noble/ed25519 的 sign 是同步的）
    const noble = _noble!;
    const sig = noble.sign(bytes, this.privateKey);
    return bytesToHex(sig);
  }

  verify(bytes: Uint8Array, signature: string): boolean {
    const noble = _noble!;
    const sig = hexToBytes(signature);
    const pub = this.publicKey[0] === 0 && this.publicKey.every((b) => b === 0)
      ? noble.getPublicKey(this.privateKey)
      : this.publicKey;
    return noble.verify(sig, bytes, pub);
  }
}

/* ── hex 工具 ── */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
