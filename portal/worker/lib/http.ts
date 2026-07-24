import { z } from "zod";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { jsonError } from "./json-response";

export type AppContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function requireSameOrigin(c: AppContext) {
  const origin = c.req.header("origin");
  const expected = new URL(c.req.url).origin;
  if (!origin || origin !== expected) {
    return jsonError(c, {
      status: 403,
      code: "invalid_origin",
      message: "Request origin is not allowed.",
    });
  }
  return null;
}

export async function readJsonBody<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T> | Response> {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonError(c, {
      status: 415,
      code: "json_required",
      message: "Only JSON requests are accepted.",
    });
  }

  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    return jsonError(c, {
      status: 400,
      code: "invalid_json",
      message: "Invalid JSON request.",
    });
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return jsonError(c, {
      status: 400,
      code: "invalid_request",
      message: "Please check the submitted details.",
    });
  }

  return parsed.data;
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

export function getClientIp(c: AppContext) {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

export function jsonWithRequestId<T extends Record<string, unknown>>(c: AppContext, body: T, status: ContentfulStatusCode = 200) {
  return c.json({ ...body, requestId: c.get("requestId") }, status);
}
