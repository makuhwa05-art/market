import crypto from 'node:crypto';

const RAW_SECRET = process.env.ADMIN_TOKEN_SECRET || process.env.SESSION_SECRET;
const SESSION_SECRET =
  RAW_SECRET && RAW_SECRET.length >= 16
    ? RAW_SECRET
    : crypto.randomBytes(32).toString('hex');

const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const USER_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  } catch {
    return false;
  }
}

export function constantTimeEqualText(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export interface AdminTokenPayload {
  adminId: number;
  username: string;
  role: string;
}

export interface UserTokenPayload {
  userId: number;
  uid: string;
  email: string;
}

export function signUserToken(payloadData: UserTokenPayload): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'platform-user',
      userId: payloadData.userId,
      uid: payloadData.uid,
      email: payloadData.email,
      exp: Date.now() + USER_TOKEN_TTL_MS,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyUserToken(token: string): UserTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  try {
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      userId?: unknown;
      uid?: unknown;
      email?: unknown;
      exp?: unknown;
    };
    if (
      decoded.sub !== 'platform-user' ||
      typeof decoded.userId !== 'number' ||
      typeof decoded.uid !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.exp !== 'number'
    ) {
      return null;
    }
    if (Date.now() > decoded.exp) {
      return null;
    }
    return {
      userId: decoded.userId,
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

export function signAdminToken(payloadData: AdminTokenPayload): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'platform-admin',
      adminId: payloadData.adminId,
      username: payloadData.username,
      role: payloadData.role,
      exp: Date.now() + ADMIN_TOKEN_TTL_MS,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  try {
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      adminId?: unknown;
      username?: unknown;
      role?: unknown;
      exp?: unknown;
    };
    if (
      decoded.sub !== 'platform-admin' ||
      typeof decoded.adminId !== 'number' ||
      typeof decoded.username !== 'string' ||
      typeof decoded.role !== 'string' ||
      typeof decoded.exp !== 'number'
    ) {
      return null;
    }
    if (Date.now() > decoded.exp) {
      return null;
    }
    return {
      adminId: decoded.adminId,
      username: decoded.username,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}
