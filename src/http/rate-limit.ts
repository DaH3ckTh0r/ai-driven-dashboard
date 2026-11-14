export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now: () => number;
}

/** Fixed-window limiter per key (for example a client address). Counts in memory. */
export function createRateLimiter(options: RateLimitOptions): { hit: (key: string) => boolean } {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const now = options.now();
      const current = windows.get(key);
      if (!current || now - current.start >= options.windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= options.limit;
    },
  };
}
