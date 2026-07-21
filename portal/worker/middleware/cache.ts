import type { MiddlewareHandler } from "hono";

export const cacheControlMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};
