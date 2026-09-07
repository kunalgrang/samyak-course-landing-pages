import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import {
  TRAINER_MANAGEMENT_ROLES,
  createManagedTrainer,
  findTrainerPersonCandidates,
  getManagedTrainer,
  listManagedTrainers,
  setManagedTrainerStatus,
  updateManagedTrainer,
} from "../lib/trainer-management";
import { requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const createTrainerSchema = z.object({
  fullName: z.string().min(1).max(160),
  mobile: z.string().min(1).max(40),
  email: z.string().max(254).optional().or(z.literal("")),
  branchId: z.string().min(1).max(140),
  status: z.enum(["active", "inactive"]).optional(),
  existingPersonId: z.string().max(140).optional().or(z.literal("")),
  createSeparatePerson: z.boolean().optional(),
});

const updateTrainerSchema = z.object({
  fullName: z.string().min(1).max(160),
  email: z.string().max(254).optional().or(z.literal("")),
});

const statusSchema = z.object({ status: z.enum(["active", "inactive"]) });

export function registerStaffTrainerRoutes(app: PortalHono) {
  app.get("/api/staff/trainers", async (c) => {
    const staff = await requireStaffRoles(c, TRAINER_MANAGEMENT_ROLES);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const result = await listManagedTrainers(c, staff, {
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "all",
      branchId: url.searchParams.get("branchId") || undefined,
      limit: Number(url.searchParams.get("limit") || 20),
      offset: Number(url.searchParams.get("offset") || 0),
    });
    if (!result.ok) return trainerError(c, result);
    return jsonPlain(c, { success: true, trainers: result.trainers, pagination: result.pagination });
  });

  app.get("/api/staff/trainers/candidates", async (c) => {
    const staff = await requireStaffRoles(c, TRAINER_MANAGEMENT_ROLES);
    if (!staff) return forbidden(c);
    const result = await findTrainerPersonCandidates(c, staff, new URL(c.req.url).searchParams.get("mobile") || "");
    if (!result.ok) return trainerError(c, result);
    return jsonPlain(c, { success: true, candidates: result.candidates });
  });

  app.post("/api/staff/trainers", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, TRAINER_MANAGEMENT_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, createTrainerSchema);
    if (isResponse(body)) return body;
    const result = await createManagedTrainer(c, staff, body);
    if (!result.ok) return trainerError(c, result);
    return jsonPlain(c, { success: true, personId: result.personId, createdPerson: result.createdPerson, reusedPerson: result.reusedPerson, alreadyTrainer: result.alreadyTrainer }, { status: 201 });
  });

  app.get("/api/staff/trainers/:personId", async (c) => {
    const staff = await requireStaffRoles(c, TRAINER_MANAGEMENT_ROLES);
    if (!staff) return forbidden(c);
    const result = await getManagedTrainer(c, staff, c.req.param("personId"));
    if (!result.ok) return trainerError(c, result);
    return jsonPlain(c, { success: true, trainer: result.trainer, batches: result.batches });
  });

  app.patch("/api/staff/trainers/:personId", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, TRAINER_MANAGEMENT_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, updateTrainerSchema);
    if (isResponse(body)) return body;
    const result = await updateManagedTrainer(c, staff, c.req.param("personId"), body);
    if (!result.ok) return trainerError(c, result);
    return jsonPlain(c, { success: true, personId: result.personId });
  });

  app.post("/api/staff/trainers/:personId/status", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, TRAINER_MANAGEMENT_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, statusSchema);
    if (isResponse(body)) return body;
    const result = await setManagedTrainerStatus(c, staff, c.req.param("personId"), body.status);
    if (!result.ok) return trainerError(c, result);
    return jsonPlain(c, { success: true, personId: result.personId, idempotent: result.idempotent });
  });
}

function forbidden(c: Parameters<typeof readJsonBody>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Trainer management access is required." });
}

function trainerError(c: Parameters<typeof readJsonBody>[0], result: { status: number; code: string; message: string; fieldErrors?: Record<string, string[]>; candidates?: unknown[]; batches?: unknown[] }) {
  return jsonError(c, {
    status: result.status as ContentfulStatusCode,
    code: result.code,
    message: result.message,
    fieldErrors: result.fieldErrors,
    details: {
      ...(result.candidates ? { candidates: result.candidates } : {}),
      ...(result.batches ? { batches: result.batches } : {}),
    },
  });
}
