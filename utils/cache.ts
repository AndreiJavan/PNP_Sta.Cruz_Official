interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxItems = 500;

  /**
   * Get cached data by key
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cache entry with custom TTL in milliseconds (default 5 minutes)
   */
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    // Prevent unbounded memory growth by evicting oldest entries if capacity reached
    if (this.cache.size >= this.maxItems) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Delete specific key from cache
   */
  del(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries starting with a prefix/namespace
   */
  clearNamespace(prefix: string): void {
    Array.from(this.cache.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    });
  }

  /**
   * Clear entire cache
   */
  flush(): void {
    this.cache.clear();
  }
}

export const memoryCache = new MemoryCache();
