import { describe, expect, it } from 'vitest';
import { createSessionSealer } from '../session-crypto.js';

const IKM = 'session-crypto-unit-test-ikm-0123456789';
const OTHER_IKM = 'a-completely-different-key-0123456789abcd';

/** `v1.<iv>.<authTag>.<ciphertext>` - see session-crypto.ts. */
function sealedComponent(sealed: string, index: 1 | 2 | 3): Buffer {
  const part = sealed.split('.')[index];
  if (part === undefined) {
    throw new Error(`sealed value has no component ${index}: ${sealed}`);
  }
  return Buffer.from(part, 'base64url');
}

/**
 * Flips one bit of a sealed component AT THE BYTE LEVEL and re-encodes.
 *
 * Never mutate a base64url CHARACTER instead. A 19-byte plaintext ends in a
 * one-byte base64 group whose final character carries 2 significant bits plus 4
 * padding bits, so an `A` -> `B` edit there changes only padding and decodes to
 * byte-identical ciphertext roughly a quarter of the time; `open` then correctly
 * returns the plaintext and the assertion fails for a reason that has nothing to
 * do with the AEAD. Byte 0 is always fully significant, so this is deterministic.
 */
function withFlippedByte(sealed: string, index: 1 | 2 | 3): string {
  const bytes = sealedComponent(sealed, index);
  const first = bytes.at(0);
  if (first === undefined) {
    throw new Error(`sealed component ${index} is empty: ${sealed}`);
  }
  bytes.writeUInt8(first ^ 0x01, 0);
  const parts = sealed.split('.');
  parts[index] = bytes.toString('base64url');
  return parts.join('.');
}

describe('session sealer', () => {
  it('round-trips a plaintext', () => {
    const sealer = createSessionSealer(IKM);
    const sealed = sealer.seal('refresh-token-alpha', 'row-1');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('refresh-token-alpha');
    expect(sealer.open(sealed, 'row-1')).toBe('refresh-token-alpha');
  });

  it('refuses a ciphertext opened under a different aad', () => {
    // The row binding: a ciphertext cannot be moved between rows.
    const sealer = createSessionSealer(IKM);
    const sealed = sealer.seal('refresh-token-alpha', 'row-1');
    expect(sealer.open(sealed, 'row-2')).toBeNull();
  });

  it('refuses a tampered ciphertext', () => {
    const sealer = createSessionSealer(IKM);
    const sealed = sealer.seal('refresh-token-alpha', 'row-1');
    const flipped = withFlippedByte(sealed, 3);

    // Non-vacuity: the mutation really did change the decoded BYTES, which is
    // exactly what a base64url character edit could not guarantee.
    expect(sealedComponent(flipped, 3)).not.toEqual(sealedComponent(sealed, 3));
    expect(sealer.open(flipped, 'row-1')).toBeNull();
  });

  it('refuses a tampered auth tag', () => {
    const sealer = createSessionSealer(IKM);
    const sealed = sealer.seal('refresh-token-alpha', 'row-1');
    const flipped = withFlippedByte(sealed, 2);

    expect(sealedComponent(flipped, 2)).not.toEqual(sealedComponent(sealed, 2));
    expect(sealer.open(flipped, 'row-1')).toBeNull();
  });

  it('refuses a tampered iv', () => {
    const sealer = createSessionSealer(IKM);
    const sealed = sealer.seal('refresh-token-alpha', 'row-1');
    const flipped = withFlippedByte(sealed, 1);

    expect(sealedComponent(flipped, 1)).not.toEqual(sealedComponent(sealed, 1));
    expect(sealer.open(flipped, 'row-1')).toBeNull();
  });

  it('refuses a ciphertext sealed under a different key', () => {
    const sealed = createSessionSealer(IKM).seal('refresh-token-alpha', 'row-1');
    expect(createSessionSealer(OTHER_IKM).open(sealed, 'row-1')).toBeNull();
  });

  it('refuses malformed input rather than throwing', () => {
    const sealer = createSessionSealer(IKM);
    expect(sealer.open('', 'row-1')).toBeNull();
    expect(sealer.open('not-sealed', 'row-1')).toBeNull();
    expect(sealer.open('v2.a.b.c', 'row-1')).toBeNull();
    expect(sealer.open('v1.a.b', 'row-1')).toBeNull();
  });

  it('uses a fresh IV for every seal', () => {
    const sealer = createSessionSealer(IKM);
    const a = sealer.seal('refresh-token-alpha', 'row-1');
    const b = sealer.seal('refresh-token-alpha', 'row-1');
    expect(a).not.toBe(b);
    expect(sealer.open(a, 'row-1')).toBe('refresh-token-alpha');
    expect(sealer.open(b, 'row-1')).toBe('refresh-token-alpha');
  });

  it('rejects input keying material shorter than 32 characters', () => {
    expect(() => createSessionSealer('a'.repeat(31))).toThrow(/at least 32 characters/);
    expect(() => createSessionSealer('a'.repeat(32))).not.toThrow();
  });
});
