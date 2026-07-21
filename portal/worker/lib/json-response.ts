import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerBindings, WorkerVariables } from "../bindings";

type AppContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

type SuccessBody<T> = {
  success: true;
  data: T;
};

type ErrorBody = {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

type JsonInit = {
  status?: ContentfulStatusCode;
  headers?: Record<string, string | string[]>;
};

export function jsonOk<T>(c: AppContext, data: T, init?: JsonInit) {
  return c.json<SuccessBody<T>>(
    {
      success: true,
      data,
    },
    init?.status ?? 200,
    init?.headers,
  );
}

export function jsonPlain<T extends Record<string, unknown>>(c: AppContext, data: T, init?: JsonInit) {
  return c.json(data, init?.status ?? 200, init?.headers);
}

export function jsonError(
  c: AppContext,
  {
    status,
    code,
    message,
  }: {
    status: ContentfulStatusCode;
    code: string;
    message: string;
  },
) {
  return c.json<ErrorBody>(
    {
      success: false,
      error: {
        code,
        message,
        requestId: c.get("requestId"),
      },
    },
    status,
  );
}
