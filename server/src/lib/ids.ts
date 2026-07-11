import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';

// URL/filename-safe alphabet (no '-' or '_' to keep ids trivially safe everywhere).
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const newId = customAlphabet(ALPHABET, 12);
const tokenSecret = customAlphabet(ALPHABET, 24);

export const TOKEN_PREFIX = 'tht_';

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + tokenSecret();
  return { token, hash: sha256(token), prefix: token.slice(0, 12) };
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateSessionValue(): { value: string; hash: string } {
  const value = crypto.randomBytes(32).toString('base64url');
  return { value, hash: sha256(value) };
}

/** Guard for ids used in file paths. */
export function isSafeId(id: string): boolean {
  return /^[0-9A-Za-z]{1,32}$/.test(id);
}

export function nowIso(): string {
  return new Date().toISOString();
}
