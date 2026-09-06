import { describe, expect, it } from 'vitest';
import { Ed25519KeyMaterial } from '../src/security/ed25519-signer.js';
import { ExternalKeySigner, canonicalEnvelopeBytes } from '../src/security/signer.js';

describe('v0.4 Ed25519 参考签名', () => {
  it('生成密钥对 → 签名 → 验签', async () => {
    const pair = await Ed25519KeyMaterial.generate();
    expect(pair.privateKey).toHaveLength(32);
    expect(pair.publicKey).toHaveLength(32);

    const key = Ed25519KeyMaterial.fromKeyPair(pair);
    const signer = new ExternalKeySigner('ed25519', key);

    const data = new TextEncoder().encode('hello xep');
    const sig = signer.sign(data);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);

    expect(signer.verify(data, sig)).toBe(true);
  });

  it('篡改数据 → 验签失败', async () => {
    const pair = await Ed25519KeyMaterial.generate();
    const key = Ed25519KeyMaterial.fromKeyPair(pair);
    const signer = new ExternalKeySigner('ed25519', key);

    const data = new TextEncoder().encode('original');
    const sig = signer.sign(data);
    const tampered = new TextEncoder().encode('tampered');

    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it('不同密钥 → 验签失败', async () => {
    const pair1 = await Ed25519KeyMaterial.generate();
    const pair2 = await Ed25519KeyMaterial.generate();
    const key1 = Ed25519KeyMaterial.fromKeyPair(pair1);
    const key2 = Ed25519KeyMaterial.fromKeyPair(pair2);
    const signer1 = new ExternalKeySigner('ed25519', key1);
    const signer2 = new ExternalKeySigner('ed25519', key2);

    const data = new TextEncoder().encode('test');
    const sig = signer1.sign(data);
    expect(signer2.verify(data, sig)).toBe(false);
  });

  it('fromPrivateKey 懒派生公钥', async () => {
    const pair = await Ed25519KeyMaterial.generate();
    const key = Ed25519KeyMaterial.fromPrivateKey(pair.privateKey);
    const signer = new ExternalKeySigner('ed25519', key);

    const data = new TextEncoder().encode('lazy');
    const sig = signer.sign(data);
    expect(signer.verify(data, sig)).toBe(true);
  });

  it('与 canonicalEnvelopeBytes 集成', async () => {
    const pair = await Ed25519KeyMaterial.generate();
    const key = Ed25519KeyMaterial.fromKeyPair(pair);
    const signer = new ExternalKeySigner('ed25519', key);

    const env = { kind: 'goal.propose', timestamp: 1, payload: { goal_id: 'g-1' } };
    const bytes = canonicalEnvelopeBytes(env);
    const sig = signer.sign(bytes);
    expect(signer.verify(bytes, sig)).toBe(true);
  });
});
