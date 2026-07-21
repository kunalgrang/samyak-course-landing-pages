import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { jsonPlain } from "../lib/json-response";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const version = "0.1.0";

export function registerHealthRoutes(app: PortalHono) {
  app.get("/api/health", (c) =>
    jsonPlain(c, {
      success: true,
      service: "samyak-student-portal",
    }),
  );

  app.get("/api/version", (c) =>
    jsonPlain(c, {
      success: true,
      service: "samyak-student-portal",
      version,
    }),
  );
}
