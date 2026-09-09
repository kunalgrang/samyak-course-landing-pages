import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { fieldErrorsFromIssues } from "../lib/admission-service";
import { requireSameOrigin } from "../lib/http";
import {
  COLLECTION_STAFF_ROLES,
  collectionQuerySchema,
  createCollectionFollowup,
  createCollectionFollowupSchema,
  getCollectionDetail,
  listCollections,
} from "../lib/collections";
import { jsonError, jsonPlain } from "../lib/json-response";
import { requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function registerStaffCollectionRoutes(app: PortalHono) {
  app.get("/api/staff/collections", async (c) => {
    const staff = await requireStaffRoles(c, COLLECTION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = collectionQuerySchema.safeParse({
      status: c.req.query("status") || "overdue",
      agingBucket: c.req.query("agingBucket") || "",
      branchId: c.req.query("branchId") || "",
      courseId: c.req.query("courseId") || "",
      search: c.req.query("search") || "",
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_collections_query", message: "Check collections filters and pagination.", fieldErrors: fieldErrorsFromIssues(parsed.error.issues) });
    return jsonPlain(c, await listCollections(c, staff, parsed.data));
  });

  app.get("/api/staff/collections/:enrolmentId", async (c) => {
    const staff = await requireStaffRoles(c, COLLECTION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const result = await getCollectionDetail(c, staff, c.req.param("enrolmentId"));
    if (!result.ok) return collectionError(c, result);
    return jsonPlain(c, result);
  });

  app.post("/api/staff/collections/:enrolmentId/follow-ups", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, COLLECTION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = createCollectionFollowupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_collection_followup", message: "Please correct follow-up details.", fieldErrors: fieldErrorsFromIssues(parsed.error.issues) });
    const result = await createCollectionFollowup(c, staff, c.req.param("enrolmentId"), parsed.data);
    if (!result.ok) return collectionError(c, result);
    return jsonPlain(c, result, { status: 201 });
  });
}

function forbidden(c: Parameters<typeof jsonError>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Collections access is required." });
}

function collectionError(c: Parameters<typeof jsonError>[0], result: { status: number; code: string; message: string; fieldErrors?: Record<string, string[]> }) {
  return jsonError(c, { status: result.status as ContentfulStatusCode, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
}
