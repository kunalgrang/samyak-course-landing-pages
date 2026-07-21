import type { MiddlewareHandler } from "hono";

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const securityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  await next();

  for (const [header, value] of Object.entries(securityHeaders)) {
    c.header(header, value);
  }
};
