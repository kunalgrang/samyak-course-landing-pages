import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import {
  runTemporaryImportedContactNormalizationRepair,
  IMPORTED_CONTACT_REPAIR_CONFIRMATION,
  isImportedContactRepairSafeForApply,
} from "../lib/temporary-contact-normalization-repair";
import { requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const OWNER_ROLES = ["owner"] as const;
const MAX_BODY_BYTES = 24 * 1024;
const recoveryEntrySchema = z.object({
  legacyStudentRef: z.string().regex(/^LEG-STU-[A-F0-9]{12}$/),
  mobile: z.string().min(10).max(32),
});
const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dry_run"), entries: z.array(recoveryEntrySchema).length(56) }),
  z.object({
    mode: z.literal("apply"),
    confirmation: z.literal(IMPORTED_CONTACT_REPAIR_CONFIRMATION),
    entries: z.array(recoveryEntrySchema).length(56),
  }),
]);

export function registerTemporaryMaintenanceRoutes(app: PortalHono) {
  app.post("/api/staff/maintenance/imported-contact-normalization", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;

    const bodyLength = Number(c.req.header("content-length") || 0);
    if (bodyLength > MAX_BODY_BYTES) {
      return jsonError(c, { status: 413, code: "request_too_large", message: "Request body is too large." });
    }

    const staff = await requireStaffRoles(c, OWNER_ROLES);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Owner access is required." });

    const body = await readJsonBody(c, requestSchema);
    if (isResponse(body)) return body;

    const result = await runTemporaryImportedContactNormalizationRepair(c, body.mode, body.entries, body.mode === "apply" ? staff : undefined);
    if (body.mode === "apply" && !isImportedContactRepairSafeForApply(result)) {
      return jsonError(c, { status: 409, code: "repair_not_safe", message: "Imported contact repair safety checks failed." });
    }
    return jsonPlain(c, { success: true, ...result });
  });
}
