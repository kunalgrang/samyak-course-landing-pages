import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { jsonError, jsonPlain } from "../lib/json-response";
import { getOrganisationOnboardingSnapshot } from "../lib/organisation-onboarding";
import { requireStaffRoles, staffOrganisationId } from "../lib/staff-auth";

type PortalHono = Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>;

export function registerStaffOnboardingRoutes(app: PortalHono) {
  app.get("/api/staff/onboarding", async (c) => {
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const result = await getOrganisationOnboardingSnapshot(c, staffOrganisationId(staff));
    if (!result.ok) return jsonError(c, { status: result.status, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, ...result.snapshot });
  });
}

function forbiddenOwner(c: Parameters<typeof jsonError>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Owner access is required." });
}
