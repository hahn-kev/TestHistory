import crypto from 'node:crypto';

function hmac(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/** Returns an opaque token binding `subject` until now+ttl. Format: "<expiresEpochMs>.<hmac>". */
export function signSubject(secret: string, subject: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  return `${exp}.${hmac(secret, `${subject}.${exp}`)}`;
}

export function verifySubject(secret: string, subject: string, token: string): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = hmac(secret, `${subject}.${exp}`);
  const actual = token.slice(dot + 1);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
