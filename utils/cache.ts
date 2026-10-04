import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';

dotenv.config();

interface LocalCacheEntry {
  data: any;
  expiresAt: number;
}

/**
 * Hybrid multi-tier cache manager:
 * - Tier 1 (L1): Local In-Memory LRU Map (sub-millisecond access)
 * - Tier 2 (L2): Upstash Redis (shared across distributed serverless lambdas / Node instances)
 * 
 * Automatically falls back to in-memory mode if Redis credentials are not configured or unreachable.
 */
class HybridCache {
  private localCache = new Map<string, LocalCacheEntry>();
  private maxLocalItems = 500;
  private redis: Redis | null = null;
  private isRedisConfigured = false;

  constructor() {
    const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || '').trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || '').trim();

    if (url && token) {
      try {
        this.redis = new Redis({ url, token });
        this.isRedisConfigured = true;
        console.log('[CACHE] HybridCache initialized with Upstash Redis (L2) & In-Memory (L1).');
      } catch (err: any) {
        console.warn('[CACHE] Failed to initialize Redis client. Falling back to local L1 memory only:', err?.message || err);
      }
    } else {
      console.log('[CACHE] HybridCache running in local L1 In-Memory mode (UPSTASH_REDIS_REST_URL not configured).');
    }
  }

  /**
   * Synchronous check on L1 In-Memory cache
   */
  getSync<T>(key: string): T | null {
    const entry = this.localCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.localCache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Asynchronous get: checks L1 (Memory) first (<1ms), then L2 (Redis) (5-15ms)
   */
  async get<T>(key: string): Promise<T | null> {
    const now = Date.now();

    // 1. Check L1 Memory Cache
    const local = this.localCache.get(key);
    if (local && local.expiresAt > now) {
      return local.data as T;
    }
    if (local) {
      this.localCache.delete(key);
    }

    // 2. Check L2 Redis Cache (if configured)
    if (this.isRedisConfigured && this.redis) {
      try {
        const raw = await this.redis.get<any>(key);
        if (raw !== null && raw !== undefined) {
          let parsed = raw;
          if (typeof raw === 'string') {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }
          // Populate L1 cache for subsequent fast local reads (1 min or remaining TTL)
          this.setLocal(key, parsed, 60 * 1000);
          return parsed as T;
        }
      } catch (err: any) {
        console.warn(`[CACHE WARNING] Redis get failed for key "${key}":`, err?.message || err);
      }
    }

    return null;
  }

  /**
   * Set cache entry in both L1 (Memory) and L2 (Redis)
   */
  async set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): Promise<void> {
    // Write L1 synchronously
    this.setLocal(key, data, ttlMs);

    // Write L2 asynchronously
    if (this.isRedisConfigured && this.redis) {
      try {
        const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        await this.redis.set(key, payload, { ex: ttlSeconds });
      } catch (err: any) {
        console.warn(`[CACHE WARNING] Redis set failed for key "${key}":`, err?.message || err);
      }
    }
  }

  /**
   * Delete specific key from both L1 and L2
   */
  async del(key: string): Promise<void> {
    this.localCache.delete(key);

    if (this.isRedisConfigured && this.redis) {
      try {
        await this.redis.del(key);
      } catch (err: any) {
        console.warn(`[CACHE WARNING] Redis del failed for key "${key}":`, err?.message || err);
      }
    }
  }

  /**
   * Clear all cache entries starting with a prefix/namespace
   */
  async clearNamespace(prefix: string): Promise<void> {
    // 1. Clear L1 local keys immediately
    for (const key of Array.from(this.localCache.keys())) {
      if (key.startsWith(prefix)) {
        this.localCache.delete(key);
      }
    }

    // 2. Clear L2 Redis keys matching prefix
    if (this.isRedisConfigured && this.redis) {
      try {
        let cursor: any = 0;
        do {
          const res: any = await this.redis.scan(cursor, { match: `${prefix}*`, count: 100 });
          cursor = res[0];
          const keys: string[] = res[1] || [];
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
        } while (cursor !== 0 && cursor !== '0');
      } catch (err: any) {
        console.warn(`[CACHE WARNING] Redis clearNamespace failed for prefix "${prefix}":`, err?.message || err);
      }
    }
  }

  /**
   * Clear entire cache
   */
  async flush(): Promise<void> {
    this.localCache.clear();

    if (this.isRedisConfigured && this.redis) {
      try {
        await this.redis.flushdb();
      } catch (err: any) {
        console.warn('[CACHE WARNING] Redis flushdb failed:', err?.message || err);
      }
    }
  }

  private setLocal<T>(key: string, data: T, ttlMs: number): void {
    if (this.localCache.size >= this.maxLocalItems) {
      const oldestKey = this.localCache.keys().next().value;
      if (oldestKey) this.localCache.delete(oldestKey);
    }
    this.localCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }
}

export const memoryCache = new HybridCache();
