import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { getOrganisationSettings, organisationSettingsSchema, updateOrganisationSettings } from "../lib/organisation-settings";
import { getOrganisationPaymentPlanPolicy, paymentPlanPolicyUpdateSchema, updateOrganisationPaymentPlanPolicy } from "../lib/payment-plan-policy";
import { requireStaffRoles, staffOrganisationId } from "../lib/staff-auth";

type PortalHono = Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>;

export function registerStaffOrganisationSettingsRoutes(app: PortalHono) {
  app.get("/api/staff/organisation-settings", async (c) => {
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const settings = await getOrganisationSettings(c, staffOrganisationId(staff));
    if (!settings) return jsonError(c, { status: 404, code: "organisation_not_found", message: "Organisation was not found." });
    return jsonPlain(c, { success: true, organisation: settings });
  });

  app.patch("/api/staff/organisation-settings", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const body = await readJsonBody(c, organisationSettingsSchema);
    if (isResponse(body)) return body;
    const result = await updateOrganisationSettings(c, staff, body);
    if (!result.ok) return jsonError(c, { status: result.status, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, organisation: result.settings, changedFields: result.changedFields });
  });

  app.get("/api/staff/organisation-settings/payment-plan-policy", async (c) => {
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    return jsonPlain(c, { success: true, policy: await getOrganisationPaymentPlanPolicy(c, staffOrganisationId(staff)) });
  });

  app.put("/api/staff/organisation-settings/payment-plan-policy", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const body = await readJsonBody(c, paymentPlanPolicyUpdateSchema);
    if (isResponse(body)) return body;
    const result = await updateOrganisationPaymentPlanPolicy(c, staff, body);
    if (!result.ok) return jsonError(c, { status: result.status, code: result.code, message: result.message, fieldErrors: "fieldErrors" in result && result.fieldErrors ? result.fieldErrors : undefined });
    return jsonPlain(c, { success: true, policy: result.policy, changedRuleIds: result.changedRuleIds });
  });
}

function forbiddenOwner(c: Parameters<typeof readJsonBody>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Owner access is required." });
}
