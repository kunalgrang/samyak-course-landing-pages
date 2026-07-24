import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { WorkerBindings, WorkerVariables } from "./bindings";
import { cacheControlMiddleware } from "./middleware/cache";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { registerAuthRoutes } from "./routes/auth";
import { registerConfigRoutes } from "./routes/config";
import { registerHealthRoutes } from "./routes/health";
import { registerStudentRoutes } from "./routes/student";
import { jsonError } from "./lib/json-response";

const app = new Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>();

app.use("*", requestIdMiddleware);
app.use("*", securityHeadersMiddleware);
app.use("/api/*", cacheControlMiddleware);

registerHealthRoutes(app);
registerConfigRoutes(app);
registerAuthRoutes(app);
registerStudentRoutes(app);

app.notFound((c) =>
  jsonError(c, {
    status: 404,
    code: "not_found",
    message: "Route not found",
  }),
);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return jsonError(c, {
      status: error.status,
      code: "http_error",
      message: error.message,
    });
  }

  const isProduction = c.env?.SESSION_PEPPER !== undefined;

  return jsonError(c, {
    status: 500,
    code: "internal_error",
    message: isProduction ? "Internal server error" : "Internal server error",
  });
});

export default app;
