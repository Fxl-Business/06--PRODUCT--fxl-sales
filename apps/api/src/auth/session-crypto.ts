/**
 * AES-256-GCM sealing for the durable Hub BFF session store.
 *
 * Every secret persisted by `hub-session-store.ts` (the Hub refresh token, the
 * PKCE code verifier) is sealed with a key derived by HKDF-SHA256 from
 * `HUB_SESSION_ENCRYPTION_KEY` when set, otherwise from `FXL_HUB_CLIENT_SECRET`.
 * The row's own id is the AEAD additional data, so a ciphertext cannot be moved
 * from one row to another.
 *
 * OPERATIONAL CONSEQUENCE: rotating `FXL_HUB_CLIENT_SECRET` (or
 * `HUB_SESSION_ENCRYPTION_KEY`) invalidates EVERY stored session. Decryption
 * failure is treated exactly as "unknown session", so the effect on a user is a
 * single re-login. Operators who need to rotate the Hub client secret without a
 * mass logout should set `HUB_SESSION_ENCRYPTION_KEY` BEFORE rotating.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const HKDF_SALT = 'fxl-sales/hub-bff-session/v1';
const HKDF_INFO = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const MIN_IKM_LENGTH = 32;

export type SessionSealer = {
  /** AES-256-GCM seal. `aad` binds the ciphertext to its row id. */
  seal(plaintext: string, aad: string): string;
  /** Returns null on ANY failure: bad format, wrong key, tampered ciphertext, wrong aad. */
  open(sealed: string, aad: string): string | null;
};

/**
 * HKDF-SHA256 to a 32-byte AES key. HKDF accepts arbitrary-length input keying
 * material, so there is deliberately no base64/hex format requirement on the
 * environment value - a length floor is the only ops-facing rule.
 */
export function deriveSessionKey(ikm: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

export function createSessionSealer(ikm: string): SessionSealer {
  if (ikm.length < MIN_IKM_LENGTH) {
    throw new Error('hub session encryption key must be at least 32 characters');
  }
  const key = deriveSessionKey(ikm);

  return {
    seal(plaintext: string, aad: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [
        FORMAT_VERSION,
        iv.toString('base64url'),
        authTag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },

    open(sealed: string, aad: string): string | null {
      try {
        const parts = sealed.split('.');
        if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
          return null;
        }
        const iv = Buffer.from(parts[1] ?? '', 'base64url');
        const authTag = Buffer.from(parts[2] ?? '', 'base64url');
        const ciphertext = Buffer.from(parts[3] ?? '', 'base64url');
        if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
          return null;
        }
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        // Every failure mode collapses to one branch for the caller: no
        // plaintext means "unknown session".
        return null;
      }
    },
  };
}
