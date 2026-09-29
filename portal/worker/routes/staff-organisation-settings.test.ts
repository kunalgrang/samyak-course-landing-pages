import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffOrganisationSettingsRoutes } from "./staff-organisation-settings";
import type { WorkerBindings } from "../bindings";

const TEST_NOW = "2026-09-29T10:00:00.000Z";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  createOpaqueId: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/crypto", () => ({
  createOpaqueId: mocks.createOpaqueId,
}));

function routeApp() {
  const app = new Hono();
  registerStaffOrganisationSettingsRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], organisationId = "org_samyak", loginAccountId = "acct_owner", personId: string | null = "person_owner") {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: {
      login_account_id: loginAccountId,
      active_person_id: personId,
      organisation_id: organisationId,
      active_education_partner_id: null,
      active_subject_type: "person",
    },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff organisation settings routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_NOW));
    vi.clearAllMocks();
    mocks.createOpaqueId.mockImplementation((prefix: string) => `${prefix}_test`);
    authenticateAs(["owner"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the authenticated owner's own active organisation without accepting an org selector", async () => {
    const db = seededDb();
    const app = routeApp();

    authenticateAs(["owner"], "org_samyak");
    const samyak = await app.request("/api/staff/organisation-settings?organisationId=org_rememo", {}, env(db));
    authenticateAs(["owner"], "org_rememo");
    const rememo = await app.request("/api/staff/organisation-settings?organisationId=org_samyak", {}, env(db));

    expect(samyak.status).toBe(200);
    expect(await samyak.json()).toMatchObject({ success: true, organisation: { id: "org_samyak", name: "Samyak Classes", pan: "ABCDE1234F" } });
    expect(rememo.status).toBe(200);
    expect(await rememo.json()).toMatchObject({ success: true, organisation: { id: "org_rememo", name: "Rememo Edu", pan: "" } });
  });

  it.each(["system_admin", "admin", "counsellor", "admission_admin", "student"])("denies %s access", async (role) => {
    const app = routeApp();
    const db = seededDb();
    authenticateAs([role]);

    const get = await app.request("/api/staff/organisation-settings", {}, env(db));
    const patch = await patchSettingsWithCurrentAuth(app, db, { name: "Blocked" });

    expect(get.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(row(db, "select name from organisations where id = ?", "org_samyak")?.name).toBe("Samyak Classes");
  });

  it("denies unauthenticated access", async () => {
    const app = routeApp();
    const db = seededDb();
    mocks.getSessionFromRequest.mockResolvedValue(null);

    expect((await app.request("/api/staff/organisation-settings", {}, env(db))).status).toBe(403);
    expect((await patchSettingsWithCurrentAuth(app, db, { name: "Blocked" })).status).toBe(403);
  });

  it("updates only the authenticated organisation and writes scrubbed audit metadata atomically", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await patchSettings(app, db, {
      name: "Samyak Education",
      legalName: "Samyak Education Private Limited",
      pan: "abcde1234f",
      gstin: "27ABCDE1234F1Z5",
      website: "samyakedu.test",
    }, "org_samyak", "acct_owner", "person_owner");
    const body = await response.json() as { organisation: { name: string; pan: string; gstin: string; updatedAt: string }; changedFields: string[] };
    const samyak = row(db, "select * from organisations where id = ?", "org_samyak")!;
    const rememo = row(db, "select * from organisations where id = ?", "org_rememo")!;
    const audit = row(db, "select * from audit_logs where organisation_id = ?", "org_samyak")!;

    expect(response.status).toBe(200);
    expect(body.organisation).toMatchObject({ name: "Samyak Education", pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5", updatedAt: TEST_NOW });
    expect(body.changedFields).toEqual(expect.arrayContaining(["name", "legalName", "gstin", "website"]));
    expect(samyak.name).toBe("Samyak Education");
    expect(samyak.slug).toBe("samyak");
    expect(samyak.status).toBe("active");
    expect(samyak.organisation_kind).toBe("normal");
    expect(samyak.updated_at).toBe(TEST_NOW);
    expect(JSON.parse(String(samyak.tax_identifiers_json))).toEqual({ pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5" });
    expect(rememo.name).toBe("Rememo Edu");
    expect(rememo.updated_at).toBe("2026-01-02T00:00:00.000Z");
    expect(audit).toMatchObject({
      id: "audit_test",
      organisation_id: "org_samyak",
      branch_id: null,
      actor_login_account_id: "acct_owner",
      actor_person_id: "person_owner",
      action: "organisation_settings_updated",
      entity_type: "organisation",
      entity_id: "org_samyak",
      created_at: TEST_NOW,
    });
    expect(JSON.parse(String(audit.metadata_json))).toEqual({ changedFields: expect.arrayContaining(["name", "gstin"]) });
    expect(String(audit.metadata_json)).not.toContain("ABCDE1234F");
    expect(String(audit.metadata_json)).not.toContain("27ABCDE1234F1Z5");
  });

  it("switches target organisation solely from the authenticated membership", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await patchSettings(app, db, { name: "Rememo Learning" }, "org_rememo", "acct_rememo", "person_rememo");

    expect(response.status).toBe(200);
    expect(row(db, "select name from organisations where id = ?", "org_samyak")?.name).toBe("Samyak Classes");
    expect(row(db, "select name from organisations where id = ?", "org_rememo")?.name).toBe("Rememo Learning");
    expect(row(db, "select actor_login_account_id from audit_logs where organisation_id = ?", "org_rememo")?.actor_login_account_id).toBe("acct_rememo");
  });

  it("requires same-origin for mutations", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await app.request("http://portal.test/api/staff/organisation-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
      body: JSON.stringify(fullPayload({ name: "Blocked" })),
    }, env(db));

    expect(response.status).toBe(403);
    expect(row(db, "select name from organisations where id = ?", "org_samyak")?.name).toBe("Samyak Classes");
  });

  it("rejects blocked internal fields without modifying slug, status, commercial state or tax data", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await patchSettings(app, db, {
      name: "Internal Attack",
      slug: "attacker",
      status: "inactive",
      organisationKind: "demo",
      termsVersion: "evil",
    });

    expect(response.status).toBe(400);
    expect(row(db, "select name, slug, status, organisation_kind, terms_version, tax_identifiers_json from organisations where id = ?", "org_samyak")).toMatchObject({
      name: "Samyak Classes",
      slug: "samyak",
      status: "active",
      organisation_kind: "normal",
      terms_version: "2026-09-24",
      tax_identifiers_json: JSON.stringify({ pan: "ABCDE1234F" }),
    });
    expect(row(db, "select state from organisation_commercial_access where organisation_id = ?", "org_samyak")?.state).toBe("trial");
    expect(count(db, "audit_logs")).toBe(0);
  });

  it("normalizes, rejects and clears India tax identifiers without leaking full tax IDs", async () => {
    const db = seededDb();
    const app = routeApp();

    expect((await patchSettings(app, db, { pan: "bad-pan" })).status).toBe(400);
    expect(row(db, "select tax_identifiers_json from organisations where id = ?", "org_samyak")?.tax_identifiers_json).toBe(JSON.stringify({ pan: "ABCDE1234F" }));

    const cleared = await patchSettings(app, db, { pan: "", gstin: "" });

    expect(cleared.status).toBe(200);
    expect(row(db, "select tax_identifiers_json from organisations where id = ?", "org_samyak")?.tax_identifiers_json).toBeNull();
    const audit = row(db, "select metadata_json from audit_logs where organisation_id = ?", "org_samyak")!;
    expect(JSON.parse(String(audit.metadata_json))).toEqual({ changedFields: ["pan"] });
    expect(String(audit.metadata_json)).not.toContain("ABCDE1234F");
  });

  it("treats no-op saves as success without audit rows or updated_at churn", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await patchSettings(app, db, {});
    const body = await response.json() as { changedFields: string[] };

    expect(response.status).toBe(200);
    expect(body.changedFields).toEqual([]);
    expect(row(db, "select updated_at from organisations where id = ?", "org_samyak")?.updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(count(db, "audit_logs")).toBe(0);
  });
});

async function patchSettings(
  app: Hono,
  db: DatabaseSync,
  overrides: Record<string, unknown>,
  organisationId = "org_samyak",
  loginAccountId = "acct_owner",
  personId: string | null = "person_owner",
) {
  authenticateAs(["owner"], organisationId, loginAccountId, personId);
  return app.request("http://portal.test/api/staff/organisation-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
    body: JSON.stringify(fullPayload(overrides, organisationId)),
  }, env(db));
}

function patchSettingsWithCurrentAuth(app: Hono, db: DatabaseSync, overrides: Record<string, unknown>) {
  return app.request("http://portal.test/api/staff/organisation-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
    body: JSON.stringify(fullPayload(overrides)),
  }, env(db));
}

function fullPayload(overrides: Record<string, unknown>, organisationId = "org_samyak") {
  const base = organisationId === "org_rememo"
    ? {
        name: "Rememo Edu",
        legalName: "Rememo Edu LLP",
        organisationType: "coaching_centre",
        legalEntityType: "llp",
        addressLine1: "2 Rememo Road",
        city: "Pune",
        stateRegion: "Maharashtra",
        country: "India",
        postcode: "411001",
        website: "",
        currency: "INR",
        timezone: "Asia/Kolkata",
        pan: "",
        gstin: "",
      }
    : {
        name: "Samyak Classes",
        legalName: "Samyak Education LLP",
        organisationType: "computer_training_institute",
        legalEntityType: "llp",
        addressLine1: "1 Sion Road",
        city: "Mumbai",
        stateRegion: "Maharashtra",
        country: "India",
        postcode: "400022",
        website: "https://samyak.test",
        currency: "INR",
        timezone: "Asia/Kolkata",
        pan: "ABCDE1234F",
        gstin: "",
      };
  return { ...base, ...overrides };
}

function seededDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table organisations (
      id text primary key,
      name text not null,
      slug text not null,
      status text not null,
      organisation_kind text not null,
      legal_name text,
      organisation_type text,
      legal_entity_type text,
      address_line1 text,
      city text,
      state_region text,
      country text,
      postcode text,
      currency text,
      timezone text,
      website text,
      logo_url text,
      tax_identifiers_json text,
      terms_accepted_at text,
      terms_version text,
      terms_accepted_by_global_identity_id text,
      created_at text not null,
      updated_at text not null
    );
    create table audit_logs (
      id text primary key,
      organisation_id text,
      branch_id text,
      actor_login_account_id text,
      actor_person_id text,
      action text not null,
      entity_type text not null,
      entity_id text,
      metadata_json text,
      created_at text not null
    );
    create table organisation_commercial_access (
      id text primary key,
      organisation_id text not null,
      state text not null,
      trial_started_at text,
      trial_ends_at text,
      created_at text not null,
      updated_at text not null
    );
  `);
  insertOrganisation(db, {
    id: "org_samyak",
    name: "Samyak Classes",
    slug: "samyak",
    legalName: "Samyak Education LLP",
    organisationType: "computer_training_institute",
    legalEntityType: "llp",
    address: "1 Sion Road",
    city: "Mumbai",
    state: "Maharashtra",
    postcode: "400022",
    website: "https://samyak.test",
    tax: JSON.stringify({ pan: "ABCDE1234F" }),
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  insertOrganisation(db, {
    id: "org_rememo",
    name: "Rememo Edu",
    slug: "rememo",
    legalName: "Rememo Edu LLP",
    organisationType: "coaching_centre",
    legalEntityType: "llp",
    address: "2 Rememo Road",
    city: "Pune",
    state: "Maharashtra",
    postcode: "411001",
    website: null,
    tax: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  db.prepare("insert into organisation_commercial_access (id, organisation_id, state, trial_started_at, trial_ends_at, created_at, updated_at) values (?, ?, 'trial', ?, ?, ?, ?)")
    .run("access_samyak", "org_samyak", "2026-01-01", "2026-01-16", "2026-01-01", "2026-01-01");
  return db;
}

function insertOrganisation(db: DatabaseSync, input: {
  id: string;
  name: string;
  slug: string;
  legalName: string;
  organisationType: string;
  legalEntityType: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  website: string | null;
  tax: string | null;
  updatedAt: string;
}) {
  db.prepare(
    `insert into organisations (
      id, name, slug, status, organisation_kind, legal_name, organisation_type, legal_entity_type,
      address_line1, city, state_region, country, postcode, currency, timezone, website, logo_url,
      tax_identifiers_json, terms_accepted_at, terms_version, terms_accepted_by_global_identity_id, created_at, updated_at
    ) values (?, ?, ?, 'active', 'normal', ?, ?, ?, ?, ?, ?, 'India', ?, 'INR', 'Asia/Kolkata', ?, 'https://cdn.test/logo.png', ?, '2026-01-01', '2026-09-24', 'gident_1', '2026-01-01', ?)`,
  ).run(
    input.id,
    input.name,
    input.slug,
    input.legalName,
    input.organisationType,
    input.legalEntityType,
    input.address,
    input.city,
    input.state,
    input.postcode,
    input.website,
    input.tax,
    input.updatedAt,
  );
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function count(db: DatabaseSync, table: string) {
  return Number(row(db, `select count(*) as count from ${table}`)?.count || 0);
}

class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }

  async batch(statements: SqliteD1Statement[]) {
    return statements.map((statement) => statement.run());
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

  async run() {
    this.db.prepare(this.sql).run(...this.params);
    return { success: true };
  }
}

function env(db: DatabaseSync): WorkerBindings {
  return {
    DB: new SqliteD1(db),
    CERTIFICATE_PDFS: {},
  } as unknown as WorkerBindings;
}
