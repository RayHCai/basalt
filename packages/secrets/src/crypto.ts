import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Secret } from './secret.js';

/** AES-256-GCM: 32-byte key, 12-byte IV, 16-byte auth tag. */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Current on-disk envelope version, so the format can evolve. */
const BOX_VERSION = 1;

/**
 * An authenticated-encrypted secret at rest. All binary fields are base64. The
 * plaintext is never present. The secret's name is bound as GCM additional
 * authenticated data (not stored here) so a box cannot be moved to another name
 * without failing authentication.
 */
interface SealedBox {
  /** Envelope format version. */
  v: number;
  /** base64 initialization vector (unique per encryption). */
  iv: string;
  /** base64 GCM authentication tag. */
  tag: string;
  /** base64 ciphertext. */
  ct: string;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new RangeError(`Master key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

/**
 * Encrypt `secret` under `key`, binding `name` as additional authenticated
 * data. The returned box is safe to persist as JSON; it contains no plaintext.
 */
function encrypt(key: Buffer, name: string, secret: Secret): SealedBox {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(name, 'utf8'));
  const ct = Buffer.concat([cipher.update(secret.expose(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: BOX_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

/**
 * Decrypt a {@link SealedBox} under `key`, verifying `name` matches the AAD the
 * box was sealed with. Throws if the key is wrong, the name differs, or the
 * ciphertext/tag was tampered with (GCM authentication failure).
 *
 * @returns the recovered value wrapped in a {@link Secret}.
 */
function decrypt(key: Buffer, name: string, box: SealedBox): Secret {
  assertKey(key);
  if (box.v !== BOX_VERSION) {
    throw new RangeError(`Unsupported secret box version: ${String(box.v)}`);
  }
  const iv = Buffer.from(box.iv, 'base64');
  const tag = Buffer.from(box.tag, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(name, 'utf8'));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]);
  const value = pt.toString('utf8');
  return new Secret(value);
}

export { decrypt, encrypt, KEY_BYTES, type SealedBox };
