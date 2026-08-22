/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { lookupPortalProfilesByMobile, mobileHash, ORG_ID } from "./auth-store";
import { changeStudentPrimaryMobile, getStudentContactVersion } from "./owner-student-maintenance";
import { hmacHex } from "./crypto";

const NOW = "2026-08-22T00:00:00.000Z";
type SqlValue = string | number | bigint | Uint8Array | null;

describe("owner student maintenance", () => {
  it("changes a student primary mobile without changing identity or history tables", async () => {
    const fixture = await createFixture();
    const before = counts(fixture.db);
    const result = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "91234 56780",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
      reason: "Student changed number",
    });

    expect(result).toMatchObject({ ok: true, studentId: "student_a", studentNumber: "SYK-SION-0001", personId: "person_a" });
    expect(row(fixture.db, "select person_id, student_number from students where id = 'student_a'")).toMatchObject({ person_id: "person_a", student_number: "SYK-SION-0001" });
    expect(counts(fixture.db)).toMatchObject({
      students: before.students,
      enrolments: before.enrolments,
      enquiries: before.enquiries,
      referrerProfiles: before.referrerProfiles,
      certificates: before.certificates,
      receipts: before.receipts,
    });

    const oldHash = await testMobileHash("9876543210");
    const newHash = await testMobileHash("9123456780");
    expect(row(fixture.db, "select is_primary from person_contacts where person_id = 'person_a' and normalized_value = ?", oldHash)).toMatchObject({ is_primary: 0 });
    expect(row(fixture.db, "select status from person_contact_details where contact_id = 'contact_old_a'")).toMatchObject({ status: "previous" });
    expect(row(fixture.db, "select is_primary, last_four from person_contacts where person_id = 'person_a' and normalized_value = ?", newHash)).toMatchObject({ is_primary: 1, last_four: "6780" });

    expect((await lookupPortalProfilesByMobile(fixture.c, "9123456780")).profiles.map((profile) => profile.personId)).toContain("person_a");
    expect((await lookupPortalProfilesByMobile(fixture.c, "9876543210")).profiles.map((profile) => profile.personId)).not.toContain("person_a");
    expect(JSON.stringify(all(fixture.db, "select metadata_json from audit_logs"))).not.toContain("9123456780");
    expect(JSON.stringify(all(fixture.db, "select metadata_json from audit_logs"))).not.toContain(newHash);
  });

  it("requires explicit confirmation before sharing another active person's mobile", async () => {
    const fixture = await createFixture({ withSharedTarget: true });
    const rejected = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9234567890",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(rejected).toMatchObject({ ok: false, status: 409, code: "shared_mobile_confirmation_required" });

    const accepted = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9234567890",
      confirmSharedMobile: true,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(accepted).toMatchObject({ ok: true });
    const sharedHash = await testMobileHash("9234567890");
    expect(all(fixture.db, "select person_id from person_contacts where normalized_value = ? order by person_id", sharedHash).map((item) => item.person_id)).toEqual(["person_a", "person_b"]);
    expect(row(fixture.db, "select status from person_contact_details where contact_id = 'contact_shared_b'")).toMatchObject({ status: "active" });
  });

  it("does not duplicate when submitting the same mobile or reactivating a previous mobile", async () => {
    const fixture = await createFixture();
    const same = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9876543210",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(same).toMatchObject({ ok: true, idempotent: true });
    expect(row(fixture.db, "select count(*) as count from person_contacts where person_id = 'person_a'")?.count).toBe(1);

    await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", { newMobile: "9123456780", confirmSharedMobile: false, expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a") });
    await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", { newMobile: "9876543210", confirmSharedMobile: false, expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a") });
    expect(row(fixture.db, "select count(*) as count from person_contacts where person_id = 'person_a'")?.count).toBe(2);
    expect(row(fixture.db, "select status from person_contact_details where contact_id = 'contact_old_a'")).toMatchObject({ status: "active" });
  });

  it("denies counsellor maintenance", async () => {
    const fixture = await createFixture();
    const result = await changeStudentPrimaryMobile(fixture.c, { loginAccountId: "acct_counsellor", activePersonId: null, roles: ["counsellor"] }, "student_a", {
      newMobile: "9123456780",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects stale contact versions without mutating the current contact", async () => {
    const fixture = await createFixture();
    const staleVersion = await getStudentContactVersion(fixture.c, "person_a");
    await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9123456780",
      confirmSharedMobile: false,
      expectedContactVersion: staleVersion,
    });
    const stale = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9345678901",
      confirmSharedMobile: false,
      expectedContactVersion: staleVersion,
    });
    expect(stale).toMatchObject({ ok: false, status: 409, code: "stale_contact" });
    expect(row(fixture.db, "select count(*) as count from person_contacts where person_id = 'person_a' and is_primary = 1")?.count).toBe(1);
    expect(row(fixture.db, "select last_four from person_contacts where person_id = 'person_a' and is_primary = 1")).toMatchObject({ last_four: "6780" });
  });

  it("scopes old shared login account and sessions to the changed person only", async () => {
    const fixture = await createFixture({ withSharedOldMobile: true });
    seedLoginAccountForMobile(fixture.db, await testMobileHash("9876543210"), [
      { personId: "person_a", sessionId: "sess_a" },
      { personId: "person_b", sessionId: "sess_b" },
    ]);

    const result = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9123456780",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });

    expect(result).toMatchObject({ ok: true });
    expect(row(fixture.db, "select is_available from login_account_people where login_account_id = 'acct_9876543210' and person_id = 'person_a'")).toMatchObject({ is_available: 0 });
    expect(row(fixture.db, "select is_available from login_account_people where login_account_id = 'acct_9876543210' and person_id = 'person_b'")).toMatchObject({ is_available: 1 });
    expect(row(fixture.db, "select active_person_id from user_sessions where id = 'sess_a'")).toMatchObject({ active_person_id: null });
    expect(row(fixture.db, "select active_person_id from user_sessions where id = 'sess_b'")).toMatchObject({ active_person_id: "person_b" });
    expect((await lookupPortalProfilesByMobile(fixture.c, "9876543210")).profiles.map((profile) => profile.personId)).toEqual(["person_b"]);
  });
});

async function createFixture(options: { withSharedTarget?: boolean; withSharedOldMobile?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  installSchema(db);
  seedBase(db);
  await seedStudent(db, "person_a", "student_a", "SYK-SION-0001", "contact_old_a", "9876543210");
  if (options.withSharedTarget) await seedStudent(db, "person_b", "student_b", "SYK-SION-0002", "contact_shared_b", "9234567890");
  if (options.withSharedOldMobile) await seedStudent(db, "person_b", "student_b", "SYK-SION-0002", "contact_old_b", "9876543210");
  const c = { env: { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" }, req: { header: () => null } };
  return { db, c: c as never };
}

function seedLoginAccountForMobile(db: DatabaseSync, mobileHashValue: string, links: Array<{ personId: string; sessionId: string }>) {
  db.prepare("insert into login_accounts values ('acct_9876543210', ?, ?, ?, '3210', 1, 'active', null, ?, ?)")
    .run(ORG_ID, mobileHashValue, mobileHashValue, NOW, NOW);
  for (const link of links) {
    db.prepare("insert into login_account_people values ('acct_9876543210', ?, 'self', 0, 1, ?)")
      .run(link.personId, NOW);
    db.prepare("insert into user_sessions values (?, 'acct_9876543210', ?, ?, ?, '2026-09-22T00:00:00.000Z', ?, null)")
      .run(link.sessionId, link.personId, `hash_${link.sessionId}`, NOW, NOW);
  }
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table organisations (id text primary key, name text, slug text, status text, created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, display_value text, last_four text, is_primary integer, is_verified integer, verified_at text, created_at text, updated_at text, unique(person_id, contact_type, normalized_value));
    create table person_contact_details (contact_id text primary key, belongs_to text, contact_label text, is_whatsapp integer, valid_from text, valid_until text, status text, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_hash text, mobile_last_four text, login_enabled integer, status text, last_login_at text, created_at text, updated_at text, unique(organisation_id, mobile_normalized));
    create table login_account_people (login_account_id text, person_id text, access_type text, is_default integer, is_available integer, created_at text, primary key(login_account_id, person_id));
    create table user_sessions (id text primary key, login_account_id text, active_person_id text, token_hash text, created_at text, expires_at text, last_seen_at text, revoked_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, created_at text);
    create table referral_programmes (id text primary key, organisation_id text, code text, status text);
    create table referral_programme_referrer_types (referral_programme_id text, referrer_type text);
    create table referrer_profiles (id text primary key, organisation_id text, person_id text, external_referrer_id text, referral_token text, personal_link text, active integer, created_at text, updated_at text);
    create table courses (id text primary key, code text, name text, duration_label text);
    create table enrolments (id text primary key, student_id text, course_id text, enrolment_number text, admission_date text, joining_date text, actual_completion_date text, status text, created_at text);
    create table enquiries (id text primary key, person_id text);
    create table certificate_issues (id text primary key, person_id text);
    create table receipts (id text primary key, person_id text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, metadata_json text, created_at text);
  `);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations values (?, 'Samyak', 'samyak', 'active', ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into branches values ('branch_sion', ?, 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into roles values ('role_owner', ?, 'owner', 'Owner', ?), ('role_student', ?, 'student', 'Student', ?), ('role_counsellor', ?, 'counsellor', 'Counsellor', ?)").run(ORG_ID, NOW, ORG_ID, NOW, ORG_ID, NOW);
  db.prepare("insert into login_accounts values ('acct_owner', ?, 'owner', 'owner', '0000', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_counsellor', ?, 'counsellor', 'counsellor', '0001', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_account_roles values ('acct_owner', 'role_owner', null, ?), ('acct_counsellor', 'role_counsellor', null, ?)").run(NOW, NOW);
  db.prepare("insert into referral_programmes values ('prog_skill_circle', ?, 'samyak_skill_circle', 'active')").run(ORG_ID);
  db.prepare("insert into referral_programme_referrer_types values ('prog_skill_circle', 'student')").run();
  db.prepare("insert into courses values ('course_a', 'AEX', 'Advanced Excel', '3 months')").run();
}

async function seedStudent(db: DatabaseSync, personId: string, studentId: string, studentNumber: string, contactId: string, mobile: string) {
  const hash = await testMobileHash(mobile);
  db.prepare("insert into people values (?, ?, 'branch_sion', ?, ?, null, 'active', ?, ?)").run(personId, ORG_ID, `${personId} Name`, `${personId} Name`, NOW, NOW);
  db.prepare("insert into person_identity_details values (?, ?, '2000-01-01', ?, ?)").run(personId, `${personId} Official`, NOW, NOW);
  db.prepare("insert into students values (?, ?, ?, 'branch_sion', ?, 1, '2024-01-01', 'active', 'active', ?, ?)").run(studentId, ORG_ID, personId, studentNumber, NOW, NOW);
  db.prepare("insert into person_contacts values (?, ?, 'mobile', ?, null, ?, 1, 1, null, ?, ?)").run(contactId, personId, hash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into person_contact_details values (?, 'student', null, 1, null, null, 'active', ?, ?)").run(contactId, NOW, NOW);
  db.prepare("insert into person_roles values (?, 'role_student', null, '', ?)").run(personId, NOW);
  db.prepare("insert into referrer_profiles values (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(`ref_${personId}`, ORG_ID, personId, `ext_${personId}`, `token_${personId}`, `link_${personId}`, NOW, NOW);
  db.prepare("insert into enrolments values (?, ?, 'course_a', ?, '2024-01-01', '2024-01-02', null, 'active', ?)").run(`enrol_${personId}`, studentId, `ENR-${studentNumber}`, NOW);
  db.prepare("insert into enquiries values (?, ?)").run(`enq_${personId}`, personId);
  db.prepare("insert into certificate_issues values (?, ?)").run(`cert_${personId}`, personId);
  db.prepare("insert into receipts values (?, ?)").run(`receipt_${personId}`, personId);
}

function ownerStaff() {
  return { loginAccountId: "acct_owner", activePersonId: null, roles: ["owner"] };
}

async function testMobileHash(mobile: string) {
  return hmacHex("test-pepper", "mobile", mobile);
}

function counts(db: DatabaseSync) {
  return {
    students: row(db, "select count(*) as count from students")?.count,
    enrolments: row(db, "select count(*) as count from enrolments")?.count,
    enquiries: row(db, "select count(*) as count from enquiries")?.count,
    referrerProfiles: row(db, "select count(*) as count from referrer_profiles")?.count,
    certificates: row(db, "select count(*) as count from certificate_issues")?.count,
    receipts: row(db, "select count(*) as count from receipts")?.count,
  };
}

function row(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).get(...values) as Record<string, any> | undefined;
}

function all(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).all(...values) as Array<Record<string, any>>;
}

class D1Adapter {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new D1Statement(this.db, sql);
  }
  async batch(statements: D1Statement[]) {
    this.db.exec("begin");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("commit");
      return results;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

class D1Statement {
  private values: SqlValue[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) ?? null) as T | null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) } as T;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}
