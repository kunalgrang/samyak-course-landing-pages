import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import {
  BATCH_MANAGE_ROLES,
  BATCH_READ_ROLES,
  batchAssignmentSchema,
  batchInputSchema,
  batchPatchSchema,
  batchTransferSchema,
  createBatch,
  getBatchDetail,
  listAdmissionEligibleBatches,
  listBatches,
  listEligibleEnrolments,
  listTrainers,
  removeBatchMembershipFromBatch,
  transferBatchMembership,
  assignEnrolmentToBatch,
  updateBatch,
} from "../lib/batch-management";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function registerStaffBatchRoutes(app: PortalHono) {
  app.get("/api/staff/batches", async (c) => {
    const staff = await requireStaffRoles(c, BATCH_READ_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const result = await listBatches(c, staff, {
      branchId: url.searchParams.get("branchId") || undefined,
      courseId: url.searchParams.get("courseId") || undefined,
      status: url.searchParams.get("status") || "active",
      q: url.searchParams.get("q") || "",
    });
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, batches: result.batches });
  });

  app.post("/api/staff/batches", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, BATCH_MANAGE_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, batchInputSchema);
    if (isResponse(body)) return body;
    const result = await createBatch(c, staff, body);
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, batchId: result.batchId });
  });

  app.get("/api/staff/batches/trainers", async (c) => {
    const staff = await requireStaffRoles(c, BATCH_READ_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const result = await listTrainers(c, staff, url.searchParams.get("branchId") || undefined);
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, trainers: result.trainers });
  });

  app.get("/api/staff/batches/admission-options", async (c) => {
    const staff = await requireStaffRoles(c, BATCH_READ_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const branchId = url.searchParams.get("branchId") || "";
    const courseId = url.searchParams.get("courseId") || "";
    if (!branchId || !courseId) return jsonPlain(c, { success: true, batches: [] });
    const result = await listAdmissionEligibleBatches(c, staff, branchId, courseId);
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, batches: result.batches });
  });

  app.get("/api/staff/batches/:batchId/eligible-enrolments", async (c) => {
    const staff = await requireStaffRoles(c, BATCH_READ_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const result = await listEligibleEnrolments(c, staff, c.req.param("batchId"), url.searchParams.get("q") || "");
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, enrolments: result.enrolments });
  });

  app.get("/api/staff/batches/:batchId", async (c) => {
    const staff = await requireStaffRoles(c, BATCH_READ_ROLES);
    if (!staff) return forbidden(c);
    const result = await getBatchDetail(c, staff, c.req.param("batchId"));
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, batch: result.batch, roster: result.roster });
  });

  app.patch("/api/staff/batches/:batchId", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, BATCH_MANAGE_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, batchPatchSchema);
    if (isResponse(body)) return body;
    const result = await updateBatch(c, staff, c.req.param("batchId"), body);
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, batchId: result.batchId });
  });

  app.post("/api/staff/batches/:batchId/assignments", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, BATCH_MANAGE_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, batchAssignmentSchema);
    if (isResponse(body)) return body;
    const result = await assignEnrolmentToBatch(c, staff, c.req.param("batchId"), body.enrolmentId);
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, membershipId: result.membershipId });
  });

  app.post("/api/staff/batches/:batchId/memberships/:membershipId/transfer", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, BATCH_MANAGE_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, batchTransferSchema);
    if (isResponse(body)) return body;
    const result = await transferBatchMembership(c, staff, c.req.param("batchId"), c.req.param("membershipId"), body.targetBatchId);
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, membershipId: result.membershipId });
  });

  app.post("/api/staff/batches/:batchId/memberships/:membershipId/remove", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, BATCH_MANAGE_ROLES);
    if (!staff) return forbidden(c);
    const result = await removeBatchMembershipFromBatch(c, staff, c.req.param("batchId"), c.req.param("membershipId"));
    if (!result.ok) return batchError(c, result);
    return jsonPlain(c, { success: true, membershipId: result.membershipId });
  });
}

function forbidden(c: Parameters<typeof readJsonBody>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
}

function batchError(c: Parameters<typeof readJsonBody>[0], result: { status: number; code: string; message: string; fieldErrors?: Record<string, string[]> }) {
  return jsonError(c, { status: result.status as ContentfulStatusCode, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
}
