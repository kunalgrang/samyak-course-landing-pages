import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { centreCreateSchema, centreUpdateSchema, createCentre, getCentre, listCentres, updateCentre } from "../lib/centre-management";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>;

export function registerStaffCentreRoutes(app: PortalHono) {
  app.get("/api/staff/centres", async (c) => {
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    return jsonPlain(c, { success: true, centres: await listCentres(c, staff) });
  });

  app.post("/api/staff/centres", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const body = await readJsonBody(c, centreCreateSchema);
    if (isResponse(body)) return body;
    const result = await createCentre(c, staff, body);
    if (!result.ok) return jsonError(c, { status: result.status, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, centre: result.centre }, { status: 201 });
  });

  app.get("/api/staff/centres/:centreId", async (c) => {
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const centre = await getCentre(c, staff, c.req.param("centreId"));
    if (!centre) return jsonError(c, { status: 404, code: "centre_not_found", message: "Centre was not found." });
    return jsonPlain(c, { success: true, centre });
  });

  app.patch("/api/staff/centres/:centreId", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const body = await readJsonBody(c, centreUpdateSchema);
    if (isResponse(body)) return body;
    const result = await updateCentre(c, staff, c.req.param("centreId"), body);
    if (!result.ok) return jsonError(c, { status: result.status, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, centre: result.centre, changedFields: result.changedFields });
  });
}

function forbiddenOwner(c: Parameters<typeof readJsonBody>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Owner access is required." });
}
