import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffPaymentRoutes } from "./staff-payments";
import * as paymentsLedger from "../lib/payments-ledger";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  getPaymentLedger: vi.fn(),
  recordEnrolmentReceipt: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/admission-service", () => ({
  fieldErrorsFromIssues: vi.fn(() => ({ amountPaise: ["Required"] })),
}));

vi.mock("../lib/payments-ledger", () => ({
  getPaymentLedger: mocks.getPaymentLedger,
  recordEnrolmentReceipt: mocks.recordEnrolmentReceipt,
  recordEnrolmentReceiptSchema: { safeParse: vi.fn(() => ({ success: true, data: { amountPaise: 1000, paymentMode: "cash", idempotencyKey: "pay_test" } })) },
}));

function routeApp() {
  const app = new Hono();
  registerStaffPaymentRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[]) {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: "person_test" },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff payment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaymentLedger.mockResolvedValue({ ok: true, ledger: { enrolment: {}, financialSummary: {}, receipts: [] } });
    mocks.recordEnrolmentReceipt.mockResolvedValue({ ok: true, receipt: { receiptNumber: "RCP-SION-2026-000002" }, financialSummary: {} });
  });

  it("denies unauthenticated and telecaller access before service execution", async () => {
    const app = routeApp();
    mocks.getSessionFromRequest.mockResolvedValue(null);
    expect((await app.request("/api/staff/enrolments/enrol_a/payments")).status).toBe(403);
    expect((await app.request("/api/staff/enrolments/enrol_a/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);

    authenticateAs(["telecaller"]);
    expect((await app.request("/api/staff/enrolments/enrol_a/payments")).status).toBe(403);
    expect((await app.request("/api/staff/enrolments/enrol_a/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
    expect(mocks.getPaymentLedger).not.toHaveBeenCalled();
    expect(mocks.recordEnrolmentReceipt).not.toHaveBeenCalled();
  });

  it("allows counsellor route access and passes branch/RBAC decisions to the service", async () => {
    const app = routeApp();
    authenticateAs(["counsellor"]);
    expect((await app.request("/api/staff/enrolments/enrol_a/payments")).status).toBe(200);
    expect((await app.request("/api/staff/enrolments/enrol_a/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(201);
    expect(mocks.getPaymentLedger).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["counsellor"] }), "enrol_a");
    expect(mocks.recordEnrolmentReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["counsellor"] }), "enrol_a", expect.objectContaining({ idempotencyKey: "pay_test" }));
  });

  it("returns structured route validation errors and service failures", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);
    vi.mocked(paymentsLedger.recordEnrolmentReceiptSchema.safeParse).mockReturnValueOnce({ success: false, error: { issues: [{ path: ["amountPaise"], message: "Required" }] } } as never);
    const invalid = await app.request("/api/staff/enrolments/enrol_a/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "invalid_receipt", fieldErrors: { amountPaise: ["Required"] } } });

    mocks.getPaymentLedger.mockResolvedValueOnce({ ok: false, status: 403, code: "forbidden", message: "No branch access." });
    const denied = await app.request("/api/staff/enrolments/enrol_a/payments");
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "forbidden", message: "No branch access." } });
  });
});
