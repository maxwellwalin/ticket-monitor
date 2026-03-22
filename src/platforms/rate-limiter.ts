export interface RateLimiter {
  acquire(): Promise<void>;
}

/**
 * Simple interval-based rate limiter. Ensures at least `minIntervalMs`
 * between successive `acquire()` calls.
 */
export function createRateLimiter(minIntervalMs: number): RateLimiter {
  let lastRequestTime = 0;
  let pending = Promise.resolve();

  return {
    async acquire() {
      pending = pending.then(async () => {
        const now = Date.now();
        const elapsed = now - lastRequestTime;
        if (elapsed < minIntervalMs) {
          await new Promise<void>((r) =>
            setTimeout(r, minIntervalMs - elapsed)
          );
        }
        lastRequestTime = Date.now();
      });
      await pending;
    },
  };
}
