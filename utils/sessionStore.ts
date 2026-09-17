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
  private lastTouchDiskSync = new Map<string, number>();
  private writeQueues = new Map<string, Promise<void>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(customDir?: string) {
    super();

    // Resolve absolute path to .sessions directory
    const primaryDir = customDir ? path.resolve(customDir) : path.resolve(process.cwd(), '.sessions');
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

  /**
   * Serializes writes per session ID to prevent concurrent file lock clashes on Windows.
   */
  private queueFileWrite(sid: string, task: () => Promise<void>): Promise<void> {
    const sanitized = this.sanitizeSid(sid);
    const previous = this.writeQueues.get(sanitized) || Promise.resolve();
    const next = previous
      .catch(() => {}) // Ignore errors in previous task
      .then(task)
      .finally(() => {
        if (this.writeQueues.get(sanitized) === next) {
          this.writeQueues.delete(sanitized);
        }
      });
    this.writeQueues.set(sanitized, next);
    return next;
  }

  /**
   * Windows-resilient atomic file write with direct fallback.
   */
  private async safeWriteFileAsync(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2)}.tmp`;
    try {
      await fs.promises.writeFile(tmpPath, content, 'utf-8');
      try {
        await fs.promises.rename(tmpPath, filePath);
      } catch (renameErr: any) {
        // On Windows (EPERM, EBUSY, EXDEV), fall back to direct file write
        try { await fs.promises.unlink(tmpPath); } catch {}
        await fs.promises.writeFile(filePath, content, 'utf-8');
      }
    } catch (err) {
      // Clean up tmpPath if it still exists
      try { await fs.promises.unlink(tmpPath); } catch {}
      // Final fallback attempt: direct write
      try {
        await fs.promises.writeFile(filePath, content, 'utf-8');
      } catch (fallbackErr) {
        console.error('[SESSION STORE] Critical error writing session file:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  private calculateExpiration(sessionData: session.SessionData): number {
    const defaultMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    let expires = Date.now() + defaultMaxAge;

    if (sessionData && sessionData.cookie) {
      if (sessionData.cookie.expires) {
        const parsed = new Date(sessionData.cookie.expires).getTime();
        if (!isNaN(parsed) && parsed > Date.now()) {
          expires = parsed;
        }
      } else if (typeof sessionData.cookie.maxAge === 'number' && sessionData.cookie.maxAge > 0) {
        expires = Date.now() + sessionData.cookie.maxAge;
      }
    }
    return expires;
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
            try { fs.unlinkSync(filePath); } catch {}
          } else {
            this.cache.set(sid, entry);
            loaded++;
          }
        } catch {
          // Ignore corrupt file during preload
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
        this.lastTouchDiskSync.delete(sid);
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
          this.lastTouchDiskSync.delete(sanitized);
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
      console.error(`[SESSION STORE] Warning reading session ${sid} from disk, falling back to cache if present:`, err);
      const sanitized = this.sanitizeSid(sid);
      const cached = this.cache.get(sanitized);
      if (cached && (!cached.expires || cached.expires >= Date.now())) {
        return callback(null, cached.data);
      }
      return callback(null, null);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const sanitized = this.sanitizeSid(sid);
      const expires = this.calculateExpiration(sessionData);

      const entry: SessionDataEntry = {
        data: sessionData,
        expires
      };

      // Update memory cache immediately
      this.cache.set(sanitized, entry);
      this.lastTouchDiskSync.set(sanitized, Date.now());

      // Persist to disk serialized via queue
      const filePath = this.getFilePath(sid);
      const content = JSON.stringify(entry);

      this.queueFileWrite(sid, async () => {
        await this.safeWriteFileAsync(filePath, content);
      }).then(() => {
        if (callback) callback(null);
      }).catch((err) => {
        if (callback) callback(null); // Do not crash session on background disk write warning
      });
    } catch (err) {
      console.error(`[SESSION STORE] Error saving session ${sid}:`, err);
      if (callback) callback(null);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const sanitized = this.sanitizeSid(sid);
      const expires = this.calculateExpiration(sessionData);

      const cached = this.cache.get(sanitized);
      if (cached) {
        cached.expires = expires;
        cached.data.cookie = sessionData.cookie;
      } else {
        this.cache.set(sanitized, { data: sessionData, expires });
      }

      // Throttle disk writes for touch: at most once per 60 seconds per session
      // This prevents high-frequency disk I/O lock contention on Windows during rapid page navigation
      const lastSync = this.lastTouchDiskSync.get(sanitized) || 0;
      const now = Date.now();
      if (now - lastSync < 60 * 1000) {
        if (callback) callback(null);
        return;
      }
      this.lastTouchDiskSync.set(sanitized, now);

      const filePath = this.getFilePath(sid);
      const content = JSON.stringify({ data: sessionData, expires });

      this.queueFileWrite(sid, async () => {
        await this.safeWriteFileAsync(filePath, content);
      }).then(() => {
        if (callback) callback(null);
      }).catch(() => {
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
      this.lastTouchDiskSync.delete(sanitized);

      const filePath = this.getFilePath(sid);
      this.queueFileWrite(sid, async () => {
        try {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
          }
        } catch {}
      }).then(() => {
        if (callback) callback(null);
      }).catch(() => {
        if (callback) callback(null);
      });
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
    this.lastTouchDiskSync.clear();
    try {
      if (fs.existsSync(this.sessionsDir)) {
        const files = fs.readdirSync(this.sessionsDir);
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.tmp')) {
            try { fs.unlinkSync(path.join(this.sessionsDir, file)); } catch {}
          }
        }
      }
    } catch {}
    if (callback) callback(null);
  }
}
