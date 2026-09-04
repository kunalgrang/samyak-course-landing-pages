import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffBatchRoutes } from "./staff-batches";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  listBatches: vi.fn(),
  createBatch: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/batch-management", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/batch-management")>();
  return {
    ...actual,
    listBatches: mocks.listBatches,
    createBatch: mocks.createBatch,
  };
});

function routeApp() {
  const app = new Hono();
  registerStaffBatchRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], partnerId: string | null = null, subjectType: string = partnerId ? "partner" : "person") {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: partnerId ? null : "person_test", active_education_partner_id: partnerId, active_subject_type: subjectType },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff batch routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBatches.mockResolvedValue({ ok: true, batches: [] });
    mocks.createBatch.mockResolvedValue({ ok: true, batchId: "batch_1" });
  });

  it("allows admission staff roles to list batches", async () => {
    const app = routeApp();
    authenticateAs(["counsellor"]);

    const response = await app.request("/api/staff/batches?status=active");

    expect(response.status).toBe(200);
    expect(mocks.listBatches).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["counsellor"] }), expect.objectContaining({ status: "active" }));
  });

  it("rejects student and partner sessions before service access", async () => {
    const app = routeApp();
    authenticateAs(["student"]);
    expect((await app.request("/api/staff/batches")).status).toBe(403);

    authenticateAs(["owner"], "partner_1");
    expect((await app.request("/api/staff/batches")).status).toBe(403);
    expect(mocks.listBatches).not.toHaveBeenCalled();
  });

  it("rejects a trainer-context cookie even if the account has staff roles", async () => {
    const app = routeApp();
    authenticateAs(["owner"], null, "trainer");

    const response = await app.request("/api/staff/batches");

    expect(response.status).toBe(403);
    expect(mocks.listBatches).not.toHaveBeenCalled();
  });

  it("does not grant batch management to trainer role alone", async () => {
    const app = routeApp();
    authenticateAs(["trainer"]);

    const response = await app.request("http://portal.test/api/staff/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({
        name: "Trainer Owned",
        branchId: "branch_sion",
        courseId: "course_fsd",
        daysOfWeek: ["mon"],
        startTime: "08:00",
        endTime: "10:00",
        status: "active",
      }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("allows managers to create batches from same-origin requests", async () => {
    const app = routeApp();
    authenticateAs(["admission_admin"]);

    const response = await app.request("http://portal.test/api/staff/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({
        name: "Morning",
        branchId: "branch_sion",
        courseId: "course_fsd",
        trainerPersonId: null,
        daysOfWeek: ["mon"],
        startTime: "08:00",
        endTime: "10:00",
        capacity: null,
        status: "active",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.createBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["admission_admin"] }), expect.objectContaining({ name: "Morning" }));
  });
});
