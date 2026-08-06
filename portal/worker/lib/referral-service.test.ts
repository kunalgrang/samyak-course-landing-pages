/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";
import { issueReferralLink, listEligibleReferralCourses, normalizeSubmittedReferralName, resolveReferralLink, submitReferralAndCreateEnquiry, type ReferralServiceEnv } from "./referral-service";
import { hashReferralToken } from "./referral-token";
import type { ReferralDb } from "./referral-repository";

const NOW = "2026-08-06T10:00:00.000Z";
const SESSION_PEPPER = "session-pepper-for-referral-tests";
const REFERRAL_TOKEN_PEPPER = "referral-token-pepper-for-tests";
type SqlValue = string | number | bigint | null | Uint8Array;

describe("native referral services", () => {
  it("issues a strong one-time referral token and stores only hash plus last four", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);

    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: NOW,
    });
    const duplicate = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: NOW,
    });

    expect(issued.issued).toBe(true);
    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(duplicate).toMatchObject({ issued: false, rawToken: null, link: { id: issued.link.id } });
    expect(count(fixture.sqlite, "referral_links")).toBe(1);
    const stored = row(fixture.sqlite, "select token_hash, token_last_four from referral_links");
    expect(stored?.token_hash).toBe(await hashReferralToken(issued.rawToken!, REFERRAL_TOKEN_PEPPER));
    expect(stored?.token_hash).not.toContain(issued.rawToken);
    expect(stored?.token_last_four).toBe(issued.rawToken!.slice(-4));
    expect(JSON.stringify(all(fixture.sqlite, "select * from referral_links"))).not.toContain(issued.rawToken);
    expect(JSON.stringify(all(fixture.sqlite, "select * from audit_logs"))).not.toContain(issued.rawToken);
    fixture.close();
  });

  it("rejects ineligible, cross-organisation, and shared-family referrer issuance", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedReferrer(fixture.sqlite, { suffix: "family", loginAccessType: "shared_family" });
    seedReferrer(fixture.sqlite, { suffix: "other", organisationId: "org_other" });
    fixture.sqlite.prepare("delete from person_roles where person_id = 'person_family'").run();

    await expect(issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_family",
      loginAccountId: "acct_family",
      personId: "person_family",
      now: NOW,
    })).rejects.toMatchObject({ code: "invalid_referrer" });
    await expect(issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_other",
      now: NOW,
    })).rejects.toMatchObject({ code: "invalid_referrer" });
    fixture.close();
  });

  it("resolves only valid active links with generic public invalid results and explicit course configuration", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      now: NOW,
    });

    expect(await listEligibleReferralCourses(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", now: NOW })).toEqual([]);
    addProgrammeCourse(fixture.sqlite, "course_fsd");
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken!, now: NOW })).toMatchObject({
      valid: true,
      programme: { publicName: "Samyak Skill Circle" },
      referrer: { publicDisplayName: "Student Referrer" },
      courses: [{ id: "course_fsd", code: "FSD", name: "Full Stack", duration_label: "6 months" }],
    });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: "bad", now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_other", rawToken: issued.rawToken!, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });

    fixture.sqlite.prepare("update referral_links set status = 'revoked', revoked_at = ? where id = ?").run(NOW, issued.link.id);
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken!, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    fixture.close();
  });

  it("creates a referral, enquiry, initial event, immutable attribution, and safe audit metadata atomically", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);

    const result = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "submit-1" }));

    expect(result).toMatchObject({ ok: true, idempotent: false });
    if (!result.ok) throw new Error("submission failed");
    const referral = row(fixture.sqlite, "select * from referrals where id = ?", result.referralId);
    const enquiry = row(fixture.sqlite, "select * from enquiries where id = ?", result.enquiryId);
    expect(referral).toMatchObject({
      organisation_id: "org_samyak",
      branch_id: "branch_sion",
      referral_programme_id: "rprog_samyak_skill_circle",
      referral_link_id: expect.any(String),
      referrer_profile_id: "refprof_student",
      enquiry_id: result.enquiryId,
      course_interest_id: "course_fsd",
      source: "personal_link",
      status: "accepted",
      valid_until: "2026-11-04T10:00:00.000Z",
      attributed_at: NOW,
      prospect_name: "Future Learner",
      prospect_person_id: null,
      prospect_mobile_last_four: "3210",
    });
    expect(enquiry).toMatchObject({
      source: "referral",
      mobile_used: await mobileLookupHash("9876543210"),
      course_interest_id: "course_fsd",
    });
    expect(String(enquiry?.source_detail)).toContain(`samyak_skill_circle:${result.referralId}`);
    expect(columns(fixture.sqlite, "enquiries")).not.toContain("prospect_name");
    expect(count(fixture.sqlite, "people")).toBe(1);
    expect(count(fixture.sqlite, "referral_status_events where referral_id = '" + result.referralId + "' and to_status = 'accepted'")).toBe(1);
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from audit_logs"))).not.toContain("9876543210");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from audit_logs"))).not.toContain("Future Learner");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from referral_status_events"))).not.toContain("learner@example.com");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from referral_status_events"))).not.toContain("Future Learner");
    fixture.close();
  });

  it("keeps idempotent retries stable and rejects the same key with a different payload", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);

    const first = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1" }));
    const retry = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1" }));
    const whitespaceRetry = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1", prospectName: "  Future   Learner  " }));
    const nameConflict = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1", prospectName: "Changed Learner" }));
    const courseConflict = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1", courseId: "course_data" }));

    expect(first.ok && retry.ok && retry.referralId === first.referralId && retry.enquiryId === first.enquiryId && retry.idempotent).toBe(true);
    expect(first.ok && whitespaceRetry.ok && whitespaceRetry.referralId === first.referralId && whitespaceRetry.enquiryId === first.enquiryId && whitespaceRetry.idempotent).toBe(true);
    expect(nameConflict).toEqual({ ok: false, code: "idempotency_conflict" });
    expect(courseConflict).toEqual({ ok: false, code: "idempotency_conflict" });
    expect(count(fixture.sqlite, "referrals")).toBe(1);
    expect(count(fixture.sqlite, "enquiries")).toBe(1);
    expect(count(fixture.sqlite, "referral_status_events")).toBe(1);
    fixture.close();
  });

  it("normalizes submitted referral names and rejects unsafe values", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);

    expect(normalizeSubmittedReferralName("  Asha   S.   Nair  ")).toBe("Asha S. Nair");
    expect(normalizeSubmittedReferralName("")).toBeNull();
    expect(normalizeSubmittedReferralName("A".repeat(101))).toBeNull();
    expect(normalizeSubmittedReferralName("Asha\u0007Nair")).toBeNull();
    expect(normalizeSubmittedReferralName("आर्या अय्यर")).toBe("आर्या अय्यर");

    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "   " }))).toEqual({ ok: false, code: "invalid_name" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "A".repeat(101) }))).toEqual({ ok: false, code: "invalid_name" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "Asha\u0007Nair" }))).toEqual({ ok: false, code: "invalid_name" });

    const accepted = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "  आर्या   अय्यर  ", prospectMobile: "9876500040" }));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("unicode submission failed");
    expect(row(fixture.sqlite, "select prospect_name, prospect_person_id from referrals where id = ?", accepted.referralId)).toMatchObject({
      prospect_name: "आर्या अय्यर",
      prospect_person_id: null,
    });
    expect(count(fixture.sqlite, "people")).toBe(1);
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from audit_logs"))).not.toContain("आर्या अय्यर");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from referral_status_events"))).not.toContain("आर्या अय्यर");
    fixture.close();
  });

  it("classifies existing enquiries, students, duplicates, consent, mobile, course, and branch rejections", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);
    const existingHash = await mobileLookupHash("9876500000");
    fixture.sqlite.prepare(
      `insert into enquiries (id, organisation_id, branch_id, enquiry_number, mobile_used, course_interest_id, source, status, created_at, updated_at)
       values ('enq_existing', 'org_samyak', 'branch_sion', 'ENQ-EXISTING', ?, 'course_fsd', 'walk_in', 'lost', ?, ?)`,
    ).run(existingHash, NOW, NOW);
    await seedProspectStudent(fixture.sqlite, "current", "9876500001", "active");
    await seedProspectStudent(fixture.sqlite, "former", "9876500002", "alumni");

    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500000" }))).toEqual({ ok: false, code: "existing_enquiry" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500001" }))).toEqual({ ok: false, code: "current_student" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500002" }))).toEqual({ ok: false, code: "former_student" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { consentAccepted: false }))).toEqual({ ok: false, code: "consent_missing" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "12345" }))).toEqual({ ok: false, code: "invalid_mobile" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { courseId: "missing_course" }))).toEqual({ ok: false, code: "ineligible_course" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { branchId: "branch_other" }))).toEqual({ ok: false, code: "invalid_link" });

    const first = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500003" }));
    expect(first.ok).toBe(true);
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500003", idempotencyKey: "new-key" }))).toEqual({ ok: false, code: "active_duplicate" });
    fixture.sqlite.prepare("update referrals set submitted_at = ?, valid_until = ?, active_duplicate_key = null where prospect_mobile_last_four = '0003'")
      .run("2026-07-01T00:00:00.000Z", "2026-08-05T00:00:00.000Z");
    expect((await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500003", idempotencyKey: "after-expiry" }))).ok).toBe(true);
    fixture.close();
  });

  it("enforces service integrity indexes through migrated SQLite", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const first = await issueReferralLink(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", referrerProfileId: "refprof_student", now: NOW });
    expect(first.rawToken).toBeTruthy();
    expect(() =>
      fixture.sqlite.prepare(
        `insert into referral_links
          (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, created_at, updated_at)
         values ('manual_link', 'org_samyak', 'rprog_samyak_skill_circle', 'refprof_student', 'manual_hash', 'hash', 1, 'active', ?, ?, ?)`,
      ).run(NOW, NOW, NOW),
    ).toThrow();
    expect(columns(fixture.sqlite, "referral_links")).not.toEqual(expect.arrayContaining(["token", "raw_token", "personal_link", "public_url"]));
    expect(columns(fixture.sqlite, "referrals")).toContain("prospect_name");
    expect(all(fixture.sqlite, "pragma table_info(referrals)").find((item) => item.name === "prospect_name")).toMatchObject({ notnull: 1 });
    expect(indexes(fixture.sqlite)).toEqual(expect.arrayContaining([
      "referral_links_one_active_referrer_programme_unique",
      "referrals_active_duplicate_unique",
      "referrals_idempotency_payload_idx",
      "enquiries_organisation_mobile_idx",
      "person_contacts_type_value_idx",
    ]));
    fixture.close();
  });
});

function testFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("pragma foreign_keys = on");
  applyMigrations(sqlite);
  const db = new SqliteD1(sqlite) as unknown as ReferralDb;
  const env: ReferralServiceEnv = { DB: db, SESSION_PEPPER, REFERRAL_TOKEN_PEPPER };
  return { sqlite, env, close: () => sqlite.close() };
}

function applyMigrations(db: DatabaseSync) {
  for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (file === "0012_d1_referral_foundation.sql") {
      seedBase(db);
    }
    applyMigrationFile(db, file);
  }
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_other', 'Other', 'other', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_other', 'org_other', 'Other', 'OTHR', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_student', 'org_samyak', 'student', 'Student', ?)").run(NOW);
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_alumni', 'org_samyak', 'alumni', 'Alumni', ?)").run(NOW);
}

function seedReferrer(db: DatabaseSync, options: { suffix?: string; organisationId?: string; loginAccessType?: string; roleId?: string } = {}) {
  const suffix = options.suffix || "student";
  const organisationId = options.organisationId || "org_samyak";
  const branchId = organisationId === "org_samyak" ? "branch_sion" : "branch_other";
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'active', ?, ?)")
    .run(`person_${suffix}`, organisationId, branchId, `${suffix} Referrer`, `${title(suffix)} Referrer`, NOW, NOW);
  db.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(`refprof_${suffix}`, organisationId, `person_${suffix}`, `EXT-${suffix}`, `legacy-${suffix}`, `https://legacy/${suffix}`, NOW, NOW);
  if (organisationId === "org_samyak") {
    db.prepare("insert into person_roles (person_id, role_id, branch_id, branch_key, created_at) values (?, ?, null, '', ?)")
      .run(`person_${suffix}`, options.roleId || "role_student", NOW);
    db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values (?, ?, ?, ?, '0000', 1, 'active', ?, ?)")
      .run(`acct_${suffix}`, organisationId, `acct_hash_${suffix}`, `acct_hash_${suffix}`, NOW, NOW);
    db.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values (?, ?, ?, 1, 1, ?)")
      .run(`acct_${suffix}`, `person_${suffix}`, options.loginAccessType || "self", NOW);
  }
}

function seedCourse(db: DatabaseSync, id: string, code: string, name: string, status: string) {
  db.prepare(
    `insert into courses
      (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
     values (?, 'org_samyak', ?, ?, '6 months', 6, 5000000, 4000000, 1, 1, ?, ?, ?)`,
  ).run(id, code, name, status, NOW, NOW);
}

function addProgrammeCourse(db: DatabaseSync, courseId: string, active = 1) {
  db.prepare("insert into referral_programme_courses (referral_programme_id, course_id, is_active, created_at, updated_at) values ('rprog_samyak_skill_circle', ?, ?, ?, ?)")
    .run(courseId, active, NOW, NOW);
}

async function issuedReadyLink(fixture: ReturnType<typeof testFixture>) {
  seedReferrer(fixture.sqlite);
  seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
  seedCourse(fixture.sqlite, "course_data", "DATA", "Data Analytics", "active");
  addProgrammeCourse(fixture.sqlite, "course_fsd");
  addProgrammeCourse(fixture.sqlite, "course_data");
  const issued = await issueReferralLink(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", referrerProfileId: "refprof_student", now: NOW });
  if (!issued.rawToken) throw new Error("Expected fresh token");
  return issued.rawToken;
}

function validSubmission(rawToken: string, overrides: Partial<Parameters<typeof submitReferralAndCreateEnquiry>[1]> = {}) {
  return {
    organisationId: "org_samyak",
    rawReferralToken: rawToken,
    branchId: "branch_sion",
    prospectName: "Future Learner",
    prospectMobile: "9876543210",
    prospectEmail: "learner@example.com",
    courseId: "course_fsd",
    consentAccepted: true,
    source: "personal_link" as const,
    now: NOW,
    ...overrides,
  };
}

async function seedProspectStudent(db: DatabaseSync, suffix: string, mobile: string, status: string) {
  const mobileHash = await mobileLookupHash(mobile);
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(`person_${suffix}_prospect`, `${suffix} Prospect`, `${suffix} Prospect`, NOW, NOW);
  db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', ?, ?, 1, 1, ?, ?)")
    .run(`contact_${suffix}`, `person_${suffix}_prospect`, mobileHash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, ?, 'active', ?, ?)")
    .run(`student_${suffix}`, `person_${suffix}_prospect`, `STU-${suffix}`, suffix === "current" ? 1 : 2, NOW, status, NOW, NOW);
}

async function mobileLookupHash(value: string) {
  const mobile = normalizeIndianMobile(value);
  if (!mobile) throw new Error("Invalid test mobile");
  return hmacHex(SESSION_PEPPER, "mobile", mobile);
}

function row(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function all(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

function count(db: DatabaseSync, tableOrWhere: string) {
  return Number(row(db, `select count(*) as count from ${tableOrWhere}`)?.count || 0);
}

function columns(db: DatabaseSync, tableName: string) {
  return all(db, `pragma table_info(${tableName})`).map((item) => String(item.name));
}

function indexes(db: DatabaseSync) {
  return all(db, "select name from sqlite_master where type = 'index'").map((item) => String(item.name));
}

function title(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql, []);
  }
  async batch(statements: SqliteD1Statement[]) {
    this.db.exec("begin");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.db.exec("commit");
      return results;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

class SqliteD1Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly params: SqlValue[]) {}
  bind(...params: SqlValue[]) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }
  async first<T = unknown>() {
    return (this.statement().get(...this.params) as T | undefined) || null;
  }
  async all<T = unknown>() {
    return { success: true, results: this.statement().all(...this.params) as T[], meta: {} };
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    const result = this.statement().run(...this.params);
    return { success: true, meta: { changes: result.changes, rows_written: result.changes } };
  }
  private statement(): StatementSync {
    return this.db.prepare(this.sql);
  }
}
