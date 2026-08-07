import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { WorkerBindings, WorkerVariables } from "./bindings";
import { cacheControlMiddleware } from "./middleware/cache";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { registerAuthRoutes } from "./routes/auth";
import { registerConfigRoutes } from "./routes/config";
import { registerHealthRoutes } from "./routes/health";
import { registerStaffStudentRoutes } from "./routes/staff-students";
import { registerStaffAdmissionRoutes } from "./routes/staff-admissions";
import { registerStudentRoutes } from "./routes/student";
import { registerPublicReferralRoutes } from "./routes/public-referrals";
import { AuthConfigurationError } from "./lib/auth-store";
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
registerPublicReferralRoutes(app);
registerStaffStudentRoutes(app);
registerStaffAdmissionRoutes(app);

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

  if (error instanceof AuthConfigurationError) {
    return jsonError(c, {
      status: 500,
      code: "server_configuration_error",
      message: "Authentication is temporarily unavailable.",
    });
  }

  return jsonError(c, {
    status: 500,
    code: "internal_error",
    message: "Internal server error",
  });
});

export default app;
