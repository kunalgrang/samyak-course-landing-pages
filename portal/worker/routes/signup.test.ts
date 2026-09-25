/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import type { WorkerBindings } from "../bindings";
import { hmacHex } from "../lib/crypto";

const NOW = "2026-09-24T10:00:00.000Z";
const SESSION_PEPPER = "test-pepper";
const REFERRAL_TOKEN_PEPPER = "referral-pepper";

type Row = Record<string, any>;

describe("organisation signup onboarding", () => {
  it("verifies OTP without creating tenant data, then creates the tenant foundation and active owner session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    installTurnstile();
    const fixture = createFixture();
    try {
      const otp = await requestSignupOtp(fixture.env, "9876543210");
      const challengeId = String((await otp.json() as Row).challengeId);
      const verified = await verifySignupOtp(fixture.env, challengeId);
      const verificationId = String((await verified.json() as Row).signupVerificationId);

      expect(count(fixture.sqlite, "organisations where id <> 'org_samyak'")).toBe(0);
      expect(count(fixture.sqlite, "branches where organisation_id <> 'org_samyak'")).toBe(0);
      expect(count(fixture.sqlite, "organisation_memberships where organisation_id <> 'org_samyak'")).toBe(0);
      expect(count(fixture.sqlite, "organisation_commercial_access")).toBe(0);

      const created = await createOrganisation(fixture.env, verificationId, "signup-request-1");
      expect(created.status).toBe(200);
      const cookie = sessionCookie(created);
      const body = await created.json() as Row;
      expect(body).toMatchObject({ success: true, organisation: { name: "Apex Skills" } });
      expect(body.trial.startedAt).toBe(NOW);
      expect(body.trial.endsAt).toBe("2026-10-09T10:00:00.000Z");

      const orgId = String(body.organisation.id);
      expect(row(fixture.sqlite, "select legal_name, organisation_type, legal_entity_type, terms_version from organisations where id = ?", orgId)).toMatchObject({
        legal_name: "Apex Skills Private Limited",
        organisation_type: "computer_training_institute",
        legal_entity_type: "private_limited",
        terms_version: "2026-09-24",
      });
      expect(row(fixture.sqlite, "select organisation_kind from organisations where id = ?", orgId)).toEqual({ organisation_kind: "normal" });
      expect(row(fixture.sqlite, "select name, code, operating_model, centre_status from branches where organisation_id = ?", orgId)).toMatchObject({
        name: "Sion Centre",
        code: "CTR-001",
        operating_model: "company_owned",
        centre_status: "active",
      });
      expect(count(fixture.sqlite, `organisation_account_authorities where organisation_id = '${orgId}' and authorisation_required = 1 and authorisation_status = 'pending_document'`)).toBe(1);
      expect(count(fixture.sqlite, `organisation_memberships where organisation_id = '${orgId}' and status = 'active'`)).toBe(1);
      expect(count(fixture.sqlite, `login_account_people join people on people.id = login_account_people.person_id where people.organisation_id = '${orgId}' and login_account_people.access_type = 'staff'`)).toBe(1);
      expect(count(fixture.sqlite, `organisation_commercial_access where organisation_id = '${orgId}' and state = 'trial'`)).toBe(1);
      expect(count(fixture.sqlite, `organisation_onboarding_progress where organisation_id = '${orgId}'`)).toBe(1);
      expect(count(fixture.sqlite, `audit_logs where organisation_id = '${orgId}' and action in ('organisation_created', 'initial_centre_created', 'account_authority_established', 'trial_started', 'legal_entity_type_captured', 'initial_tenant_context_established')`)).toBe(6);

      const session = await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, fixture.env);
      await expect(session.json()).resolves.toMatchObject({
        authenticated: true,
        activeProfile: expect.objectContaining({ accessType: "staff", effectiveRoles: ["owner"] }),
        accountRoles: ["owner"],
      });
      const studentHome = await app.request("http://localhost/api/student/home", { headers: { Cookie: cookie } }, fixture.env);
      expect(studentHome.status).toBe(403);
      await expect(studentHome.json()).resolves.toMatchObject({ error: { code: "student_profile_required" } });
      expect((await app.request("http://localhost/api/staff/enquiry-options", { headers: { Cookie: cookie } }, fixture.env)).status).toBe(200);
      await expect((await app.request("http://localhost/api/trainer/session", { headers: { Cookie: cookie } }, fixture.env)).json()).resolves.toMatchObject({
        authenticated: false,
      });
      await expect((await app.request("http://localhost/api/partner/session", { headers: { Cookie: cookie } }, fixture.env)).json()).resolves.toMatchObject({
        authenticated: false,
      });
    } finally {
      fixture.close();
    }
  });

  it("reuses an existing global identity and leaves existing memberships untouched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    installTurnstile();
    const fixture = createFixture();
    try {
      await seedExistingSamyakIdentity(fixture.sqlite, "9876543210");
      const beforeMemberships = count(fixture.sqlite, "organisation_memberships where organisation_id = 'org_samyak'");
      const otp = await requestSignupOtp(fixture.env, "9876543210");
      const challengeId = String((await otp.json() as Row).challengeId);
      const verification = await verifySignupOtp(fixture.env, challengeId);
      const verificationId = String((await verification.json() as Row).signupVerificationId);
      const created = await createOrganisation(fixture.env, verificationId, "signup-request-existing", { brandName: "Apex Skills" });
      const orgId = String(((await created.json()) as Row).organisation.id);

      expect(count(fixture.sqlite, "global_identities")).toBe(1);
      expect(count(fixture.sqlite, "organisation_memberships where organisation_id = 'org_samyak'")).toBe(beforeMemberships);
      expect(count(fixture.sqlite, `organisation_memberships where organisation_id = '${orgId}'`)).toBe(1);
      expect(row(fixture.sqlite, `select people.id as person_id from people join login_account_people on login_account_people.person_id = people.id join login_accounts on login_accounts.id = login_account_people.login_account_id where login_accounts.organisation_id = '${orgId}'`)?.person_id)
        .not.toBe("person_existing_owner");
    } finally {
      fixture.close();
    }
  });

  it("allows duplicate display names across organisations, blocks duplicate retry creation, and ignores client trial dates and demo flags", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    installTurnstile();
    const fixture = createFixture();
    try {
      const firstVerification = await verifiedSignupId(fixture.env, "9876543210");
      const first = await createOrganisation(fixture.env, firstVerification, "same-submit", { brandName: "Shared Academy", trialEndsAt: "2099-01-01T00:00:00.000Z", organisationKind: "demo" });
      const firstBody = await first.json() as Row;
      const retry = await createOrganisation(fixture.env, firstVerification, "same-submit", { brandName: "Shared Academy" });
      const retryBody = await retry.json() as Row;
      expect(retryBody.organisation.id).toBe(firstBody.organisation.id);
      expect(count(fixture.sqlite, "organisations where name = 'Shared Academy'")).toBe(1);
      expect(row(fixture.sqlite, "select trial_ends_at from organisation_commercial_access where organisation_id = ?", String(firstBody.organisation.id))?.trial_ends_at)
        .toBe("2026-10-09T10:00:00.000Z");
      expect(row(fixture.sqlite, "select organisation_kind from organisations where id = ?", String(firstBody.organisation.id))?.organisation_kind)
        .toBe("normal");

      const secondVerification = await verifiedSignupId(fixture.env, "9876543211");
      const second = await createOrganisation(fixture.env, secondVerification, "second-submit", { brandName: "Shared Academy", centreName: "Dadar Centre", centreMobile: "9876543211" });
      const secondBody = await second.json() as Row;
      expect(secondBody.organisation.id).not.toBe(firstBody.organisation.id);
      expect(count(fixture.sqlite, "organisations where name = 'Shared Academy'")).toBe(2);
    } finally {
      fixture.close();
    }
  });

  it("rejects organisation creation without a valid signup verification and validates type fields", async () => {
    installTurnstile();
    const fixture = createFixture();
    try {
      const rejected = await createOrganisation(fixture.env, "signup_missing", "invalid-request");
      expect(rejected.status).toBe(403);
      expect(count(fixture.sqlite, "organisations where id <> 'org_samyak'")).toBe(0);

      const verificationId = await verifiedSignupId(fixture.env, "9876543210");
      const invalidType = await createOrganisation(fixture.env, verificationId, "bad-type", { organisationType: "franchise" });
      expect(invalidType.status).toBe(400);
      expect(count(fixture.sqlite, "organisations where id <> 'org_samyak'")).toBe(0);
    } finally {
      fixture.close();
    }
  });

  it("applies 0034 over existing Samyak rows without rewriting auth, session or audit actors", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    try {
      applyMigrationsThrough(db, "0033_global_identity_memberships.sql");
      seedSamyakOperationalRows(db);
      const before = {
        organisations: rows(db, "select id, name, slug, status, created_at, updated_at from organisations order by id"),
        branches: rows(db, "select id, organisation_id, name, code, timezone, status, created_at, updated_at from branches order by id"),
        loginAccounts: rows(db, "select id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized from login_accounts order by id"),
        memberships: rows(db, "select id, organisation_id, login_account_id, global_identity_id from organisation_memberships order by id"),
        sessions: rows(db, "select id, login_account_id, organisation_membership_id, active_person_id from user_sessions order by id"),
        auditActors: rows(db, "select id, actor_login_account_id, actor_person_id from audit_logs order by id"),
      };

      applyMigrationFile(db, "0034_organisation_signup_trial_onboarding.sql");

      expect(rows(db, "select id, name, slug, status, created_at, updated_at from organisations order by id")).toEqual(before.organisations);
      expect(rows(db, "select id, organisation_id, name, code, timezone, status, created_at, updated_at from branches order by id")).toEqual(before.branches);
      expect(row(db, "select centre_status, operating_model from branches where id = 'branch_sion'")).toMatchObject({ centre_status: "active", operating_model: null });
      expect(rows(db, "select id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized from login_accounts order by id")).toEqual(before.loginAccounts);
      expect(rows(db, "select id, organisation_id, login_account_id, global_identity_id from organisation_memberships order by id")).toEqual(before.memberships);
      expect(rows(db, "select id, login_account_id, organisation_membership_id, active_person_id from user_sessions order by id")).toEqual(before.sessions);
      expect(rows(db, "select id, actor_login_account_id, actor_person_id from audit_logs order by id")).toEqual(before.auditActors);
      expect(columns(db, "organisations")).toEqual(expect.arrayContaining(["legal_name", "terms_accepted_by_global_identity_id"]));
      expect(columns(db, "branches")).toEqual(expect.arrayContaining(["centre_status", "operating_model"]));
      expect(tableNames(db)).toEqual(expect.arrayContaining(["signup_verifications", "organisation_account_authorities", "organisation_commercial_access", "organisation_onboarding_progress"]));
      expect(indexNames(db)).toEqual(expect.arrayContaining(["branches_organisation_name_unique", "organisation_commercial_access_org_unique", "signup_verifications_challenge_unique"]));
    } finally {
      db.close();
    }
  });

  it("applies 0035 over existing Samyak rows with a normal demo-safety default", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    try {
      applyMigrationsThrough(db, "0034_organisation_signup_trial_onboarding.sql");
      seedSamyakOperationalRows(db);
      const before = {
        organisations: rows(db, "select id, name, slug, status, created_at, updated_at from organisations order by id"),
        commercialAccess: count(db, "organisation_commercial_access"),
        memberships: count(db, "organisation_memberships"),
        auditLogs: count(db, "audit_logs"),
      };

      applyMigrationFile(db, "0035_demo_organisation_safety_controls.sql");

      expect(rows(db, "select id, name, slug, status, created_at, updated_at from organisations order by id")).toEqual(before.organisations);
      expect(row(db, "select organisation_kind from organisations where id = 'org_samyak'")).toEqual({ organisation_kind: "normal" });
      expect(count(db, "organisation_commercial_access")).toBe(before.commercialAccess);
      expect(count(db, "organisation_memberships")).toBe(before.memberships);
      expect(count(db, "audit_logs")).toBe(before.auditLogs);
      expect(columns(db, "organisations")).toEqual(expect.arrayContaining(["organisation_kind"]));
      expect(indexNames(db)).toEqual(expect.arrayContaining(["organisations_kind_idx"]));
    } finally {
      db.close();
    }
  });
});

async function verifiedSignupId(env: WorkerBindings, mobile: string) {
  const otp = await requestSignupOtp(env, mobile);
  const challengeId = String((await otp.json() as Row).challengeId);
  const verified = await verifySignupOtp(env, challengeId);
  return String((await verified.json() as Row).signupVerificationId);
}

async function requestSignupOtp(env: WorkerBindings, mobile: string) {
  return app.request("http://localhost/api/signup/request-otp", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, turnstileToken: "turnstile-token" }),
  }, env);
}

async function verifySignupOtp(env: WorkerBindings, challengeId: string) {
  return app.request("http://localhost/api/signup/verify-otp", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, otp: "123456" }),
  }, env);
}

async function createOrganisation(env: WorkerBindings, signupVerificationId: string, idempotencyKey: string, overrides: Record<string, unknown> = {}) {
  const body = {
    signupVerificationId,
    idempotencyKey,
    trialEndsAt: overrides.trialEndsAt,
    organisation: {
      brandName: overrides.brandName || "Apex Skills",
      organisationKind: overrides.organisationKind,
      legalName: "Apex Skills Private Limited",
      organisationType: overrides.organisationType || "computer_training_institute",
      legalEntityType: "private_limited",
      address: "101 Skill Street",
      city: "Mumbai",
      stateRegion: "Maharashtra",
      country: "India",
      postcode: "400022",
      pan: "ABCDE1234F",
      gstin: "27ABCDE1234F1Z5",
      termsAccepted: true,
    },
    authority: {
      name: "Asha Owner",
      mobile: overrides.authorityMobile || overrides.centreMobile || "9876543210",
      email: "asha.owner@example.com",
    },
    centre: {
      name: overrides.centreName || "Sion Centre",
      address: "101 Skill Street",
      city: "Mumbai",
      stateRegion: "Maharashtra",
      postcode: "400022",
      country: "India",
      mobile: overrides.centreMobile || "9876543210",
      email: "sion@example.com",
      operatingModel: "company_owned",
      status: "active",
    },
  };
  return app.request("http://localhost/api/signup/create-organisation", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, env);
}

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("pragma foreign_keys = on");
  applyAllMigrations(sqlite);
  seedSamyak(sqlite);
  const env = bindings(sqlite);
  return { sqlite, env, close: () => sqlite.close() };
}

function bindings(sqlite: DatabaseSync): WorkerBindings {
  return {
    DB: new SqliteD1(sqlite) as unknown as D1Database,
    ENVIRONMENT: "development",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SESSION_PEPPER,
    REFERRAL_TOKEN_PEPPER,
    REFERRAL_PUBLIC_ORIGIN: "https://go.samyaksion.com",
    CERTIFICATE_VERIFICATION_ORIGIN: "https://go.samyaksion.com",
    DEV_OTP: "123456",
  };
}

function installTurnstile() {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true, action: "request-otp", hostname: "localhost" }), { status: 200, headers: { "Content-Type": "application/json" } });
    throw new Error(`Unexpected fetch in signup test: ${url}`);
  }));
}

function applyAllMigrations(db: DatabaseSync) {
  for (const file of migrationFiles()) {
    if (file === "0012_d1_referral_foundation.sql") seedSamyak(db);
    applyMigrationFile(db, file);
  }
}

function migrationFiles() {
  return readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function applyMigrationsThrough(db: DatabaseSync, throughFile: string) {
  for (const file of migrationFiles()) {
    if (file > throughFile) break;
    if (file === "0012_d1_referral_foundation.sql") seedSamyak(db);
    applyMigrationFile(db, file);
  }
}

function seedSamyak(db: DatabaseSync) {
  db.exec(`
    insert or ignore into organisations (id, name, slug, status, created_at, updated_at)
      values ('org_samyak', 'Samyak', 'samyak', 'active', '${NOW}', '${NOW}');
    insert or ignore into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
      values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}');
  `);
}

async function seedExistingSamyakIdentity(db: DatabaseSync, mobile: string) {
  const hash = await hmacHex(SESSION_PEPPER, "mobile", mobile);
  db.prepare("insert or ignore into roles (id, organisation_id, code, name, created_at) values ('role_owner_existing', 'org_samyak', 'owner', 'Owner', ?)").run(NOW);
  db.prepare("insert or ignore into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_existing_owner', 'org_samyak', 'branch_sion', 'Existing Owner', 'Existing Owner', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at) values ('gident_existing', ?, ?, ?, 'active', ?, ?)").run(hash, hash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into login_accounts (id, organisation_id, global_identity_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values ('acct_existing_owner', 'org_samyak', 'gident_existing', ?, ?, ?, 1, 'active', ?, ?)").run(hash, hash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at) values ('omem_existing_owner', 'gident_existing', 'org_samyak', 'acct_existing_owner', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("update login_accounts set organisation_membership_id = 'omem_existing_owner' where id = 'acct_existing_owner'").run();
  db.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('acct_existing_owner', 'person_existing_owner', 'staff', 1, 1, ?)").run(NOW);
  db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values ('acct_existing_owner', 'role_owner_existing', null, ?)").run(NOW);
}

function seedSamyakOperationalRows(db: DatabaseSync) {
  db.exec(`
    insert or ignore into roles (id, organisation_id, code, name, created_at) values ('role_owner_existing', 'org_samyak', 'owner', 'Owner', '${NOW}');
    insert or ignore into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
      values ('person_existing_owner', 'org_samyak', 'branch_sion', 'Existing Owner', 'Existing Owner', 'active', '${NOW}', '${NOW}');
    insert or ignore into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
      values ('acct_existing_owner', 'org_samyak', 'mobile_hash_existing', 'mobile_hash_existing', '3210', 1, 'active', '${NOW}', '${NOW}');
    insert or ignore into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
      values ('gident_existing_owner', 'mobile_hash_existing', 'mobile_hash_existing', '3210', 'active', '${NOW}', '${NOW}');
    insert or ignore into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at)
      values ('omem_existing_owner', 'gident_existing_owner', 'org_samyak', 'acct_existing_owner', 'active', '${NOW}', '${NOW}');
    update login_accounts set global_identity_id = 'gident_existing_owner', organisation_membership_id = 'omem_existing_owner' where id = 'acct_existing_owner';
    insert or ignore into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
      values ('acct_existing_owner', 'person_existing_owner', 'staff', 1, 1, '${NOW}');
    insert or ignore into login_account_roles (login_account_id, role_id, branch_id, created_at)
      values ('acct_existing_owner', 'role_owner_existing', null, '${NOW}');
    insert or ignore into user_sessions (id, login_account_id, organisation_membership_id, active_person_id, token_hash, created_at, expires_at, last_seen_at)
      values ('sess_existing_owner', 'acct_existing_owner', 'omem_existing_owner', 'person_existing_owner', 'session_hash_existing', '${NOW}', '2099-01-01T00:00:00.000Z', '${NOW}');
    insert or ignore into audit_logs (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, created_at)
      values ('audit_existing', 'org_samyak', 'branch_sion', 'acct_existing_owner', 'person_existing_owner', 'existing_action', 'person', 'person_existing_owner', '${NOW}');
  `);
}

function sessionCookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Row | undefined;
}

function rows(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).all(...values) as Row[];
}

function count(db: DatabaseSync, tableOrSql: string) {
  return Number(row(db, `select count(*) as count from ${tableOrSql}`)?.count || 0);
}

function columns(db: DatabaseSync, table: string) {
  return rows(db, `pragma table_info(${table})`).map((item) => String(item.name));
}

function tableNames(db: DatabaseSync) {
  return rows(db, "select name from sqlite_master where type = 'table'").map((item) => String(item.name));
}

function indexNames(db: DatabaseSync) {
  return rows(db, "select name from sqlite_master where type = 'index'").map((item) => String(item.name));
}

class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql, []);
  }

  async batch(statements: SqliteD1Statement[]) {
    const results = [];
    this.db.exec("begin");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return results;
  }
}

class SqliteD1Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly params: SQLInputValue[]) {}

  bind(...params: SQLInputValue[]) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) } as T;
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), rows_written: Number(result.changes) } };
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
