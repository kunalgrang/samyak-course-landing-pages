import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffAdmissionRoutes } from "./staff-admissions";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  idCounter: { value: 0 },
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
  mobileHash: vi.fn(async (_c: unknown, mobile: string) => `hash_${mobile}`),
}));

vi.mock("../lib/crypto", () => ({
  createOpaqueId: vi.fn((prefix: string) => `${prefix}_test_${++mocks.idCounter.value}`),
  decryptText: vi.fn(async (_secret: string, context: string) => {
    if (context.startsWith("referral-mobile:")) return "9876543210";
    return null;
  }),
  encryptText: vi.fn(async (_secret: string, _context: string, value: string) => `cipher:${value}`),
  hmacHex: vi.fn(async (_secret: string, context: string, value: string) => `${context}:${value}`.replace(/[^a-zA-Z0-9]/g, "").padEnd(64, "0").slice(0, 64)),
}));

class SqliteD1Statement {
  private values: unknown[] = [];
  constructor(private readonly db: SqliteD1, private readonly sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.database.prepare(this.sql).get(...(this.values as any[])) ?? null) as T;
  }
  async all<T>() {
    return { results: this.db.database.prepare(this.sql).all(...(this.values as any[])) } as T;
  }
  async run() {
    const result = this.db.database.prepare(this.sql).run(...(this.values as any[]));
    return { success: true, meta: { changes: result.changes, rows_written: result.changes } };
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  prepare(sql: string) {
    return new SqliteD1Statement(this, sql);
  }
  async batch<T extends { run: () => Promise<unknown> }>(statements: T[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  close() {
    this.database.close();
  }
}

describe("staff admission Person link route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.idCounter.value = 0;
    authenticateAs(["admission_admin"], "acct_staff", "person_staff");
  });

  it("views unlinked referral enquiries without exposing crypto internals", async () => {
    const db = testDb();
    const response = await routeApp().request("/api/staff/enquiries/enq_ref", {}, env(db));
    const body = await response.json() as Record<string, unknown>;
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      personLinkCandidate: {
        displayName: "Future Learner",
        mobile: "9876543210",
        mobileDisplay: "+91 98765 43210",
      },
    });
    expect(text).not.toContain("cipher_secret");
    expect(text).not.toContain("hash_9876543210");
    db.close();
  });

  it("links an explicitly selected existing Person and preserves referral attribution", async () => {
    const db = testDb();
    seedExistingPerson(db, "person_existing", "Asha Existing");

    const response = await routeApp().request("/api/staff/enquiries/enq_ref/person-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "existing", personId: "person_existing" }),
    }, env(db));

    expect(response.status).toBe(200);
    expect(row(db, "select id, person_id, source, counsellor_login_account_id, pipeline_stage from enquiries where id = 'enq_ref'")).toMatchObject({
      id: "enq_ref",
      person_id: "person_existing",
      source: "referral",
      counsellor_login_account_id: "acct_staff",
      pipeline_stage: "admission_ready",
    });
    expect(row(db, "select enquiry_id, prospect_person_id, referrer_profile_id, status from referrals where id = 'ref_1'")).toMatchObject({
      enquiry_id: "enq_ref",
      prospect_person_id: "person_existing",
      referrer_profile_id: "referrer_profile_1",
      status: "accepted",
    });
    expect(count(db, "enquiries")).toBe(1);
    expect(count(db, "audit_logs where action = 'admission_enquiry_person_linked'")).toBe(1);
    db.close();
  });

  it("creates a new Person from referral prospect contact and does not expose referral storage", async () => {
    const db = testDb();
    const response = await routeApp().request("/api/staff/enquiries/enq_ref/person-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "create", idempotencyKey: "create-referral-person" }),
    }, env(db));
    const body = await response.json() as { personId: string };

    expect(response.status).toBe(200);
    expect(row(db, "select person_id from enquiries where id = 'enq_ref'")).toMatchObject({ person_id: body.personId });
    expect(row(db, "select full_name from people where id = ?", body.personId)).toMatchObject({ full_name: "Future Learner" });
    expect(row(db, "select normalized_value, last_four from person_contacts where person_id = ?", body.personId)).toMatchObject({ normalized_value: "hash_9876543210", last_four: "3210" });
    expect(JSON.stringify(body)).not.toContain("cipher");
    expect(JSON.stringify(body)).not.toContain("hash_");
    db.close();
  });

  it("does not auto-link shared mobile search results", async () => {
    const db = testDb();
    seedExistingPerson(db, "person_shared_a", "Shared A");
    seedExistingPerson(db, "person_shared_b", "Shared B");

    const response = await routeApp().request("/api/staff/enquiries/enq_ref", {}, env(db));

    expect(response.status).toBe(200);
    expect(row(db, "select person_id from enquiries where id = 'enq_ref'")).toMatchObject({ person_id: null });
    db.close();
  });

  it("denies telecaller and cross-branch link attempts", async () => {
    const teleDb = testDb();
    seedExistingPerson(teleDb, "person_existing", "Asha Existing");
    authenticateAs(["telecaller"], "acct_staff", "person_staff");
    const telecaller = await routeApp().request("/api/staff/enquiries/enq_ref/person-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "existing", personId: "person_existing" }),
    }, env(teleDb));
    expect(telecaller.status).toBe(403);
    teleDb.close();

    const branchDb = testDb();
    seedExistingPerson(branchDb, "person_existing", "Asha Existing");
    branchDb.database.exec("update login_account_roles set branch_id = 'branch_wadala' where login_account_id = 'acct_staff'");
    authenticateAs(["admission_admin"], "acct_staff", "person_staff");
    const crossBranch = await routeApp().request("/api/staff/enquiries/enq_ref/person-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "existing", personId: "person_existing" }),
    }, env(branchDb));
    expect(crossBranch.status).toBe(403);
    branchDb.close();
  });

  it("does not overwrite an enquiry already linked by another request", async () => {
    const db = testDb();
    seedExistingPerson(db, "person_first", "First");
    seedExistingPerson(db, "person_second", "Second");
    db.database.exec("update enquiries set person_id = 'person_first' where id = 'enq_ref'");

    const response = await routeApp().request("/api/staff/enquiries/enq_ref/person-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "existing", personId: "person_second" }),
    }, env(db));

    expect(response.status).toBe(409);
    expect(row(db, "select person_id from enquiries where id = 'enq_ref'")).toMatchObject({ person_id: "person_first" });
    db.close();
  });
});

function routeApp() {
  const app = new Hono();
  registerStaffAdmissionRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], loginAccountId: string, activePersonId: string) {
  mocks.getSessionFromRequest.mockResolvedValue({ record: { login_account_id: loginAccountId, active_person_id: activePersonId } });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

function env(DB: unknown) {
  return { DB, SESSION_PEPPER: "test-pepper" } as never;
}

function testDb() {
  const db = new SqliteD1();
  applyMigrations(db);
  db.database.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at)
    values ('org_samyak', 'Samyak', 'samyak', 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
    values
      ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
      ('branch_wadala', 'org_samyak', 'Wadala', 'WAD', 'Asia/Kolkata', 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into roles (id, organisation_id, code, name, created_at)
    values ('role_admission_admin', 'org_samyak', 'admission_admin', 'Admission Admin', '2026-08-01T00:00:00.000Z');
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
    values ('person_staff', 'org_samyak', 'branch_sion', 'Staff User', 'Staff', 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
    values ('acct_staff', 'org_samyak', 'staff', 'staff', '0000', 1, 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into login_account_roles (login_account_id, role_id, branch_id, created_at)
    values ('acct_staff', 'role_admission_admin', 'branch_sion', '2026-08-01T00:00:00.000Z');
    insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
    values ('course_full_stack', 'org_samyak', 'FSD', 'Full Stack', '6 months', 6, 5000000, 4000000, 1, 1, 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into enquiries
      (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id, source, source_detail, counsellor_login_account_id, status, pipeline_stage, assigned_at, created_at, updated_at)
    values ('enq_ref', 'org_samyak', 'branch_sion', null, 'ENQ-SION-2026-001', 'hash_9876543210', 'course_full_stack', 'referral', 'programme:ref_1', 'acct_staff', 'admission_pending', 'admission_ready', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into referral_programmes (id, organisation_id, code, name, status, validity_days, minimum_fee_percentage, created_at, updated_at)
    values ('programme_1', 'org_samyak', 'student_referral', 'Student Referral', 'active', 90, 50, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
    values ('referrer_profile_1', 'org_samyak', 'person_staff', 'EXT-1', 'token_1', 'https://go.test/r/token_1', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into referral_links (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, expires_at, created_at, updated_at)
    values ('link_1', 'org_samyak', 'programme_1', 'referrer_profile_1', 'token_hash', '1234', 1, 'active', '2026-08-01T00:00:00.000Z', null, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    insert into referrals
      (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id, prospect_person_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until, attributed_at, prospect_name, prospect_mobile_hash, prospect_mobile_last_four, prospect_mobile_ciphertext, consent_recorded_at, idempotency_key_hash, idempotency_payload_hash, created_at, updated_at)
    values ('ref_1', 'org_samyak', 'branch_sion', 'programme_1', 'link_1', 'referrer_profile_1', null, 'enq_ref', 'course_full_stack', 'personal_link', 'accepted', '2026-08-01T00:00:00.000Z', '2026-10-30T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'Future Learner', 'hash_9876543210', '3210', 'cipher_secret', '2026-08-01T00:00:00.000Z', 'idem', 'payload', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  `);
  return db;
}

function seedExistingPerson(db: SqliteD1, personId: string, name: string) {
  db.database.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')")
    .run(personId, name, name);
  db.database.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', 'hash_9876543210', null, '3210', 1, 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')")
    .run(`contact_${personId}`, personId);
}

function applyMigrations(db: SqliteD1) {
  const migrationsDir = join(process.cwd(), "migrations");
  for (const file of readdirSync(migrationsDir).filter((name: string) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part: string) => part.trim()).filter(Boolean)) {
      db.database.exec(statement);
    }
  }
}

function row(db: SqliteD1, sql: string, ...values: unknown[]) {
  return db.database.prepare(sql).get(...(values as any[])) as Record<string, unknown> | undefined;
}

function count(db: SqliteD1, table: string) {
  return Number(row(db, `select count(*) as count from ${table}`)?.count || 0);
}
