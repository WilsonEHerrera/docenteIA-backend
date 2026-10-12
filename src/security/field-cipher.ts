import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../common/app-error';
import { AppConfig } from '../config/app-config';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Application-level encryption for sensitive fields (AES-256-GCM).
 * `context` (e.g. the student id) is authenticated but not stored, so a
 * ciphertext copied onto another row fails to decrypt.
 */
@Injectable()
export class FieldCipher {
  private readonly key: Buffer | null;

  constructor(config: AppConfig) {
    const raw = config.values.BIOMETRIC_ENCRYPTION_KEY;
    this.key = raw ? Buffer.from(raw, 'base64') : null;
  }

  get configured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [VERSION, iv, cipher.getAuthTag(), data]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join(':');
  }

  decrypt(payload: string, context: string): string {
    const key = this.requireKey();
    const [version, iv, tag, data] = payload.split(':');
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Unsupported ciphertext format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new AppError(
        503,
        'BIOMETRIC_NOT_CONFIGURED',
        'El almacenamiento biométrico no está configurado.',
      );
    }
    return this.key;
  }
}
