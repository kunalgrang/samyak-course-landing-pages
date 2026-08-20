import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { WorkerBindings, WorkerVariables } from "./bindings";
import { cacheControlMiddleware } from "./middleware/cache";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { registerAuthRoutes } from "./routes/auth";
import { registerConfigRoutes } from "./routes/config";
import { registerHealthRoutes } from "./routes/health";
import { registerStaffStudentRoutes } from "./routes/staff-students";
import { registerStaffEnquiryCrmRoutes } from "./routes/staff-enquiry-crm";
import { registerStaffAdmissionRoutes } from "./routes/staff-admissions";
import { registerStaffPaymentRoutes } from "./routes/staff-payments";
import { registerStaffReferralRoutes } from "./routes/staff-referrals";
import { registerStudentRoutes } from "./routes/student";
import { registerPublicReferralRoutes } from "./routes/public-referrals";
import { registerCertificateRoutes } from "./routes/certificates";
import { AuthConfigurationError } from "./lib/auth-store";
import { jsonError } from "./lib/json-response";

const app = new Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>();
type AppContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

app.use("*", requestIdMiddleware);
app.use("*", securityHeadersMiddleware);
app.use("/api/*", cacheControlMiddleware);

registerHealthRoutes(app);
registerConfigRoutes(app);
registerAuthRoutes(app);
registerStudentRoutes(app);
registerPublicReferralRoutes(app);
registerStaffStudentRoutes(app);
registerStaffEnquiryCrmRoutes(app);
registerStaffAdmissionRoutes(app);
registerStaffPaymentRoutes(app);
registerStaffReferralRoutes(app);
registerCertificateRoutes(app);

app.notFound((c) =>
  jsonError(c, {
    status: 404,
    code: "not_found",
    message: "Route not found",
  }),
);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    logSafeServerError(c, "http_error", error.status);
    return jsonError(c, {
      status: error.status,
      code: "http_error",
      message: error.message,
    });
  }

  if (error instanceof AuthConfigurationError) {
    logSafeServerError(c, "server_configuration_error", 500);
    return jsonError(c, {
      status: 500,
      code: "server_configuration_error",
      message: "Authentication is temporarily unavailable.",
    });
  }

  logSafeServerError(c, "internal_error", 500);
  return jsonError(c, {
    status: 500,
    code: "internal_error",
    message: "Internal server error",
  });
});

function logSafeServerError(c: AppContext, category: string, status: number) {
  const url = new URL(c.req.url);
  console.error("worker_error", {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: url.pathname,
    status,
    category,
  });
}

export default app;
