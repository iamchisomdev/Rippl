import { createHmac, timingSafeEqual } from "crypto";
import type { Context, MiddlewareHandler } from "hono";

class RateLimiter {
  private store = new Map<string, { count: number; reset: number }>();
  check(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.reset < now) {
      this.store.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  }
}

const globalLimiter = new RateLimiter();
const apiLimiter = new RateLimiter();
const createLimiter = new RateLimiter();

export function getIP(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  // hono on node-server
  const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming?.socket?.remoteAddress;
  return remote || "unknown";
}

function tooMany(c: Context) {
  return c.json(
    { error: { code: "rate_limited", message: "Too many requests" } },
    429
  );
}

export function rateLimitByIP(max: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    const ip = getIP(c);
    if (!globalLimiter.check(`ip:${ip}`, max, windowMs)) return tooMany(c);
    await next();
  };
}

export function rateLimitByProject(max: number): MiddlewareHandler {
  return async (c, next) => {
    const pid = c.req.header("x-project-id") || c.req.param("projectId") || "none";
    if (!apiLimiter.check(`pj:${pid}`, max, 60_000)) return tooMany(c);
    await next();
  };
}

export function rateLimitCreate(): MiddlewareHandler {
  return async (c, next) => {
    const ip = getIP(c);
    if (!createLimiter.check(`create:${ip}`, 5, 60 * 60 * 1000)) return tooMany(c);
    await next();
  };
}

export function verifyPaystackWebhook(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function sanitise(input: string): string {
  return input.replace(/\x00/g, "").trim().slice(0, 1000);
}

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src *;"
    );
  };
}
