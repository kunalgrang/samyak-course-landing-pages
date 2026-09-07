import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffAcademicRoutes } from "./staff-academic";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  getStaffAcademicOverview: vi.fn(),
  listStaffAcademicBatches: vi.fn(),
  getStaffAcademicBatch: vi.fn(),
  getStaffAcademicSession: vi.fn(),
  getStaffTrainerActivity: vi.fn(),
  getStaffStudentAttendance: vi.fn(),
  getStaffAcademicMaterialContent: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/staff-academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/staff-academic")>();
  return {
    ...actual,
    getStaffAcademicOverview: mocks.getStaffAcademicOverview,
    listStaffAcademicBatches: mocks.listStaffAcademicBatches,
    getStaffAcademicBatch: mocks.getStaffAcademicBatch,
    getStaffAcademicSession: mocks.getStaffAcademicSession,
    getStaffTrainerActivity: mocks.getStaffTrainerActivity,
    getStaffStudentAttendance: mocks.getStaffStudentAttendance,
    getStaffAcademicMaterialContent: mocks.getStaffAcademicMaterialContent,
  };
});

function routeApp() {
  const app = new Hono();
  registerStaffAcademicRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], subjectType = "person") {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: {
      login_account_id: "acct_test",
      active_person_id: subjectType === "person" ? "person_staff" : "person_trainer",
      active_education_partner_id: subjectType === "partner" ? "partner_1" : null,
      active_subject_type: subjectType,
    },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff academic routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStaffAcademicOverview.mockResolvedValue({
      success: true,
      today: "2026-09-05",
      week: { startsOn: "2026-08-31", endsOn: "2026-09-06" },
      summary: { classesToday: 0, studentsPresentToday: 0, studentsAbsentToday: 0, activeBatches: 0, batchesWithoutRecentClass: 0 },
      todayClasses: [],
      needsAttention: [],
      activeBatches: [],
    });
    mocks.listStaffAcademicBatches.mockResolvedValue({ success: true, batches: [], pagination: { limit: 50, offset: 0, hasMore: false } });
    mocks.getStaffAcademicBatch.mockResolvedValue({ ok: true, success: true, batch: {}, summary: {}, sessions: [], pagination: { limit: 20, offset: 0, hasMore: false } });
    mocks.getStaffAcademicSession.mockResolvedValue({ ok: true, success: true, session: {}, roster: [], materials: [] });
    mocks.getStaffTrainerActivity.mockResolvedValue({ ok: true, success: true, trainer: {}, range: "7d", summary: {}, sessions: [], pagination: { limit: 20, offset: 0, hasMore: false } });
    mocks.getStaffStudentAttendance.mockResolvedValue({ ok: true, success: true, student: {}, enrolments: [], sessions: [], pagination: { limit: 20, offset: 0, hasMore: false } });
    mocks.getStaffAcademicMaterialContent.mockResolvedValue({
      ok: true,
      body: new Response("%PDF-1.7\n").body,
      filename: "notes.pdf",
      sizeBytes: 9,
    });
  });

  it("allows owner, system admin and branch admin academic reads", async () => {
    const app = routeApp();

    for (const roles of [["owner"], ["system_admin"], ["admin"]]) {
      authenticateAs(roles);
      const response = await app.request("/api/staff/academic/overview");
      expect(response.status).toBe(200);
    }
  });

  it("passes staff context to the service", async () => {
    const app = routeApp();
    authenticateAs(["admin"]);

    const response = await app.request("/api/staff/academic/overview");

    expect(response.status).toBe(200);
    expect(mocks.getStaffAcademicOverview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ loginAccountId: "acct_test", roles: ["admin"] }));
  });

  it("denies counsellor, admission admin, trainer role, student role, partner subject, and unauthenticated access", async () => {
    const app = routeApp();

    authenticateAs(["counsellor"]);
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);

    authenticateAs(["admission_admin"]);
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);

    authenticateAs(["trainer"]);
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);

    authenticateAs(["owner"], "trainer");
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);

    authenticateAs(["student"]);
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);

    authenticateAs(["owner"], "partner");
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);

    mocks.getSessionFromRequest.mockResolvedValue(null);
    expect((await app.request("/api/staff/academic/overview")).status).toBe(403);
    expect(mocks.getStaffAcademicOverview).toHaveBeenCalledTimes(0);
  });

  it("routes every academic endpoint through owner/admin authorization", async () => {
    const app = routeApp();
    const endpoints = [
      ["/api/staff/academic/overview", mocks.getStaffAcademicOverview],
      ["/api/staff/academic/batches?q=data&limit=5&offset=10", mocks.listStaffAcademicBatches],
      ["/api/staff/academic/batches/batch_1?limit=5&offset=10", mocks.getStaffAcademicBatch],
      ["/api/staff/academic/sessions/session_1", mocks.getStaffAcademicSession],
      ["/api/staff/academic/trainers/person_1?range=30d&limit=5&offset=10", mocks.getStaffTrainerActivity],
      ["/api/staff/academic/students/student_1?limit=5&offset=10", mocks.getStaffStudentAttendance],
      ["/api/staff/academic/session-materials/mat_1/content", mocks.getStaffAcademicMaterialContent],
    ] as const;

    for (const [path, service] of endpoints) {
      vi.clearAllMocks();
      authenticateAs(["owner"]);
      expect((await app.request(path)).status).toBe(200);
      expect(service).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      authenticateAs(["counsellor"]);
      expect((await app.request(path)).status).toBe(403);
      expect(service).not.toHaveBeenCalled();
    }
  });

  it("serves staff material PDFs with private inline no-store headers and no raw key", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const response = await app.request("/api/staff/academic/session-materials/mat_1/content");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="notes.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).not.toContain("r2_object_key");
  });
});
