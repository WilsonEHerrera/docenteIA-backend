import { createHash } from 'node:crypto';

/** Deterministic unsigned 32-bit integer from the given parts (same input → same output). */
export function hashInt(...parts: (string | Buffer)[]): number {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\u0000');
  }
  return hash.digest().readUInt32BE(0);
}
