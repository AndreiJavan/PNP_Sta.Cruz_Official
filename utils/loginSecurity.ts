import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface AttemptRecord {
  count: number;
  lockedUntil: number;
  lastAttemptAt: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_RESET_WINDOW_MS = 15 * 60 * 1000; // Reset counter after 15 min of inactivity

// Resolve path for persistent disk storage of lockout state
function getStorageFilePath(): string {
  const primaryDir = path.resolve(process.cwd(), '.sessions');
  try {
    if (!fs.existsSync(primaryDir)) {
      fs.mkdirSync(primaryDir, { recursive: true });
    }
    return path.join(primaryDir, 'lockouts.json');
  } catch {
    const fallbackDir = path.join(os.tmpdir(), 'cpicrs_sessions');
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return path.join(fallbackDir, 'lockouts.json');
  }
}

const lockoutFilePath = getStorageFilePath();

// In-memory cache synced with disk
const attemptStore = new Map<string, AttemptRecord>();

// Preload persisted records from disk
function loadFromDisk(): void {
  try {
    if (fs.existsSync(lockoutFilePath)) {
      const raw = fs.readFileSync(lockoutFilePath, 'utf8');
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [key, record] of Object.entries(data)) {
        const r = record as AttemptRecord;
        if (r.lockedUntil > now || (now - r.lastAttemptAt) < ATTEMPT_RESET_WINDOW_MS) {
          attemptStore.set(key, r);
        }
      }
    }
  } catch (err) {
    console.warn('[LOGIN SECURITY] Failed to preload lockouts from disk:', err);
  }
}

loadFromDisk();

function saveToDisk(): void {
  try {
    const obj: Record<string, AttemptRecord> = {};
    const now = Date.now();
    for (const [key, record] of attemptStore.entries()) {
      if (record.lockedUntil > now || (now - record.lastAttemptAt) < ATTEMPT_RESET_WINDOW_MS) {
        obj[key] = record;
      }
    }
    fs.writeFileSync(lockoutFilePath, JSON.stringify(obj), 'utf8');
  } catch (err) {
    console.warn('[LOGIN SECURITY] Failed to save lockouts to disk:', err);
  }
}

function getSecretKey(): string {
  return (process.env.SESSION_SECRET || 'stacruz-security-lockout-secret-salt').trim();
}

/**
 * Normalizes IPv4 and IPv6 localhost addresses so GET and POST requests match reliably
 */
export function normalizeIp(rawIp: string): string {
  if (!rawIp) return '127.0.0.1';
  let ip = rawIp.trim();
  if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
    return '127.0.0.1';
  }
  if (ip.startsWith('::ffff:')) {
    return ip.replace('::ffff:', '');
  }
  return ip;
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  let raw = '';
  if (typeof forwarded === 'string') {
    raw = forwarded.split(',')[0].trim();
  } else {
    raw = req.ip || req.socket.remoteAddress || 'unknown';
  }
  return normalizeIp(raw);
}

/**
 * Creates a signed lockout token
 */
function createSignedLockout(lockedUntil: number): string {
  const data = String(lockedUntil);
  const signature = crypto.createHmac('sha256', getSecretKey()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verifies and parses signed lockout token from cookie
 */
function verifySignedLockout(token?: string): number | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', getSecretKey()).update(data).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const lockedUntil = parseInt(data, 10);
  if (isNaN(lockedUntil) || lockedUntil <= Date.now()) {
    return null;
  }

  return lockedUntil;
}

/**
 * Checks if the current request is under a 5-minute lockout.
 * Returns remaining seconds, or 0 if not locked out.
 */
export function getLockoutRemainingSeconds(req: Request, username?: string): number {
  const now = Date.now();

  // 1. Check signed lockout cookie
  const cookieLockedUntil = verifySignedLockout(req.cookies?.cpicrs_lockout);
  if (cookieLockedUntil && cookieLockedUntil > now) {
    return Math.ceil((cookieLockedUntil - now) / 1000);
  }

  // 2. Check unsigned helper cookie (fallback verification)
  const plainTimeStr = req.cookies?.cpicrs_lockout_time;
  if (plainTimeStr) {
    const plainTime = parseInt(plainTimeStr, 10);
    if (!isNaN(plainTime) && plainTime > now && plainTime <= (now + LOCKOUT_DURATION_MS + 60000)) {
      return Math.ceil((plainTime - now) / 1000);
    }
  }

  // 3. Check session
  const sessionLockedUntil = (req.session as any)?.lockedUntil;
  if (sessionLockedUntil && typeof sessionLockedUntil === 'number' && sessionLockedUntil > now) {
    return Math.ceil((sessionLockedUntil - now) / 1000);
  }

  // 4. Check IP address (normalized)
  const ip = getClientIp(req);
  const ipRecord = attemptStore.get(`ip:${ip}`);
  if (ipRecord && ipRecord.lockedUntil > now) {
    return Math.ceil((ipRecord.lockedUntil - now) / 1000);
  }

  // 5. Check username in store
  if (username) {
    const cleanUser = username.toLowerCase().trim();
    const userRecord = attemptStore.get(`user:${cleanUser}`);
    if (userRecord && userRecord.lockedUntil > now) {
      return Math.ceil((userRecord.lockedUntil - now) / 1000);
    }
  }

  return 0;
}

/**
 * Records a failed login attempt.
 * If 5 failed attempts are reached, locks the user out for 5 minutes.
 */
export function recordFailedAttempt(
  req: Request,
  res: Response,
  username?: string
): { isLocked: boolean; attemptsLeft: number; remainingSeconds: number; lockedUntil: number } {
  const now = Date.now();
  const ip = getClientIp(req);
  const cleanUser = username ? username.toLowerCase().trim() : '';

  // Retrieve current attempt count from session, IP, or user
  const sessionData = req.session as any;
  let count = (sessionData?.failedLoginAttempts || 0) + 1;

  const ipRecord = attemptStore.get(`ip:${ip}`);
  if (ipRecord && (now - ipRecord.lastAttemptAt) < ATTEMPT_RESET_WINDOW_MS) {
    count = Math.max(count, ipRecord.count + 1);
  }

  if (cleanUser) {
    const userRecord = attemptStore.get(`user:${cleanUser}`);
    if (userRecord && (now - userRecord.lastAttemptAt) < ATTEMPT_RESET_WINDOW_MS) {
      count = Math.max(count, userRecord.count + 1);
    }
  }

  if (count >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_DURATION_MS;

    // Update in-memory & disk store
    attemptStore.set(`ip:${ip}`, { count: 0, lockedUntil, lastAttemptAt: now });
    if (cleanUser) {
      attemptStore.set(`user:${cleanUser}`, { count: 0, lockedUntil, lastAttemptAt: now });
    }
    saveToDisk();

    // Update session
    if (sessionData) {
      sessionData.failedLoginAttempts = 0;
      sessionData.lockedUntil = lockedUntil;
    }

    // 1. Set signed httpOnly cookie
    const token = createSignedLockout(lockedUntil);
    res.cookie('cpicrs_lockout', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: LOCKOUT_DURATION_MS
    });

    // 2. Set client-readable cookie so browser JS & localStorage sync on refresh
    res.cookie('cpicrs_lockout_time', String(lockedUntil), {
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: LOCKOUT_DURATION_MS
    });

    console.warn(`[SECURITY LOCKOUT TRIGGERED] IP ${ip} (Target: ${cleanUser || 'N/A'}) exceeded ${MAX_FAILED_ATTEMPTS} attempts. Locked out for 5 minutes.`);

    return {
      isLocked: true,
      attemptsLeft: 0,
      remainingSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000),
      lockedUntil
    };
  }

  // Record intermediate failed attempt
  attemptStore.set(`ip:${ip}`, { count, lockedUntil: 0, lastAttemptAt: now });
  if (cleanUser) {
    attemptStore.set(`user:${cleanUser}`, { count, lockedUntil: 0, lastAttemptAt: now });
  }
  saveToDisk();

  if (sessionData) {
    sessionData.failedLoginAttempts = count;
  }

  return {
    isLocked: false,
    attemptsLeft: MAX_FAILED_ATTEMPTS - count,
    remainingSeconds: 0,
    lockedUntil: 0
  };
}

/**
 * Resets failed attempt counter on successful login.
 */
export function clearFailedAttempts(req: Request, res: Response, username?: string): void {
  const ip = getClientIp(req);
  attemptStore.delete(`ip:${ip}`);

  if (username) {
    const cleanUser = username.toLowerCase().trim();
    attemptStore.delete(`user:${cleanUser}`);
  }
  saveToDisk();

  if (req.session) {
    delete (req.session as any).failedLoginAttempts;
    delete (req.session as any).lockedUntil;
  }

  res.clearCookie('cpicrs_lockout', { path: '/' });
  res.clearCookie('cpicrs_lockout_time', { path: '/' });
}

export function formatLockoutDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0 && secs > 0) {
    return `${mins} minute${mins > 1 ? 's' : ''} and ${secs} second${secs > 1 ? 's' : ''}`;
  }
  if (mins > 0) {
    return `${mins} minute${mins > 1 ? 's' : ''}`;
  }
  return `${secs} second${secs > 1 ? 's' : ''}`;
}
