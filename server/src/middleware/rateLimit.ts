/**
 * Per-IP rate limiting middleware (owner: D) — minimal abuse
 * protection for the public demo deployment. No external
 * dependency, no Redis, no shared state. A simple fixed-window
 * counter per client IP. Resets on process restart (acceptable for
 * a demo; Render Free sleeps after 15 min, so the window starts
 * fresh on cold start anyway).
 *
 * The middleware uses `req.ip`, which is computed by Express based
 * on the `trust proxy` setting. The server sets `trust proxy: 1`
 * (see index.ts) so that the first hop — Render's reverse proxy —
 * is trusted to set `X-Forwarded-For`. With that setting:
 *
 *   - On Render, the only way to reach the service is through
 *     Render's proxy, which always sets `X-Forwarded-For` to the
 *     real client IP. `req.ip` returns the real client IP, and each
 *     client gets a distinct bucket.
 *   - A direct connection (not possible on Render) would still have
 *     its `X-Forwarded-For` trusted by Express — but Render does not
 *     expose the service container directly, so this attack surface
 *     does not exist. The threat model is documented in
 * `docs/DEPLOYMENT.md` for future maintainers.
 *
 * Each successful request increments the bucket for that IP and
 * rejects (429) once the per-minute limit is exceeded.
 *
 * Configuration:
 *   RATE_LIMIT_PER_MINUTE=10    default; shared across
 *                               /api/v1/recommendations and
 *                               /api/v1/policies/bind (one bucket
 *                               per IP, not per endpoint, so a
 *                               spammer on either endpoint cannot
 *                               bypass by switching endpoints).
 *
 * Exposes `clearRateLimitBuckets()` for tests so the bucket map can
 * be reset between cases.
 */
import type { Request, Response, NextFunction } from 'express';

interface Counter {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Counter>();

export function perIpRateLimit(req: Request, res: Response, next: NextFunction): void {
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 10);
  // req.ip respects Express's `trust proxy` setting. With
  // `trust proxy: 1` in index.ts, Render's reverse proxy (the first
  // hop) is trusted to set X-Forwarded-For, so req.ip is the real
  // client IP — not a spoofable header value the client controlled.
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > limit) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: 'rate_limited', retryAfterSeconds });
    return;
  }
  next();
}

/** Test helper — resets the bucket map. Not exported from index.ts. */
export function clearRateLimitBuckets(): void {
  buckets.clear();
}