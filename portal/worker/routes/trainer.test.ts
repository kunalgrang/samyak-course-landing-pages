import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTrainerRoutes } from "./trainer";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedTrainer: vi.fn(),
  getSessionFromRequest: vi.fn(),
  listTrainerBatches: vi.fn(),
  getTrainerBatchDetail: vi.fn(),
  listTrainerSessions: vi.fn(),
  openOrCreateTrainerSession: vi.fn(),
  getTrainerSessionDetail: vi.fn(),
  saveTrainerSession: vi.fn(),
  getSessionValidationResult: vi.fn(),
  trainerSessionView: vi.fn(),
  revokeSession: vi.fn(),
  recordAuthEvent: vi.fn(),
}));

vi.mock("../lib/auth-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth-store")>();
  return {
    ...actual,
    requireAuthenticatedTrainer: mocks.requireAuthenticatedTrainer,
    getSessionFromRequest: mocks.getSessionFromRequest,
    getSessionValidationResult: mocks.getSessionValidationResult,
    trainerSessionView: mocks.trainerSessionView,
    revokeSession: mocks.revokeSession,
    recordAuthEvent: mocks.recordAuthEvent,
  };
});

vi.mock("../lib/trainer-attendance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/trainer-attendance")>();
  return {
    ...actual,
    listTrainerBatches: mocks.listTrainerBatches,
    getTrainerBatchDetail: mocks.getTrainerBatchDetail,
    listTrainerSessions: mocks.listTrainerSessions,
    openOrCreateTrainerSession: mocks.openOrCreateTrainerSession,
    getTrainerSessionDetail: mocks.getTrainerSessionDetail,
    saveTrainerSession: mocks.saveTrainerSession,
  };
});

function routeApp() {
  const app = new Hono();
  registerTrainerRoutes(app as never);
  return app;
}

function trainerAuth() {
  mocks.requireAuthenticatedTrainer.mockResolvedValue({
    session: { record: { id: "sess_1", login_account_id: "acct_trainer", active_person_id: "person_trainer", active_education_partner_id: null }, tokenHash: "hash" },
    activeTrainer: { personId: "person_trainer", publicName: "Trainer", branchId: "branch_sion", branchName: "Sion", roles: ["trainer"] },
  });
}

describe("trainer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTrainerBatches.mockResolvedValue([]);
    mocks.listTrainerSessions.mockResolvedValue([]);
    mocks.getTrainerBatchDetail.mockResolvedValue({ batch: { id: "batch_1" }, roster: [], sessions: [] });
    mocks.openOrCreateTrainerSession.mockResolvedValue({ ok: true, session: { session: { id: "session_1" }, batch: { id: "batch_1" }, roster: [] } });
    mocks.getTrainerSessionDetail.mockResolvedValue({ session: { id: "session_1" }, batch: { id: "batch_1" }, roster: [] });
    mocks.saveTrainerSession.mockResolvedValue({ ok: true, session: { session: { id: "session_1" }, batch: { id: "batch_1" }, roster: [] } });
  });

  it("requires an active trainer subject for trainer APIs", async () => {
    const app = routeApp();
    mocks.requireAuthenticatedTrainer.mockResolvedValue(null);

    expect((await app.request("/api/trainer/batches")).status).toBe(401);
    expect((await app.request("/api/trainer/batches/batch_1")).status).toBe(401);
    expect((await app.request("/api/trainer/sessions/session_1")).status).toBe(401);
    expect(mocks.listTrainerBatches).not.toHaveBeenCalled();
  });

  it("returns trainer-scoped class history", async () => {
    const app = routeApp();
    trainerAuth();
    mocks.listTrainerSessions.mockResolvedValue([{ id: "session_1", presentCount: 2, absentCount: 1, teachingNoteExcerpt: "Power BI" }]);

    const response = await app.request("/api/trainer/sessions");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, sessions: [expect.objectContaining({ id: "session_1" })] });
    expect(mocks.listTrainerSessions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      activeTrainer: expect.objectContaining({ personId: "person_trainer" }),
    }));
  });

  it("passes only trainer context into my-batches and detail services", async () => {
    const app = routeApp();
    trainerAuth();

    expect((await app.request("/api/trainer/batches?status=active")).status).toBe(200);
    expect(mocks.listTrainerBatches).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      loginAccountId: "acct_trainer",
      activeTrainer: expect.objectContaining({ personId: "person_trainer" }),
    }), "active");

    expect((await app.request("/api/trainer/batches/batch_1")).status).toBe(200);
    expect(mocks.getTrainerBatchDetail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      activeTrainer: expect.objectContaining({ personId: "person_trainer" }),
    }), "batch_1");
  });

  it("requires same-origin for session creation and save mutations", async () => {
    const app = routeApp();
    trainerAuth();

    const crossOrigin = await app.request("http://portal.test/api/trainer/batches/batch_1/sessions/today", {
      method: "POST",
      headers: { Origin: "http://evil.test", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);
    expect(mocks.openOrCreateTrainerSession).not.toHaveBeenCalled();

    const sameOrigin = await app.request("http://portal.test/api/trainer/sessions/session_1/save", {
      method: "POST",
      headers: { Origin: "http://portal.test", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, teachingNote: "Excel pivot tables", attendance: [] }),
    });
    expect(sameOrigin.status).toBe(200);
    expect(mocks.saveTrainerSession).toHaveBeenCalled();
  });

  it("keeps partner sessions out of trainer session checks", async () => {
    const app = routeApp();
    mocks.getSessionValidationResult.mockResolvedValue({
      session: { record: { login_account_id: "acct_partner", active_person_id: null, active_education_partner_id: "partner_1", active_subject_type: "partner" } },
      resultCode: "SESSION_VALID",
      shouldClearCookie: false,
    });

    const response = await app.request("/api/trainer/session");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authenticated: false, code: "PARTNER_SESSION_ACTIVE" });
    expect(mocks.trainerSessionView).not.toHaveBeenCalled();
  });

  it("keeps person sessions out of trainer session checks", async () => {
    const app = routeApp();
    mocks.getSessionValidationResult.mockResolvedValue({
      session: { record: { login_account_id: "acct_student", active_person_id: "person_student", active_education_partner_id: null, active_subject_type: "person" } },
      resultCode: "SESSION_VALID",
      shouldClearCookie: false,
    });

    const response = await app.request("/api/trainer/session");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authenticated: false, code: "PERSON_SESSION_ACTIVE" });
    expect(mocks.trainerSessionView).not.toHaveBeenCalled();
  });
});
