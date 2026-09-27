/**
 * Small in-memory rate limiter (no extra dependency).
 *
 * Purpose: blunt credential brute-forcing on /auth/login and spam floods on the
 * anonymous write endpoints (public booking, lead, review). Counters live in the
 * process, which is the right scope for a single-instance Node deployment;
 * behind multiple instances put a real limiter at the edge as well.
 *
 * Failed attempts are what we want to bound on auth, so the limiter counts every
 * request on the route and is generous enough not to affect real staff.
 */

const buckets = new Map();

// Keep the map from growing without bound on a long-running process.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

/**
 * Identify the caller for bucketing.
 *
 * Express already derives `req.ip` correctly: it ignores the client-supplied
 * `X-Forwarded-For` entirely unless `app.set("trust proxy", …)` is configured.
 * Reading that header here directly was a straight bypass — any caller could
 * send a different value on every request and get a fresh bucket, defeating the
 * login brute-force limit, the public-booking spam limit and the attendance
 * device limit.
 */
function clientKey(req) {
  // `trust proxy` is an app-level setting; ask Express what it resolved.
  const trustProxy = req.app && req.app.get("trust proxy");
  if (trustProxy) {
    const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return String(forwarded);
  }
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

/**
 * @param {{ windowMs?: number, max?: number, key?: (req) => string, message?: string }} options
 * @returns {import("express").RequestHandler}
 */
function rateLimit(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 60;
  const message = options.message || "Too many requests — please try again shortly.";
  const keyOf = options.key || clientKey;

  return function rateLimitMiddleware(req, res, next) {
    // Never rate-limit the health check or a preflight.
    if (req.method === "OPTIONS") return next();

    const key = `${req.baseUrl}${req.path}:${keyOf(req)}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      return res.status(429).json({ msg: message });
    }
    next();
  };
}

module.exports = { rateLimit, clientKey };
