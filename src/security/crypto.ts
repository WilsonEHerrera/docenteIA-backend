import { createHash, randomBytes } from 'node:crypto';

/** Opaque, URL-safe random token (256 bits). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored hashed; a DB leak must not expose usable tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
