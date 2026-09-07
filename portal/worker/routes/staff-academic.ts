import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import {
  STAFF_ACADEMIC_ROLES,
  getStaffAcademicBatch,
  getStaffAcademicMaterialContent,
  getStaffAcademicOverview,
  getStaffAcademicSession,
  getStaffStudentAttendance,
  getStaffTrainerActivity,
  listStaffAcademicBatches,
} from "../lib/staff-academic";
import { readJsonBody } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function registerStaffAcademicRoutes(app: PortalHono) {
  app.get("/api/staff/academic/overview", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    return jsonPlain(c, await getStaffAcademicOverview(c, staff));
  });

  app.get("/api/staff/academic/batches", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    return jsonPlain(c, await listStaffAcademicBatches(c, staff, {
      q: url.searchParams.get("q") || "",
      limit: Number(url.searchParams.get("limit") || 50),
      offset: Number(url.searchParams.get("offset") || 0),
    }));
  });

  app.get("/api/staff/academic/batches/:batchId", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    const result = await getStaffAcademicBatch(c, staff, c.req.param("batchId"), pagination(c.req.url));
    if (!result.ok) return academicError(c, result);
    return jsonPlain(c, result);
  });

  app.get("/api/staff/academic/sessions/:sessionId", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    const result = await getStaffAcademicSession(c, staff, c.req.param("sessionId"));
    if (!result.ok) return academicError(c, result);
    return jsonPlain(c, result);
  });

  app.get("/api/staff/academic/trainers/:personId", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const result = await getStaffTrainerActivity(c, staff, c.req.param("personId"), {
      range: url.searchParams.get("range") || "7d",
      ...pagination(c.req.url),
    });
    if (!result.ok) return academicError(c, result);
    return jsonPlain(c, result);
  });

  app.get("/api/staff/academic/students/:studentId", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    const result = await getStaffStudentAttendance(c, staff, c.req.param("studentId"), pagination(c.req.url));
    if (!result.ok) return academicError(c, result);
    return jsonPlain(c, result);
  });

  app.get("/api/staff/academic/session-materials/:materialId/content", async (c) => {
    const staff = await requireStaffRoles(c, STAFF_ACADEMIC_ROLES);
    if (!staff) return forbidden(c);
    const result = await getStaffAcademicMaterialContent(c, staff, c.req.param("materialId"));
    if (!result.ok) return academicError(c, result);
    return new Response(result.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.filename.replace(/[^a-zA-Z0-9_. -]/g, "-").replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(result.sizeBytes ? { "Content-Length": String(result.sizeBytes) } : {}),
      },
    });
  });
}

function forbidden(c: Parameters<typeof readJsonBody>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Academic access is required." });
}

function academicError(c: Parameters<typeof readJsonBody>[0], result: { status: number; code: string; message: string }) {
  return jsonError(c, { status: result.status as ContentfulStatusCode, code: result.code, message: result.message });
}

function pagination(urlValue: string) {
  const url = new URL(urlValue);
  return {
    limit: Number(url.searchParams.get("limit") || 20),
    offset: Number(url.searchParams.get("offset") || 0),
  };
}
