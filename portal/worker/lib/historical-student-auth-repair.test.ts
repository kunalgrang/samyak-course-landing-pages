/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AppContext } from "./http";
import type { WorkerBindings } from "../bindings";
import { hmacHex } from "./crypto";
import { repairHistoricalStudentAuthCandidate } from "./historical-student-auth-repair";

const ORG_ID = "org_samyak";
const NOW = "2026-10-06T12:00:00.000Z";
const PEPPER = "test-pepper";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: SqliteD1,
    private readonly sql: string,
  ) {}

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
  beforeBatch?: () => void | Promise<void>;

  prepare(sql: string) {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements: SqliteD1Statement[]) {
    if (this.beforeBatch) {
      const hook = this.beforeBatch;
      this.beforeBatch = undefined;
      await hook();
    }
    this.database.exec("begin immediate");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("commit");
      return results;
    } catch (error) {
      this.database.exec("rollback");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

describe("historical student auth repair", () => {
  it("establishes all auth elements when completely missing", async () => {
    const fixture = await fixtureDb("9876543210");

    const result = await repair(fixture, "student_subject");

    expect(result).toMatchObject({ result: "repaired", elementsCreated: expect.arrayContaining(["global_identity", "login_account", "organisation_membership", "self_link", "student_role"]) });
    expect(requiredState(fixture.db, "person_subject", await mobileKey("9876543210"))).toMatchObject({ identities: 1, accounts: 1, memberships: 1, selfLinks: 1, activeStudentRoles: 1 });
    fixture.db.close();
  });

  it("fills auth when an active student role already exists and preserves the role", async () => {
    const fixture = await fixtureDb("9876543211");
    seedStudentRole(fixture.db, "person_subject");

    const result = await repair(fixture, "student_subject");

    expect(result.elementsCreated).toEqual(expect.arrayContaining(["global_identity", "login_account", "organisation_membership", "self_link"]));
    expect(result.elementsCreated).not.toContain("student_role");
    expect(count(fixture.db, "person_roles where person_id = 'person_subject'")).toBe(1);
    fixture.db.close();
  });

  it("adds only the missing student role when auth is otherwise complete", async () => {
    const fixture = await fixtureDb("9876543212");
    await seedCompleteAuth(fixture.db, "9876543212", { role: false });

    const beforeAccounts = count(fixture.db, "login_accounts");
    const result = await repair(fixture, "student_subject");

    expect(result.elementsCreated).toEqual(["student_role"]);
    expect(count(fixture.db, "login_accounts")).toBe(beforeAccounts);
    expect(requiredState(fixture.db, "person_subject", await mobileKey("9876543212")).activeStudentRoles).toBe(1);
    fixture.db.close();
  });

  it("is a strict no-op when all required elements already exist", async () => {
    const fixture = await fixtureDb("9876543213");
    await seedCompleteAuth(fixture.db, "9876543213");
    const before = tableCounts(fixture.db);

    const result = await repair(fixture, "student_subject");

    expect(result.result).toBe("no_op");
    expect(result.elementsCreated).toEqual([]);
    expect(tableCounts(fixture.db)).toEqual(before);
    fixture.db.close();
  });

  it("rejects a different-Person identity collision without writes", async () => {
    const fixture = await fixtureDb("9876543214");
    await seedCompleteAuth(fixture.db, "9876543214", { personId: "person_other", studentId: "student_other" });
    const before = tableCounts(fixture.db);

    const result = await repair(fixture, "student_subject");

    expect(result).toMatchObject({ result: "blocked", reason: "different_linked_person" });
    expect(tableCounts(fixture.db)).toEqual(before);
    fixture.db.close();
  });

  it("rejects a non-self link conflict without privilege conversion", async () => {
    const fixture = await fixtureDb("9876543215");
    await seedAccountShell(fixture.db, "9876543215");
    fixture.db.database.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('acct_existing', 'person_subject', 'guardian', 1, 1, ?)").run(NOW);
    const before = tableCounts(fixture.db);

    const result = await repair(fixture, "student_subject");

    expect(result).toMatchObject({ result: "blocked", reason: "non_self_account_person_link" });
    expect(row(fixture.db, "select access_type from login_account_people where login_account_id = 'acct_existing' and person_id = 'person_subject'")).toMatchObject({ access_type: "guardian" });
    expect(tableCounts(fixture.db)).toEqual(before);
    fixture.db.close();
  });

  it("preserves suspended and revoked memberships", async () => {
    const suspended = await fixtureDb("9876543216");
    await seedCompleteAuth(suspended.db, "9876543216", { membershipStatus: "suspended" });
    const beforeSuspended = tableCounts(suspended.db);
    expect(await repair(suspended, "student_subject")).toMatchObject({ result: "blocked", reason: "membership_suspended" });
    expect(row(suspended.db, "select status from organisation_memberships")).toMatchObject({ status: "suspended" });
    expect(tableCounts(suspended.db)).toEqual(beforeSuspended);
    suspended.db.close();

    const revoked = await fixtureDb("9876543217");
    await seedCompleteAuth(revoked.db, "9876543217", { membershipStatus: "revoked" });
    const beforeRevoked = tableCounts(revoked.db);
    expect(await repair(revoked, "student_subject")).toMatchObject({ result: "blocked", reason: "membership_revoked" });
    expect(row(revoked.db, "select status from organisation_memberships")).toMatchObject({ status: "revoked" });
    expect(tableCounts(revoked.db)).toEqual(beforeRevoked);
    revoked.db.close();
  });

  it("preserves disabled identity/account and login-disabled account states", async () => {
    const disabledIdentity = await fixtureDb("9876543218");
    await seedCompleteAuth(disabledIdentity.db, "9876543218", { identityStatus: "disabled" });
    const beforeDisabledIdentity = tableCounts(disabledIdentity.db);
    expect(await repair(disabledIdentity, "student_subject")).toMatchObject({ result: "blocked", reason: "global_identity_not_active" });
    expect(tableCounts(disabledIdentity.db)).toEqual(beforeDisabledIdentity);
    disabledIdentity.db.close();

    const disabledAccount = await fixtureDb("9876543219");
    await seedCompleteAuth(disabledAccount.db, "9876543219", { accountStatus: "disabled" });
    const beforeDisabledAccount = tableCounts(disabledAccount.db);
    expect(await repair(disabledAccount, "student_subject")).toMatchObject({ result: "blocked", reason: "login_account_disabled" });
    expect(tableCounts(disabledAccount.db)).toEqual(beforeDisabledAccount);
    disabledAccount.db.close();

    const loginDisabled = await fixtureDb("9876543220");
    await seedCompleteAuth(loginDisabled.db, "9876543220", { loginEnabled: 0 });
    const beforeLoginDisabled = tableCounts(loginDisabled.db);
    expect(await repair(loginDisabled, "student_subject")).toMatchObject({ result: "blocked", reason: "login_disabled" });
    expect(tableCounts(loginDisabled.db)).toEqual(beforeLoginDisabled);
    loginDisabled.db.close();
  });

  it("is idempotent on rerun and does not duplicate roles", async () => {
    const fixture = await fixtureDb("9876543221");

    expect((await repair(fixture, "student_subject")).result).toBe("repaired");
    const afterFirst = tableCounts(fixture.db);
    expect((await repair(fixture, "student_subject")).result).toBe("no_op");

    expect(tableCounts(fixture.db)).toEqual(afterFirst);
    expect(count(fixture.db, "person_roles where person_id = 'person_subject'")).toBe(1);
    fixture.db.close();
  });

  it("safely reuses an existing identity/account attributable to the same Person", async () => {
    const fixture = await fixtureDb("9876543222");
    await seedAccountShell(fixture.db, "9876543222", { membership: false });
    fixture.db.database.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('acct_existing', 'person_subject', 'self', 1, 1, ?)").run(NOW);

    const result = await repair(fixture, "student_subject");

    expect(result.elementsReused).toEqual(expect.arrayContaining(["global_identity", "login_account", "self_link"]));
    expect(result.elementsCreated).toEqual(expect.arrayContaining(["organisation_membership", "student_role"]));
    expect(count(fixture.db, "login_accounts")).toBe(1);
    fixture.db.close();
  });

  it("rolls back when a wrong-person link appears between preflight and write", async () => {
    const fixture = await fixtureDb("9876543224");
    await seedAccountShell(fixture.db, "9876543224", { membership: false });
    const before = tableCounts(fixture.db);
    fixture.db.beforeBatch = () => {
      seedPerson(fixture.db, "person_race");
      fixture.db.database
        .prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('acct_existing', 'person_race', 'self', 1, 1, ?)")
        .run(NOW);
    };

    const result = await repair(fixture, "student_subject");

    expect(result).toMatchObject({ result: "blocked", reason: "different_linked_person", elementsCreated: [] });
    expect(count(fixture.db, "login_account_people where login_account_id = 'acct_existing' and person_id = 'person_race' and is_available = 1")).toBe(1);
    expect(count(fixture.db, "organisation_memberships where login_account_id = 'acct_existing'")).toBe(0);
    expect(count(fixture.db, "login_account_people where login_account_id = 'acct_existing' and person_id = 'person_subject'")).toBe(0);
    expect(count(fixture.db, "person_roles where person_id = 'person_subject'")).toBe(0);
    expect(tableCounts(fixture.db)).toEqual({ ...before, links: before.links + 1 });
    fixture.db.close();
  });

  it("treats same-person concurrent completion as a safe no-op", async () => {
    const fixture = await fixtureDb("9876543225");
    fixture.db.beforeBatch = async () => {
      await seedCompleteAuth(fixture.db, "9876543225");
    };

    const result = await repair(fixture, "student_subject");

    expect(result).toMatchObject({ result: "no_op", reason: "concurrent_repair_completed", elementsCreated: [] });
    expect(requiredState(fixture.db, "person_subject", await mobileKey("9876543225"))).toMatchObject({ identities: 1, accounts: 1, memberships: 1, selfLinks: 1, activeStudentRoles: 1 });
    fixture.db.close();
  });

  it("fails closed on inconsistent account/membership linkage", async () => {
    const fixture = await fixtureDb("9876543223");
    await seedCompleteAuth(fixture.db, "9876543223");
    await seedOtherMembership(fixture.db);
    fixture.db.database.prepare("update login_accounts set organisation_membership_id = 'omem_other' where id = 'acct_existing'").run();
    const before = tableCounts(fixture.db);

    const result = await repair(fixture, "student_subject");

    expect(result).toMatchObject({ result: "blocked", reason: "account_membership_mismatch" });
    expect(tableCounts(fixture.db)).toEqual(before);
    fixture.db.close();
  });
});

async function repair(fixture: { db: SqliteD1; c: AppContext }, studentId: string) {
  return repairHistoricalStudentAuthCandidate(fixture.c, { organisationId: ORG_ID, studentId, now: NOW });
}

async function fixtureDb(mobile: string) {
  const db = new SqliteD1();
  applyMigrations(db);
  seedBase(db);
  await seedStudent(db, { personId: "person_subject", studentId: "student_subject", mobile });
  return { db, c: context(db) };
}

function context(db: SqliteD1): AppContext {
  return {
    env: {
      DB: db as unknown as D1Database,
      ENVIRONMENT: "development",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      SESSION_PEPPER: PEPPER,
      DEV_OTP: "123456",
    } satisfies WorkerBindings,
  } as AppContext;
}

function applyMigrations(db: SqliteD1) {
  const migrationsDir = join(process.cwd(), "migrations");
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      db.database.exec(statement);
    }
  }
}

function seedBase(db: SqliteD1) {
  db.database.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at)
    values ('org_samyak', 'Samyak', 'samyak', 'active', '${NOW}', '${NOW}');
    insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
    values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}');
    insert into roles (id, organisation_id, code, name, created_at)
    values ('role_student', 'org_samyak', 'student', 'Student', '${NOW}');
  `);
}

function seedPerson(db: SqliteD1, personId: string) {
  db.database.prepare(
    `insert into people (id, organisation_id, home_branch_id, full_name, public_name, date_of_birth, status, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, ?, null, 'active', ?, ?)`,
  ).run(personId, personId, personId, NOW, NOW);
}

async function seedStudent(db: SqliteD1, input: { personId: string; studentId: string; mobile: string }) {
  const key = await mobileKey(input.mobile);
  db.database.prepare(
    `insert into people (id, organisation_id, home_branch_id, full_name, public_name, date_of_birth, status, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, ?, null, 'active', ?, ?)`,
  ).run(input.personId, input.personId, input.personId, NOW, NOW);
  db.database.prepare(
    `insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
     values (?, 'org_samyak', ?, 'branch_sion', ?, abs(random() % 1000000), '2026-09-01', 'active', 'active', ?, ?)`,
  ).run(input.studentId, input.personId, `SYK-${input.studentId}`, NOW, NOW);
  db.database.prepare(
    `insert into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, verified_at, created_at, updated_at)
     values (?, ?, 'mobile', ?, null, ?, 1, 1, ?, ?, ?)`,
  ).run(`contact_${input.studentId}`, input.personId, key, input.mobile.slice(-4), NOW, NOW, NOW);
  db.database.prepare(
    `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
     values (?, 'student', 1, 'active', ?, ?)`,
  ).run(`contact_${input.studentId}`, NOW, NOW);
}

async function seedCompleteAuth(
  db: SqliteD1,
  mobile: string,
  options: {
    personId?: string;
    studentId?: string;
    role?: boolean;
    identityStatus?: string;
    accountStatus?: string;
    loginEnabled?: number;
    membershipStatus?: string;
  } = {},
) {
  const personId = options.personId || "person_subject";
  if (options.personId && options.studentId) {
    await seedStudent(db, { personId: options.personId, studentId: options.studentId, mobile });
  }
  await seedAccountShell(db, mobile, options);
  db.database.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('acct_existing', ?, 'self', 1, 1, ?)").run(personId, NOW);
  if (options.role !== false) seedStudentRole(db, personId);
}

async function seedAccountShell(
  db: SqliteD1,
  mobile: string,
  options: {
    identityStatus?: string;
    accountStatus?: string;
    loginEnabled?: number;
    membershipStatus?: string;
    membership?: boolean;
  } = {},
) {
  const key = await mobileKey(mobile);
  db.database.prepare(
    `insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
     values ('gident_existing', ?, ?, ?, ?, ?, ?)`,
  ).run(key, key, mobile.slice(-4), options.identityStatus || "active", NOW, NOW);
  db.database.prepare(
    `insert into login_accounts (id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, last_login_at, created_at, updated_at)
     values ('acct_existing', 'org_samyak', 'gident_existing', null, ?, ?, ?, ?, ?, null, ?, ?)`,
  ).run(key, key, mobile.slice(-4), options.loginEnabled ?? 1, options.accountStatus || "active", NOW, NOW);
  if (options.membership !== false) {
    db.database.prepare(
      `insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at)
       values ('omem_existing', 'gident_existing', 'org_samyak', 'acct_existing', ?, ?, ?)`,
    ).run(options.membershipStatus || "active", NOW, NOW);
    db.database.prepare("update login_accounts set organisation_membership_id = 'omem_existing' where id = 'acct_existing'").run();
  }
}

function seedOtherMembership(db: SqliteD1) {
  db.database.exec(`
    insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
    values ('gident_other', 'other_mobile_key', 'other_mobile_key', '0000', 'active', '${NOW}', '${NOW}');
    insert into login_accounts (id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, last_login_at, created_at, updated_at)
    values ('acct_other', 'org_samyak', 'gident_other', null, 'other_mobile_key', 'other_mobile_key', '0000', 1, 'active', null, '${NOW}', '${NOW}');
    insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at)
    values ('omem_other', 'gident_other', 'org_samyak', 'acct_other', 'active', '${NOW}', '${NOW}');
    update login_accounts set organisation_membership_id = 'omem_other' where id = 'acct_other';
  `);
}

function seedStudentRole(db: SqliteD1, personId: string, status = "active") {
  db.database.prepare(
    `insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at)
     values (?, 'role_student', null, '', ?, ?)`,
  ).run(personId, status, NOW);
}

async function mobileKey(mobile: string) {
  return hmacHex(PEPPER, "mobile", mobile);
}

function requiredState(db: SqliteD1, personId: string, key: string) {
  return {
    identities: count(db, "global_identities where mobile_normalized = ?", key),
    accounts: count(db, "login_accounts where mobile_normalized = ?", key),
    memberships: count(db, "organisation_memberships join global_identities on global_identities.id = organisation_memberships.global_identity_id where global_identities.mobile_normalized = ?", key),
    selfLinks: count(db, "login_account_people where person_id = ? and access_type = 'self' and is_available = 1", personId),
    activeStudentRoles: count(db, "person_roles where person_id = ? and role_id = 'role_student' and status = 'active'", personId),
  };
}

function tableCounts(db: SqliteD1) {
  return {
    globalIdentities: count(db, "global_identities"),
    loginAccounts: count(db, "login_accounts"),
    memberships: count(db, "organisation_memberships"),
    links: count(db, "login_account_people"),
    roles: count(db, "person_roles"),
  };
}

function row(db: SqliteD1, sql: string, ...values: unknown[]) {
  return db.database.prepare(sql).get(...(values as any[])) as Record<string, unknown> | undefined;
}

function count(db: SqliteD1, tableOrSql: string, ...values: unknown[]) {
  const source = tableOrSql.trim().toLowerCase().startsWith("select") ? `(${tableOrSql})` : tableOrSql;
  return Number(row(db, `select count(*) as count from ${source}`, ...values)?.count || 0);
}
