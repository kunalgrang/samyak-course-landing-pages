import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffTrainerRoutes } from "./staff-trainers";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  listManagedTrainers: vi.fn(),
  createManagedTrainer: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/trainer-management", () => ({
  TRAINER_MANAGEMENT_ROLES: ["owner", "system_admin", "admin"],
  listManagedTrainers: mocks.listManagedTrainers,
  createManagedTrainer: mocks.createManagedTrainer,
  findTrainerPersonCandidates: vi.fn().mockResolvedValue({ ok: true, candidates: [] }),
  getManagedTrainer: vi.fn().mockResolvedValue({ ok: true, trainer: {}, batches: [] }),
  updateManagedTrainer: vi.fn().mockResolvedValue({ ok: true, personId: "person_1" }),
  setManagedTrainerStatus: vi.fn().mockResolvedValue({ ok: true, personId: "person_1", idempotent: false }),
}));

function routeApp() {
  const app = new Hono();
  registerStaffTrainerRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], partnerId: string | null = null, subjectType: string = partnerId ? "partner" : "person") {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: partnerId ? null : "person_test", active_education_partner_id: partnerId, active_subject_type: subjectType },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff trainer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listManagedTrainers.mockResolvedValue({ ok: true, trainers: [], pagination: { limit: 20, offset: 0, hasMore: false } });
    mocks.createManagedTrainer.mockResolvedValue({ ok: true, personId: "person_1", createdPerson: true, reusedPerson: false, alreadyTrainer: false });
  });

  it("allows owner/admin roles to list and create trainers", async () => {
    const app = routeApp();
    authenticateAs(["admin"]);

    expect((await app.request("/api/staff/trainers")).status).toBe(200);
    const created = await app.request("http://portal.test/api/staff/trainers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({ fullName: "Trainer One", mobile: "9876543210", branchId: "branch_sion" }),
    });

    expect(created.status).toBe(201);
    expect(mocks.createManagedTrainer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["admin"] }), expect.objectContaining({ fullName: "Trainer One" }));
  });

  it("rejects counsellor, student, partner, and trainer-context sessions", async () => {
    const app = routeApp();

    authenticateAs(["counsellor"]);
    expect((await app.request("/api/staff/trainers")).status).toBe(403);

    authenticateAs(["student"]);
    expect((await app.request("/api/staff/trainers")).status).toBe(403);

    authenticateAs(["owner"], "partner_1");
    expect((await app.request("/api/staff/trainers")).status).toBe(403);

    authenticateAs(["owner"], null, "trainer");
    expect((await app.request("/api/staff/trainers")).status).toBe(403);
    expect(mocks.listManagedTrainers).not.toHaveBeenCalled();
  });
});
