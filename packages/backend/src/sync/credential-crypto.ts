import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** 96-bit IV, the size GCM is specified for; a fresh one for every encryption. */
const IV_BYTES = 12;

/** A secret as stored in `hf_bank_connection.pin_ciphertext` / `pin_iv` / `pin_tag`. */
export interface EncryptedSecret {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly tag: Buffer;
}

/**
 * AES-256-GCM encryption of the bank PINs with the `BANK_CREDENTIALS_KEY`. The plaintext never
 * leaves this class except as the return value of `decrypt`, which only the FinTS session uses.
 */
export class CredentialCrypto {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`The credential key must be ${KEY_BYTES} bytes, got ${key.length}`);
    }
    this.key = key;
  }

  encrypt(plaintext: string): EncryptedSecret {
    const iv: Buffer = randomBytes(IV_BYTES);
    const cipher: CipherGCM = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext: Buffer = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }

  /** Throws when the secret was not encrypted with this key or was tampered with. */
  decrypt(secret: EncryptedSecret): string {
    const decipher: DecipherGCM = createDecipheriv(ALGORITHM, this.key, secret.iv);
    decipher.setAuthTag(secret.tag);
    return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString('utf8');
  }
}
