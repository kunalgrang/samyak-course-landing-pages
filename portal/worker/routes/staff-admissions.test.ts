import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffAdmissionRoutes } from "./staff-admissions";
import * as admissionService from "../lib/admission-service";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  listDiscountApprovals: vi.fn(),
  decideDiscountApproval: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/admission-service", () => ({
  confirmAdmission: vi.fn(),
  decideDiscountApproval: mocks.decideDiscountApproval,
  fieldErrorsFromIssues: vi.fn(() => ({ payload: ["Expected object"] })),
  getAdmissionConfiguration: vi.fn(),
  getAdmissionDraft: vi.fn(),
  getAdmissionReceiptSummary: vi.fn(),
  listDiscountApprovals: mocks.listDiscountApprovals,
  recordAdmissionReceipt: vi.fn(),
  recordAdmissionReceiptSchema: { safeParse: vi.fn(() => ({ success: true, data: { admissionDraftId: "draft_1", amountPaise: 50000, paymentMode: "cash", idempotencyKey: "receipt_test" } })) },
  requestDiscountApproval: vi.fn(),
  saveAdmissionDraft: vi.fn(),
  saveAdmissionDraftSchema: { safeParse: vi.fn(() => ({ success: true, data: { payload: {}, currentStep: "review" } })) },
}));

function routeApp() {
  const app = new Hono();
  registerStaffAdmissionRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[]) {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: "person_test" },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

async function postDecision(app: Hono, approvalId = "approval_1") {
  return app.request(`/api/staff/discount-approvals/${approvalId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approved" }),
  });
}

describe("staff admission discount approval routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDiscountApprovals.mockResolvedValue([{ id: "approval_1", status: "pending" }]);
    mocks.decideDiscountApproval.mockResolvedValue({ ok: true, approvalId: "approval_1", status: "approved" });
  });

  it("allows owners to list and decide discount approvals", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const list = await app.request("/api/staff/discount-approvals");
    const decision = await postDecision(app);

    expect(list.status).toBe(200);
    expect(decision.status).toBe(200);
    expect(mocks.listDiscountApprovals).toHaveBeenCalledTimes(1);
    expect(mocks.decideDiscountApproval).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["owner"] }), "approval_1", "approved");
  });

  it.each(["admin", "system_admin", "admission_admin", "counsellor", "student", "alumni"])("returns 403 to %s approval access", async (role) => {
    const app = routeApp();
    authenticateAs([role]);

    expect((await app.request("/api/staff/discount-approvals")).status).toBe(403);
    expect((await postDecision(app)).status).toBe(403);
    expect(mocks.listDiscountApprovals).not.toHaveBeenCalled();
    expect(mocks.decideDiscountApproval).not.toHaveBeenCalled();
  });
});

describe("staff admission draft routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured field errors when route-level draft parsing fails", async () => {
    const app = routeApp();
    authenticateAs(["admission_admin"]);
    vi.mocked(admissionService.saveAdmissionDraftSchema.safeParse).mockReturnValueOnce({
      success: false,
      error: { issues: [{ path: ["payload"], message: "Expected object" }] },
    } as never);

    const response = await app.request("/api/staff/enquiries/enq_first/admission-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: null, currentStep: "identity" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "invalid_draft",
        message: "Please correct the highlighted fields.",
        fieldErrors: { payload: ["Expected object"] },
      },
    });
  });

  it("passes service field errors through on draft save failures", async () => {
    const app = routeApp();
    authenticateAs(["admission_admin"]);
    vi.mocked(admissionService.saveAdmissionDraft).mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: "invalid_mobile",
      message: "Please correct the highlighted fields.",
      fieldErrors: { "contact.primaryMobile": ["Enter a valid Indian primary mobile number."] },
    } as never);

    const response = await app.request("/api/staff/enquiries/enq_first/admission-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: {}, currentStep: "identity" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "invalid_mobile",
        fieldErrors: { "contact.primaryMobile": ["Enter a valid Indian primary mobile number."] },
      },
    });
  });
});
