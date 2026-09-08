import session from 'express-session';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface SessionDataEntry {
  data: session.SessionData;
  expires: number;
}

export class FileSessionStore extends session.Store {
  private sessionsDir: string;
  private cache = new Map<string, SessionDataEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(customDir?: string) {
    super();

    // Default to .sessions in cwd, fallback to os.tmpdir() if not writable (e.g., serverless)
    const primaryDir = customDir || path.join(process.cwd(), '.sessions');
    this.sessionsDir = primaryDir;

    try {
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }
      // Test write permission
      const testFile = path.join(this.sessionsDir, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
    } catch (err) {
      console.warn(`[SESSION STORE] Primary directory ${primaryDir} unwritable, falling back to temp dir:`, err);
      this.sessionsDir = path.join(os.tmpdir(), 'cpicrs_sessions');
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }
    }

    console.log(`[SESSION STORE] Initialized durable session store at: ${this.sessionsDir}`);
    this.preloadFromDisk();

    // Run cleanup every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.reapExpired();
    }, 30 * 60 * 1000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  private sanitizeSid(sid: string): string {
    return sid.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private getFilePath(sid: string): string {
    return path.join(this.sessionsDir, `${this.sanitizeSid(sid)}.json`);
  }

  private preloadFromDisk(): void {
    try {
      if (!fs.existsSync(this.sessionsDir)) return;
      const files = fs.readdirSync(this.sessionsDir);
      const now = Date.now();
      let loaded = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const sid = file.replace(/\.json$/, '');
        const filePath = path.join(this.sessionsDir, file);

        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const entry: SessionDataEntry = JSON.parse(raw);

          if (entry.expires && entry.expires < now) {
            // Expired on disk, clean it up
            fs.unlinkSync(filePath);
          } else {
            this.cache.set(sid, entry);
            loaded++;
          }
        } catch {
          // Bad JSON or corrupted file, remove it
          try { fs.unlinkSync(filePath); } catch {}
        }
      }

      if (loaded > 0) {
        console.log(`[SESSION STORE] Restored ${loaded} active sessions from disk.`);
      }
    } catch (err) {
      console.error('[SESSION STORE] Error during preload:', err);
    }
  }

  private reapExpired(): void {
    const now = Date.now();
    for (const [sid, entry] of this.cache.entries()) {
      if (entry.expires && entry.expires < now) {
        this.cache.delete(sid);
        try {
          const filePath = this.getFilePath(sid);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch {}
      }
    }
  }

  get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
    try {
      const now = Date.now();
      const sanitized = this.sanitizeSid(sid);

      // Check in-memory cache first
      const cached = this.cache.get(sanitized);
      if (cached) {
        if (cached.expires && cached.expires < now) {
          this.cache.delete(sanitized);
          const filePath = this.getFilePath(sid);
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
          return callback(null, null);
        }
        return callback(null, cached.data);
      }

      // Check disk if not in cache
      const filePath = this.getFilePath(sid);
      if (!fs.existsSync(filePath)) {
        return callback(null, null);
      }

      const raw = fs.readFileSync(filePath, 'utf-8');
      const entry: SessionDataEntry = JSON.parse(raw);

      if (entry.expires && entry.expires < now) {
        try { fs.unlinkSync(filePath); } catch {}
        return callback(null, null);
      }

      this.cache.set(sanitized, entry);
      return callback(null, entry.data);
    } catch (err) {
      console.error(`[SESSION STORE] Error reading session ${sid}:`, err);
      return callback(null, null);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const sanitized = this.sanitizeSid(sid);
      const defaultMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 days default
      let expires = Date.now() + defaultMaxAge;

      if (sessionData.cookie) {
        if (sessionData.cookie.expires) {
          expires = new Date(sessionData.cookie.expires).getTime();
        } else if (typeof sessionData.cookie.maxAge === 'number') {
          expires = Date.now() + sessionData.cookie.maxAge;
        }
      }

      const entry: SessionDataEntry = {
        data: sessionData,
        expires
      };

      // Update memory cache
      this.cache.set(sanitized, entry);

      // Persist to disk
      const filePath = this.getFilePath(sid);
      fs.writeFile(filePath, JSON.stringify(entry), 'utf-8', (err) => {
        if (err) {
          console.error(`[SESSION STORE] Failed to write session ${sid} to disk:`, err);
        }
        if (callback) callback(null);
      });
    } catch (err) {
      console.error(`[SESSION STORE] Error saving session ${sid}:`, err);
      if (callback) callback(null);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const sanitized = this.sanitizeSid(sid);
      const defaultMaxAge = 30 * 24 * 60 * 60 * 1000;
      let expires = Date.now() + defaultMaxAge;

      if (sessionData.cookie) {
        if (sessionData.cookie.expires) {
          expires = new Date(sessionData.cookie.expires).getTime();
        } else if (typeof sessionData.cookie.maxAge === 'number') {
          expires = Date.now() + sessionData.cookie.maxAge;
        }
      }

      const cached = this.cache.get(sanitized);
      if (cached) {
        cached.expires = expires;
        cached.data.cookie = sessionData.cookie;
      } else {
        this.cache.set(sanitized, { data: sessionData, expires });
      }

      // Update file on disk asynchronously
      const filePath = this.getFilePath(sid);
      fs.writeFile(filePath, JSON.stringify({ data: sessionData, expires }), 'utf-8', () => {
        if (callback) callback(null);
      });
    } catch (err) {
      if (callback) callback(null);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      const sanitized = this.sanitizeSid(sid);
      this.cache.delete(sanitized);

      const filePath = this.getFilePath(sid);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {
          if (callback) callback(null);
        });
      } else {
        if (callback) callback(null);
      }
    } catch (err) {
      console.error(`[SESSION STORE] Error destroying session ${sid}:`, err);
      if (callback) callback(null);
    }
  }

  all(callback: (err: any, obj?: { [sid: string]: session.SessionData } | null) => void): void {
    const result: { [sid: string]: session.SessionData } = {};
    const now = Date.now();
    for (const [sid, entry] of this.cache.entries()) {
      if (!entry.expires || entry.expires >= now) {
        result[sid] = entry.data;
      }
    }
    callback(null, result);
  }

  length(callback: (err: any, length?: number) => void): void {
    const now = Date.now();
    let count = 0;
    for (const [, entry] of this.cache.entries()) {
      if (!entry.expires || entry.expires >= now) {
        count++;
      }
    }
    callback(null, count);
  }

  clear(callback?: (err?: any) => void): void {
    this.cache.clear();
    try {
      if (fs.existsSync(this.sessionsDir)) {
        const files = fs.readdirSync(this.sessionsDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.sessionsDir, file));
          }
        }
      }
    } catch {}
    if (callback) callback(null);
  }
}
