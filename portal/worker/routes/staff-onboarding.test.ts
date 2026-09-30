import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffOnboardingRoutes } from "./staff-onboarding";
import type { WorkerBindings } from "../bindings";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

function routeApp() {
  const app = new Hono();
  registerStaffOnboardingRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], organisationId = "org_samyak", subjectType = "person") {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: {
      login_account_id: `acct_${organisationId}`,
      active_person_id: `person_${organisationId}`,
      organisation_id: organisationId,
      active_education_partner_id: null,
      active_subject_type: subjectType,
    },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff onboarding route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateAs(["owner"]);
  });

  it("returns the authenticated owner's onboarding and trial state", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await app.request("/api/staff/onboarding", {}, env(db));
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      onboarding: {
        status: "in_progress",
        reportedCentreCount: 3,
        completedSteps: ["organisation_profile", "centre_profile", "owner_account"],
        checklist: [
          { code: "organisation_profile", label: "Organisation profile", done: true },
          { code: "centre_profile", label: "Centre profile", done: true },
          { code: "owner_account", label: "Owner account", done: true },
          { code: "courses", label: "Courses", done: false },
        ],
      },
      trial: {
        state: "trial",
        startedAt: "2026-09-30T00:00:00.000Z",
        endsAt: "2026-10-15T00:00:00.000Z",
      },
    });
  });

  it("uses the authenticated organisation and ignores client-supplied organisation selectors", async () => {
    const db = seededDb();
    const app = routeApp();

    authenticateAs(["owner"], "org_samyak");
    const samyak = await app.request("/api/staff/onboarding?organisationId=org_rememo", {}, env(db));
    authenticateAs(["owner"], "org_rememo");
    const rememo = await app.request("/api/staff/onboarding?organisationId=org_samyak", {}, env(db));

    expect(samyak.status).toBe(200);
    expect(await samyak.json()).toMatchObject({ onboarding: { reportedCentreCount: 3 }, trial: { endsAt: "2026-10-15T00:00:00.000Z" } });
    expect(rememo.status).toBe(200);
    expect(await rememo.json()).toMatchObject({ onboarding: { reportedCentreCount: 1 }, trial: { endsAt: "2026-11-01T00:00:00.000Z" } });
  });

  it.each(["system_admin", "admin", "counsellor", "admission_admin", "student"])("denies %s access", async (role) => {
    const db = seededDb();
    const app = routeApp();
    authenticateAs([role]);

    const response = await app.request("/api/staff/onboarding", {}, env(db));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "forbidden" } });
  });

  it("denies non-person staff contexts", async () => {
    const db = seededDb();
    const app = routeApp();
    authenticateAs(["owner"], "org_samyak", "trainer");

    const response = await app.request("/api/staff/onboarding", {}, env(db));

    expect(response.status).toBe(403);
  });

  it("returns a safe domain not-found when onboarding progress is missing", async () => {
    const db = seededDb();
    const app = routeApp();
    db.prepare("delete from organisation_onboarding_progress where organisation_id = ?").run("org_samyak");

    const response = await app.request("/api/staff/onboarding", {}, env(db));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "onboarding_not_found" } });
  });

  it("returns a safe domain error for malformed onboarding JSON", async () => {
    const db = seededDb();
    const app = routeApp();
    db.prepare("update organisation_onboarding_progress set checklist_json = ? where organisation_id = ?").run("{bad", "org_samyak");

    const response = await app.request("/api/staff/onboarding", {}, env(db));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "onboarding_state_invalid" } });
  });

  it("rejects invalid completed steps JSON without fabricating progress", async () => {
    const db = seededDb();
    const app = routeApp();
    db.prepare("update organisation_onboarding_progress set completed_steps_json = ? where organisation_id = ?").run(JSON.stringify([{ code: "organisation_profile" }]), "org_samyak");

    const response = await app.request("/api/staff/onboarding", {}, env(db));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "onboarding_state_invalid" } });
  });

  it("returns a controlled failure when organisation commercial access is missing", async () => {
    const db = seededDb();
    const app = routeApp();
    db.prepare("delete from organisation_commercial_access where organisation_id = ?").run("org_samyak");

    const response = await app.request("/api/staff/onboarding", {}, env(db));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "trial_not_found" } });
  });
});

function seededDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table organisation_onboarding_progress (
      organisation_id text primary key,
      status text not null,
      completed_steps_json text not null,
      checklist_json text not null,
      reported_centre_count integer,
      created_at text not null,
      updated_at text not null
    );
    create table organisation_commercial_access (
      id text primary key,
      organisation_id text not null,
      state text not null,
      trial_started_at text not null,
      trial_ends_at text not null,
      created_at text not null,
      updated_at text not null
    );
  `);
  insertOnboarding(db, "org_samyak", 3, "2026-10-15T00:00:00.000Z");
  insertOnboarding(db, "org_rememo", 1, "2026-11-01T00:00:00.000Z");
  return db;
}

function insertOnboarding(db: DatabaseSync, organisationId: string, reportedCentreCount: number, trialEndsAt: string) {
  const checklist = [
    { code: "organisation_profile", label: "Organisation profile", done: true },
    { code: "centre_profile", label: "Centre profile", done: true },
    { code: "owner_account", label: "Owner account", done: true },
    { code: "courses", label: "Courses", done: false },
  ];
  db.prepare(
    "insert into organisation_onboarding_progress (organisation_id, status, completed_steps_json, checklist_json, reported_centre_count, created_at, updated_at) values (?, 'in_progress', ?, ?, ?, ?, ?)",
  ).run(organisationId, JSON.stringify(["organisation_profile", "centre_profile", "owner_account"]), JSON.stringify(checklist), reportedCentreCount, "2026-09-30T00:00:00.000Z", "2026-09-30T00:00:00.000Z");
  db.prepare(
    "insert into organisation_commercial_access (id, organisation_id, state, trial_started_at, trial_ends_at, created_at, updated_at) values (?, ?, 'trial', ?, ?, ?, ?)",
  ).run(`access_${organisationId}`, organisationId, "2026-09-30T00:00:00.000Z", trialEndsAt, "2026-09-30T00:00:00.000Z", "2026-09-30T00:00:00.000Z");
}

class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

class SqliteD1Statement {
  private params: SQLInputValue[] = [];

  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}

  bind(...params: SQLInputValue[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    return this.db.prepare(this.sql).get(...this.params) as T | null;
  }
}

function env(db: DatabaseSync): WorkerBindings {
  return {
    DB: new SqliteD1(db),
    CERTIFICATE_PDFS: {},
  } as unknown as WorkerBindings;
}
