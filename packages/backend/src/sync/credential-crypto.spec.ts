import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCrypto } from './credential-crypto';
import type { EncryptedSecret } from './credential-crypto';

const key: Buffer = randomBytes(32);

describe('CredentialCrypto', () => {
  it('round-trips a PIN', () => {
    const crypto: CredentialCrypto = new CredentialCrypto(key);

    expect(crypto.decrypt(crypto.encrypt('12345äö'))).toBe('12345äö');
  });

  it('uses a fresh 12-byte IV per encryption and never stores the plaintext', () => {
    const crypto: CredentialCrypto = new CredentialCrypto(key);

    const first: EncryptedSecret = crypto.encrypt('secret-pin');
    const second: EncryptedSecret = crypto.encrypt('secret-pin');

    expect(first.iv).toHaveLength(12);
    expect(first.tag).toHaveLength(16);
    expect(first.iv.equals(second.iv)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(first.ciphertext.toString('utf8')).not.toContain('secret-pin');
  });

  it('throws for a tampered ciphertext', () => {
    const crypto: CredentialCrypto = new CredentialCrypto(key);
    const secret: EncryptedSecret = crypto.encrypt('secret-pin');
    const tampered: Buffer = Buffer.from(secret.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    expect(() => crypto.decrypt({ ...secret, ciphertext: tampered })).toThrow();
  });

  it('throws for a different key', () => {
    const secret: EncryptedSecret = new CredentialCrypto(key).encrypt('secret-pin');

    expect(() => new CredentialCrypto(randomBytes(32)).decrypt(secret)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new CredentialCrypto(randomBytes(16))).toThrow('32 bytes');
  });
});
