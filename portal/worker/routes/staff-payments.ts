import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { fieldErrorsFromIssues } from "../lib/admission-service";
import { getPaymentLedger, recordEnrolmentReceipt, recordEnrolmentReceiptSchema } from "../lib/payments-ledger";
import { ADMISSION_STAFF_ROLES, requireStaffRoles } from "../lib/staff-auth";
import { jsonError, jsonPlain } from "../lib/json-response";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function registerStaffPaymentRoutes(app: PortalHono) {
  app.get("/api/staff/enrolments/:enrolmentId/payments", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const result = await getPaymentLedger(c, staff, c.req.param("enrolmentId"));
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, result.ledger);
  });

  app.post("/api/staff/enrolments/:enrolmentId/receipts", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = recordEnrolmentReceiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_receipt", message: "Please correct receipt details.", fieldErrors: fieldErrorsFromIssues(parsed.error.issues) });
    const result = await recordEnrolmentReceipt(c, staff, c.req.param("enrolmentId"), parsed.data);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, receipt: result.receipt, financialSummary: result.financialSummary }, { status: 201 });
  });
}

function forbidden(c: Parameters<typeof jsonError>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
}
