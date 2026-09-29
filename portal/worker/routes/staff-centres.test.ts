import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffCentreRoutes } from "./staff-centres";
import { registerStaffStudentRoutes } from "./staff-students";
import type { WorkerBindings } from "../bindings";

const TEST_NOW = "2026-09-29T10:00:00.000Z";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  createOpaqueId: vi.fn(),
  mobileHash: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
  mobileHash: mocks.mobileHash,
}));

vi.mock("../lib/crypto", () => ({
  createOpaqueId: mocks.createOpaqueId,
}));

function routeApp() {
  const app = new Hono();
  registerStaffCentreRoutes(app as never);
  registerStaffStudentRoutes(app as never);
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

describe("staff centre routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_NOW));
    vi.clearAllMocks();
    const counters: Record<string, number> = {};
    mocks.createOpaqueId.mockImplementation((prefix: string) => {
      counters[prefix] = (counters[prefix] || 0) + 1;
      return `${prefix}_${counters[prefix]}`;
    });
    mocks.mobileHash.mockImplementation(async (_c: unknown, mobile: string) => `hash_${mobile}`);
    authenticateAs(["owner"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists all centres for the authenticated owner organisation without accepting cross-org selectors", async () => {
    const db = seededDb();
    const app = routeApp();

    authenticateAs(["owner"], "org_samyak");
    const samyak = await app.request("/api/staff/centres?organisationId=org_rememo", {}, env(db));
    authenticateAs(["owner"], "org_rememo");
    const rememo = await app.request("/api/staff/centres?organisationId=org_samyak", {}, env(db));

    expect(samyak.status).toBe(200);
    expect(await samyak.json()).toMatchObject({
      success: true,
      centres: [
        { id: "branch_main", name: "Samyak Main", code: "CTR-001", status: "active", centreStatus: "active", canOperate: true },
        { id: "branch_pending", name: "Samyak Pending", code: "CTR-002", status: "inactive", centreStatus: "pending_subscription", canOperate: false },
      ],
    });
    expect(rememo.status).toBe(200);
    expect(await rememo.json()).toMatchObject({ success: true, centres: [{ id: "branch_rememo", name: "Rememo Main" }] });
  });

  it.each(["system_admin", "admin", "counsellor", "admission_admin", "student"])("denies %s centre administration access", async (role) => {
    const app = routeApp();
    const db = seededDb();
    authenticateAs([role]);

    const get = await app.request("/api/staff/centres", {}, env(db));
    const post = await postCentreWithCurrentAuth(app, db, createPayload({ name: "Blocked Centre" }));

    expect(get.status).toBe(403);
    expect(post.status).toBe(403);
    expect(count(db, "branches where name = 'Blocked Centre'")).toBe(0);
  });

  it("denies unauthenticated access", async () => {
    const app = routeApp();
    const db = seededDb();
    mocks.getSessionFromRequest.mockResolvedValue(null);

    expect((await app.request("/api/staff/centres", {}, env(db))).status).toBe(403);
    expect((await postCentreWithCurrentAuth(app, db, createPayload({ name: "Blocked Centre" }))).status).toBe(403);
  });

  it("creates a centre in the owner's organisation with server-managed code and pending subscription status", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await postCentre(app, db, createPayload({
      name: "Andheri Centre",
      mobile: "+91 98765 43210",
      pan: "abcde1234f",
      gstin: "27abcde1234f1z5",
    }));
    const body = await response.json() as { centre: Record<string, unknown> };
    const centre = row(db, "select * from branches where id = ?", "branch_1")!;
    const audit = row(db, "select * from audit_logs where entity_id = ?", "branch_1")!;

    expect(response.status).toBe(201);
    expect(body.centre).toMatchObject({
      id: "branch_1",
      name: "Andheri Centre",
      code: "CTR-003",
      status: "inactive",
      centreStatus: "pending_subscription",
      canOperate: false,
      subscriptionStatusLabel: "Pending Subscription",
      maskedMobile: "******3210",
      pan: "ABCDE1234F",
      gstin: "27ABCDE1234F1Z5",
    });
    expect(JSON.stringify(body)).not.toContain("hash_9876543210");
    expect(centre).toMatchObject({
      organisation_id: "org_samyak",
      code: "CTR-003",
      status: "inactive",
      centre_status: "pending_subscription",
      mobile_hash: "hash_9876543210",
      mobile_last_four: "3210",
      tax_identifiers_json: JSON.stringify({ pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5" }),
      created_at: TEST_NOW,
      updated_at: TEST_NOW,
    });
    expect(row(db, "select state from organisation_commercial_access where organisation_id = ?", "org_samyak")?.state).toBe("active");
    expect(audit).toMatchObject({
      organisation_id: "org_samyak",
      branch_id: "branch_1",
      actor_login_account_id: "acct_owner",
      action: "centre_created",
      entity_type: "branch",
      created_at: TEST_NOW,
    });
    expect(JSON.parse(String(audit.metadata_json))).toEqual({ centreCode: "CTR-003", operatingModel: "company_owned", initialStatus: "pending_subscription" });
    expect(String(audit.metadata_json)).not.toContain("ABCDE1234F");
    expect(String(audit.metadata_json)).not.toContain("9876543210");
  });

  it("rejects client-controlled organisation, code and lifecycle fields on create", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await postCentre(app, db, {
      ...createPayload({ name: "Injected Centre" }),
      organisationId: "org_rememo",
      code: "CTR-999",
      status: "active",
      centreStatus: "active",
    });

    expect(response.status).toBe(400);
    expect(count(db, "branches where name = 'Injected Centre'")).toBe(0);
  });

  it("keeps newly created pending centres out of operational enquiry branch options", async () => {
    const db = seededDb();
    const app = routeApp();

    await postCentre(app, db, createPayload({ name: "Pending East", mobile: "9876543210" }));
    const options = await app.request("/api/staff/enquiry-options", {}, env(db));
    const body = await options.json() as { branches: Array<{ id: string; name: string }> };

    expect(options.status).toBe(200);
    expect(body.branches).toEqual([{ id: "branch_main", code: "CTR-001", name: "Samyak Main" }]);
  });

  it("rejects duplicate names and invalid centre inputs", async () => {
    const db = seededDb();
    const app = routeApp();

    expect((await postCentre(app, db, createPayload({ name: "Samyak Main" }))).status).toBe(409);
    expect((await postCentre(app, db, createPayload({ email: "bad-email" }))).status).toBe(400);
    expect((await postCentre(app, db, createPayload({ pan: "bad-pan" }))).status).toBe(400);
    expect((await postCentre(app, db, createPayload({ gstin: "bad-gstin" }))).status).toBe(400);
    expect((await postCentre(app, db, createPayload({ mobile: "022-12345678" }))).status).toBe(400);
    expect(count(db, "branches where code = 'CTR-003'")).toBe(0);
  });

  it("updates only owned editable centre fields, preserves blank mobile and writes changed-field audit metadata", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await patchCentre(app, db, "branch_pending", updatePayload({
      name: "Samyak Pending Updated",
      newMobile: "99999 88888",
      pan: "",
      gstin: "27ABCDE1234F1Z5",
    }));
    const body = await response.json() as { centre: Record<string, unknown>; changedFields: string[] };
    const centre = row(db, "select * from branches where id = ?", "branch_pending")!;
    const audit = row(db, "select * from audit_logs where action = 'centre_updated'")!;

    expect(response.status).toBe(200);
    expect(body.centre).toMatchObject({
      name: "Samyak Pending Updated",
      code: "CTR-002",
      status: "inactive",
      centreStatus: "pending_subscription",
      maskedMobile: "******8888",
      pan: "",
      gstin: "27ABCDE1234F1Z5",
      updatedAt: TEST_NOW,
    });
    expect(body.changedFields).toEqual(expect.arrayContaining(["name", "mobile", "pan", "gstin"]));
    expect(centre).toMatchObject({
      organisation_id: "org_samyak",
      code: "CTR-002",
      status: "inactive",
      centre_status: "pending_subscription",
      mobile_hash: "hash_9999988888",
      mobile_last_four: "8888",
      tax_identifiers_json: JSON.stringify({ gstin: "27ABCDE1234F1Z5" }),
      updated_at: TEST_NOW,
    });
    expect(JSON.parse(String(audit.metadata_json))).toEqual({ changedFields: expect.arrayContaining(["name", "mobile", "pan", "gstin"]) });
    expect(String(audit.metadata_json)).not.toContain("27ABCDE1234F1Z5");
    expect(String(audit.metadata_json)).not.toContain("9999988888");
  });

  it("rejects cross-org edits and lifecycle field edits", async () => {
    const db = seededDb();
    const app = routeApp();

    authenticateAs(["owner"], "org_rememo", "acct_rememo", "person_rememo");
    const crossOrg = await patchCentreWithCurrentAuth(app, db, "branch_main", updatePayload({ name: "Hijacked" }));
    authenticateAs(["owner"], "org_samyak");
    const lifecycle = await patchCentre(app, db, "branch_pending", {
      ...updatePayload({ name: "Lifecycle Attack" }),
      code: "CTR-999",
      status: "active",
      centreStatus: "active",
    });

    expect(crossOrg.status).toBe(404);
    expect(lifecycle.status).toBe(400);
    expect(row(db, "select name, code, status, centre_status from branches where id = ?", "branch_pending")).toMatchObject({
      name: "Samyak Pending",
      code: "CTR-002",
      status: "inactive",
      centre_status: "pending_subscription",
    });
    expect(count(db, "audit_logs")).toBe(0);
  });

  it("treats blank replacement mobile and no-op saves as success without audit churn", async () => {
    const db = seededDb();
    const app = routeApp();

    const response = await patchCentre(app, db, "branch_pending", updatePayload({ newMobile: "" }));
    const body = await response.json() as { changedFields: string[] };

    expect(response.status).toBe(200);
    expect(body.changedFields).toEqual([]);
    expect(row(db, "select mobile_hash, mobile_last_four, updated_at from branches where id = ?", "branch_pending")).toMatchObject({
      mobile_hash: "hash_9123456789",
      mobile_last_four: "6789",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    expect(count(db, "audit_logs")).toBe(0);
  });
});

async function postCentre(app: Hono, db: DatabaseSync, body: Record<string, unknown>) {
  authenticateAs(["owner"], "org_samyak", "acct_owner", "person_owner");
  return postCentreWithCurrentAuth(app, db, body);
}

function postCentreWithCurrentAuth(app: Hono, db: DatabaseSync, body: Record<string, unknown>) {
  return app.request("http://portal.test/api/staff/centres", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
    body: JSON.stringify(body),
  }, env(db));
}

async function patchCentre(app: Hono, db: DatabaseSync, centreId: string, body: Record<string, unknown>) {
  authenticateAs(["owner"], "org_samyak", "acct_owner", "person_owner");
  return patchCentreWithCurrentAuth(app, db, centreId, body);
}

function patchCentreWithCurrentAuth(app: Hono, db: DatabaseSync, centreId: string, body: Record<string, unknown>) {
  return app.request(`http://portal.test/api/staff/centres/${encodeURIComponent(centreId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
    body: JSON.stringify(body),
  }, env(db));
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "New Centre",
    mobile: "9876543210",
    email: "centre@samyak.test",
    addressLine1: "3 New Road",
    city: "Mumbai",
    stateRegion: "Maharashtra",
    postcode: "400050",
    country: "India",
    operatingModel: "company_owned",
    currency: "INR",
    timezone: "Asia/Kolkata",
    pan: "",
    gstin: "",
    ...overrides,
  };
}

function updatePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Samyak Pending",
    newMobile: "",
    email: "pending@samyak.test",
    addressLine1: "2 Trial Road",
    city: "Mumbai",
    stateRegion: "Maharashtra",
    postcode: "400051",
    country: "India",
      operatingModel: "franchise_operated",
    currency: "INR",
    timezone: "Asia/Kolkata",
    pan: "ABCDE1234F",
    gstin: "",
    ...overrides,
  };
}

function seededDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table organisations (
      id text primary key,
      name text not null,
      slug text not null,
      status text not null,
      created_at text not null,
      updated_at text not null
    );
    create table branches (
      id text primary key,
      organisation_id text not null,
      name text not null,
      code text not null,
      timezone text,
      status text not null,
      address_line1 text,
      city text,
      state_region text,
      postcode text,
      country text,
      mobile_hash text,
      mobile_last_four text,
      email text,
      currency text,
      operating_model text,
      centre_status text not null default 'active',
      tax_identifiers_json text,
      created_at text not null,
      updated_at text not null
    );
    create unique index branches_organisation_code_unique on branches (organisation_id, code);
    create unique index branches_organisation_name_unique on branches (organisation_id, name);
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
    create table courses (
      id text primary key,
      organisation_id text not null,
      code text not null,
      name text not null,
      duration_label text,
      default_fee_paise integer,
      nsdc_available integer not null default 0,
      admission_configuration_complete integer not null default 0,
      status text not null
    );
  `);
  insertOrganisation(db, "org_samyak", "Samyak Classes", "samyak");
  insertOrganisation(db, "org_rememo", "Rememo Edu", "rememo");
  insertBranch(db, {
    id: "branch_main",
    organisationId: "org_samyak",
    name: "Samyak Main",
    code: "CTR-001",
    status: "active",
    centreStatus: "active",
    mobileHash: "hash_9876543210",
    lastFour: "3210",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  insertBranch(db, {
    id: "branch_pending",
    organisationId: "org_samyak",
    name: "Samyak Pending",
    code: "CTR-002",
    status: "inactive",
    centreStatus: "pending_subscription",
    mobileHash: "hash_9123456789",
    lastFour: "6789",
    tax: JSON.stringify({ pan: "ABCDE1234F" }),
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  insertBranch(db, {
    id: "branch_rememo",
    organisationId: "org_rememo",
    name: "Rememo Main",
    code: "CTR-001",
    status: "active",
    centreStatus: "active",
    mobileHash: "hash_9000011111",
    lastFour: "1111",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  db.prepare("insert into organisation_commercial_access (id, organisation_id, state, trial_started_at, trial_ends_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run("access_samyak", "org_samyak", "active", "2026-01-01", "2026-01-16", "2026-01-01", "2026-01-01");
  db.prepare("insert into courses (id, organisation_id, code, name, duration_label, default_fee_paise, nsdc_available, admission_configuration_complete, status) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("course_1", "org_samyak", "ADCA", "Advanced Diploma", "12 months", 4500000, 1, 1, "active");
  return db;
}

function insertOrganisation(db: DatabaseSync, id: string, name: string, slug: string) {
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values (?, ?, ?, 'active', '2026-01-01', '2026-01-01')")
    .run(id, name, slug);
}

function insertBranch(db: DatabaseSync, input: {
  id: string;
  organisationId: string;
  name: string;
  code: string;
  status: string;
  centreStatus: string;
  mobileHash: string;
  lastFour: string;
  tax?: string | null;
  updatedAt: string;
}) {
  db.prepare(
    `insert into branches (
      id, organisation_id, name, code, timezone, status, address_line1, city, state_region,
      postcode, country, mobile_hash, mobile_last_four, email, currency, operating_model,
      centre_status, tax_identifiers_json, created_at, updated_at
    ) values (?, ?, ?, ?, 'Asia/Kolkata', ?, ?, 'Mumbai', 'Maharashtra', '400051', 'India', ?, ?, ?, 'INR', 'franchise_operated', ?, ?, '2026-01-01T00:00:00.000Z', ?)`,
  ).run(
    input.id,
    input.organisationId,
    input.name,
    input.code,
    input.status,
    input.id === "branch_pending" ? "2 Trial Road" : "1 Main Road",
    input.mobileHash,
    input.lastFour,
    input.id === "branch_pending" ? "pending@samyak.test" : "main@samyak.test",
    input.centreStatus,
    input.tax || null,
    input.updatedAt,
  );
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function count(db: DatabaseSync, tableOrWhere: string) {
  return Number(row(db, `select count(*) as count from ${tableOrWhere}`)?.count || 0);
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

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
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
