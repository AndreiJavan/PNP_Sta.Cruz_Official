import * as crypto from 'crypto';

export interface AuthUserPayload {
  id: string;
  username: string;
  full_name: string;
  role: string;
}

interface TokenStructure {
  user: AuthUserPayload;
  iat: number;
  exp: number;
}

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecretKey(): string {
  return (process.env.SESSION_SECRET || 'stacruz-mapping-secure-session-key').trim();
}

/**
 * Creates a cryptographically signed, stateless authentication token.
 * Uses HMAC-SHA256 for tamper-proof verification across serverless lambdas and restarts.
 */
export function createAuthToken(user: any, maxAgeMs: number = DEFAULT_MAX_AGE_MS): string {
  const safeUser: AuthUserPayload = {
    id: String(user.id || user._id || ''),
    username: String(user.username || ''),
    full_name: String(user.full_name || user.fullName || user.username || ''),
    role: String(user.role || 'staff')
  };

  const payload: TokenStructure = {
    user: safeUser,
    iat: Date.now(),
    exp: Date.now() + maxAgeMs
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSecretKey())
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies the token signature using constant-time comparison.
 * Returns the decoded user object if valid and not expired, or null otherwise.
 */
export function verifyAuthToken(token?: string | null): AuthUserPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) return null;

  try {
    const expectedSignature = crypto
      .createHmac('sha256', getSecretKey())
      .update(payloadBase64)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const parsed: TokenStructure = JSON.parse(jsonStr);

    if (!parsed || !parsed.user || !parsed.exp) {
      return null;
    }

    // Check expiration
    if (Date.now() > parsed.exp) {
      return null;
    }

    return parsed.user;
  } catch (err) {
    return null;
  }
}

