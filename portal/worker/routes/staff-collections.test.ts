import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffCollectionRoutes } from "./staff-collections";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  listCollections: vi.fn(),
  getCollectionDetail: vi.fn(),
  createCollectionFollowup: vi.fn(),
  updatePaymentSchedule: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/admission-service", () => ({
  fieldErrorsFromIssues: vi.fn(() => ({ followupType: ["Required"] })),
}));

vi.mock("../lib/collections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/collections")>();
  return {
    ...actual,
    listCollections: mocks.listCollections,
    getCollectionDetail: mocks.getCollectionDetail,
    createCollectionFollowup: mocks.createCollectionFollowup,
    updatePaymentSchedule: mocks.updatePaymentSchedule,
  };
});

function routeApp() {
  const app = new Hono();
  registerStaffCollectionRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[]) {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: "person_test" },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff collection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCollections.mockResolvedValue({ success: true, items: [], overview: {}, sections: {}, pagination: {} });
    mocks.getCollectionDetail.mockResolvedValue({ ok: true, success: true, item: {}, installments: [], receipts: [], followups: [], timeline: [], receiptCorrection: {} });
    mocks.createCollectionFollowup.mockResolvedValue({ ok: true, success: true, followup: { id: "fu_1" } });
    mocks.updatePaymentSchedule.mockResolvedValue({ ok: true, success: true, detail: { success: true, item: {}, installments: [], receipts: [], followups: [], timeline: [], receiptCorrection: {}, paymentSchedule: {} } });
  });

  it("denies unauthenticated and non-admission roles before service execution", async () => {
    const app = routeApp();
    mocks.getSessionFromRequest.mockResolvedValue(null);
    expect((await app.request("/api/staff/collections")).status).toBe(403);
    expect((await app.request("/api/staff/collections/enrol_a")).status).toBe(403);

    authenticateAs(["trainer"]);
    expect((await app.request("/api/staff/collections")).status).toBe(403);
    expect((await app.request("http://portal.test/api/staff/collections/enrol_a/follow-ups", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://portal.test" }, body: "{}" })).status).toBe(403);
    expect(mocks.listCollections).not.toHaveBeenCalled();
    expect(mocks.createCollectionFollowup).not.toHaveBeenCalled();
  });

  it("requires same-origin and manager-level staff for schedule edits before service execution", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);
    const crossOrigin = await app.request("http://portal.test/api/staff/collections/enrol_a/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
      body: JSON.stringify({ expectedVersion: "version_1234567890abcdef", reason: "Correct schedule", installments: [{ amountPaise: 1000, dueDate: "2026-09-10" }] }),
    });
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({ error: { code: "invalid_origin" } });

    authenticateAs(["counsellor"]);
    const counsellor = await app.request("http://portal.test/api/staff/collections/enrol_a/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({ expectedVersion: "version_1234567890abcdef", reason: "Correct schedule", installments: [{ amountPaise: 1000, dueDate: "2026-09-10" }] }),
    });

    expect(counsellor.status).toBe(403);
    expect(mocks.updatePaymentSchedule).not.toHaveBeenCalled();
  });

  it("allows owner schedule edits and returns refreshed collection detail", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);
    const response = await app.request("http://portal.test/api/staff/collections/enrol_a/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({ expectedVersion: "version_1234567890abcdef", reason: "Correct schedule", installments: [{ amountPaise: 1000, dueDate: "2026-09-10" }] }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updatePaymentSchedule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["owner"] }), "enrol_a", expect.objectContaining({ reason: "Correct schedule" }));
  });

  it("allows admission staff and delegates branch and enrolment checks to the service", async () => {
    const app = routeApp();
    authenticateAs(["counsellor"]);
    expect((await app.request("/api/staff/collections?status=all")).status).toBe(200);
    expect((await app.request("/api/staff/collections/enrol_a")).status).toBe(200);
    expect((await app.request("http://portal.test/api/staff/collections/enrol_a/follow-ups", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://portal.test" }, body: JSON.stringify({ followupType: "call", outcome: "contacted" }) })).status).toBe(201);
    expect(mocks.listCollections).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["counsellor"] }), expect.objectContaining({ status: "all" }));
    expect(mocks.getCollectionDetail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["counsellor"] }), "enrol_a");
    expect(mocks.createCollectionFollowup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["counsellor"] }), "enrol_a", expect.objectContaining({ outcome: "contacted" }));
  });

  it("requires same-origin for follow-up creation before service execution", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const response = await app.request("http://portal.test/api/staff/collections/enrol_a/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
      body: JSON.stringify({ followupType: "call", outcome: "contacted" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_origin" } });
    expect(mocks.createCollectionFollowup).not.toHaveBeenCalled();
  });

  it("returns structured validation errors and service failures", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);
    const invalid = await app.request("http://portal.test/api/staff/collections/enrol_a/follow-ups", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://portal.test" }, body: JSON.stringify({ followupType: "invalid", outcome: "contacted" }) });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "invalid_collection_followup", fieldErrors: { followupType: ["Required"] } } });

    mocks.getCollectionDetail.mockResolvedValueOnce({ ok: false, status: 404, code: "collection_not_found", message: "Missing." });
    const missing = await app.request("/api/staff/collections/missing");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "collection_not_found" } });
  });
});
