/**
 * A small in-memory rate limiter.
 *
 * Blinked runs as a single instance (SQLite on one disk), so an in-process map
 * is an accurate view of all traffic. If the app ever runs on more than one
 * instance this becomes per-instance and would need moving to the database or
 * a shared cache — noted here because it would fail quietly rather than loudly.
 *
 * Counters live only in memory, so a restart forgives everyone. That is the
 * right trade for deterring casual spam: the cost of a wrongly blocked couple
 * is much higher than the cost of letting a few extra messages through.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Drop expired entries so the map cannot grow without bound. */
function sweep(now: number): void {
  if (windows.size < 1000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Zero when allowed. */
  retryAfter: number;
}

/**
 * Count one attempt against `key`, allowing `limit` per `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count++;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Best-effort client address.
 *
 * Behind Render (and Cloudflare in front of it) the real address is in a
 * forwarded header; the first entry is the original client. This is only ever
 * used for rate limiting, never for identity or access control, because a
 * header can be set by anyone.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
