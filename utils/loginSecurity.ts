import { Request, Response } from 'express';
import crypto from 'crypto';

interface AttemptRecord {
  count: number;
  lockedUntil: number;
  lastAttemptAt: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_RESET_WINDOW_MS = 15 * 60 * 1000; // Reset counter after 15 min of inactivity

// In-memory cache for IP and username tracking
const attemptStore = new Map<string, AttemptRecord>();

function getSecretKey(): string {
  return (process.env.SESSION_SECRET || 'stacruz-security-lockout-secret-salt').trim();
}

/**
 * Creates a signed lockout token to prevent cookie tampering
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

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function cleanExpiredEntries() {
  const now = Date.now();
  for (const [key, record] of attemptStore.entries()) {
    if (record.lockedUntil < now && (now - record.lastAttemptAt) > ATTEMPT_RESET_WINDOW_MS) {
      attemptStore.delete(key);
    }
  }
}

// Periodically clean memory store
setInterval(cleanExpiredEntries, 10 * 60 * 1000).unref?.();

/**
 * Checks if the current request is currently under a 5-minute lockout.
 * Returns the remaining seconds, or 0 if not locked out.
 */
export function getLockoutRemainingSeconds(req: Request, username?: string): number {
  const now = Date.now();

  // 1. Check signed lockout cookie
  const cookieLockedUntil = verifySignedLockout(req.cookies?.cpicrs_lockout);
  if (cookieLockedUntil && cookieLockedUntil > now) {
    return Math.ceil((cookieLockedUntil - now) / 1000);
  }

  // 2. Check session
  const sessionLockedUntil = (req.session as any)?.lockedUntil;
  if (sessionLockedUntil && typeof sessionLockedUntil === 'number' && sessionLockedUntil > now) {
    return Math.ceil((sessionLockedUntil - now) / 1000);
  }

  // 3. Check IP address in store
  const ip = getClientIp(req);
  const ipRecord = attemptStore.get(`ip:${ip}`);
  if (ipRecord && ipRecord.lockedUntil > now) {
    return Math.ceil((ipRecord.lockedUntil - now) / 1000);
  }

  // 4. Check username in store
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
): { isLocked: boolean; attemptsLeft: number; remainingSeconds: number } {
  const now = Date.now();
  const ip = getClientIp(req);
  const cleanUser = username ? username.toLowerCase().trim() : '';

  // Retrieve current attempt count from session or in-memory store
  const sessionData = req.session as any;
  let count = (sessionData?.failedLoginAttempts || 0) + 1;

  // Check IP record
  const ipRecord = attemptStore.get(`ip:${ip}`);
  if (ipRecord && (now - ipRecord.lastAttemptAt) < ATTEMPT_RESET_WINDOW_MS) {
    count = Math.max(count, ipRecord.count + 1);
  }

  // Check User record
  if (cleanUser) {
    const userRecord = attemptStore.get(`user:${cleanUser}`);
    if (userRecord && (now - userRecord.lastAttemptAt) < ATTEMPT_RESET_WINDOW_MS) {
      count = Math.max(count, userRecord.count + 1);
    }
  }

  if (count >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = now + LOCKOUT_DURATION_MS;

    // Update in-memory records
    attemptStore.set(`ip:${ip}`, { count: 0, lockedUntil, lastAttemptAt: now });
    if (cleanUser) {
      attemptStore.set(`user:${cleanUser}`, { count: 0, lockedUntil, lastAttemptAt: now });
    }

    // Update session
    if (sessionData) {
      sessionData.failedLoginAttempts = 0;
      sessionData.lockedUntil = lockedUntil;
    }

    // Set signed cookie (5 minutes)
    const token = createSignedLockout(lockedUntil);
    res.cookie('cpicrs_lockout', token, {
      httpOnly: true,
      secure: false, // compatible behind reverse proxies
      sameSite: 'lax',
      path: '/',
      maxAge: LOCKOUT_DURATION_MS
    });

    console.warn(`[SECURITY LOCKOUT TRIGGERED] IP ${ip} (Target: ${cleanUser || 'N/A'}) exceeded ${MAX_FAILED_ATTEMPTS} attempts. Locked out for 5 minutes.`);

    return {
      isLocked: true,
      attemptsLeft: 0,
      remainingSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000)
    };
  }

  // Update records for non-locked attempt
  attemptStore.set(`ip:${ip}`, { count, lockedUntil: 0, lastAttemptAt: now });
  if (cleanUser) {
    attemptStore.set(`user:${cleanUser}`, { count, lockedUntil: 0, lastAttemptAt: now });
  }

  if (sessionData) {
    sessionData.failedLoginAttempts = count;
  }

  return {
    isLocked: false,
    attemptsLeft: MAX_FAILED_ATTEMPTS - count,
    remainingSeconds: 0
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

  if (req.session) {
    delete (req.session as any).failedLoginAttempts;
    delete (req.session as any).lockedUntil;
  }

  res.clearCookie('cpicrs_lockout', { path: '/' });
}

/**
 * Helper to format seconds into "M minutes and S seconds"
 */
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
