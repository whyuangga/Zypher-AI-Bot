const WINDOW_MS = 60_000;

/** Map<key, timestamp[]> — disimpan di memori, cukup untuk satu proses bot. */
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Sliding window sederhana: maksimal `limit` permintaan per 60 detik per key.
 * limit = 0 berarti tanpa batas.
 */
export function checkRateLimit(key: string, limit: number): RateLimitResult {
  if (limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };

  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((time) => now - time < WINDOW_MS);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] ?? now;
    buckets.set(key, timestamps);
    return { allowed: false, remaining: 0, retryAfterMs: WINDOW_MS - (now - oldest) };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true, remaining: limit - timestamps.length, retryAfterMs: 0 };
}

/** Bersihkan entri lama secara berkala supaya Map tidak tumbuh tanpa batas. */
export function startRateLimitJanitor(intervalMs = 5 * 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of buckets) {
      const fresh = timestamps.filter((time) => now - time < WINDOW_MS);
      if (fresh.length === 0) buckets.delete(key);
      else buckets.set(key, fresh);
    }
  }, intervalMs);

  timer.unref();
  return timer;
}
