import type { MiddlewareHandler } from "hono";

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const inboundRequestId = c.req.header("x-request-id");
  const requestId = inboundRequestId && inboundRequestId.length <= 128 ? inboundRequestId : crypto.randomUUID();

  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);

  await next();
};
