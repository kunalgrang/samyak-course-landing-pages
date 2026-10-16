/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferralDb } from "./referral-repository";
import { evaluateStudentReferralParticipationEligibility as evaluate, type StudentReferralEligibilityInput } from "./student-referral-eligibility";

const NOW = "2026-10-16T10:00:00.000Z";
const INPUT: StudentReferralEligibilityInput = {
  organisationId: "org_test", personId: "person", studentId: "student", loginAccountId: "account",
  referralProgrammeId: "programme", admissionEnrolmentId: "enrolment", now: NOW,
};
const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  const directory = join(process.cwd(), "migrations");
  for (const file of readdirSync(directory).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()) {
    for (const sql of readFileSync(join(directory, file), "utf8").split("--> statement-breakpoint").filter((part) => part.trim())) sqlite.exec(sql);
  }
  sqlite.exec("pragma foreign_keys = on");
  const insert = (table: string, values: Record<string, SQLInputValue>) => {
    sqlite.prepare(`insert into ${table} (${Object.keys(values).join(",")}) values (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  };
  const times = { created_at: NOW, updated_at: NOW };
  for (const suffix of ["test", "other"]) {
    insert("organisations", { id: `org_${suffix}`, name: suffix, slug: suffix, status: "active", ...times });
    insert("branches", { id: `branch_${suffix}`, organisation_id: `org_${suffix}`, name: suffix, code: suffix, timezone: "Asia/Kolkata", status: "active", ...times });
  }
  for (const id of ["person", "other_person"]) insert("people", { id, organisation_id: "org_test", home_branch_id: "branch_test", full_name: id, status: "active", ...times });
  insert("students", { id: "student", organisation_id: "org_test", person_id: "person", home_branch_id: "branch_test", student_number: "ST1", sequence_number: 1, student_since: "2026-10-01", current_status: "active", portal_status: "not_invited", ...times });
  insert("students", { id: "other_student", organisation_id: "org_test", person_id: "other_person", home_branch_id: "branch_test", student_number: "ST2", sequence_number: 2, student_since: "2026-10-01", current_status: "active", ...times });
  insert("global_identities", { id: "identity", mobile_normalized: "test_hash", mobile_hash: "test_hash", mobile_last_four: "0000", status: "active", ...times });
  insert("global_identities", { id: "other_identity", mobile_normalized: "other_hash", mobile_last_four: "0001", status: "active", ...times });
  insert("login_accounts", { id: "account", organisation_id: "org_test", global_identity_id: "identity", mobile_normalized: "test_hash", mobile_last_four: "0000", login_enabled: 1, status: "active", ...times });
  insert("organisation_memberships", { id: "membership", organisation_id: "org_test", global_identity_id: "identity", login_account_id: "account", status: "active", ...times });
  sqlite.exec("update login_accounts set organisation_membership_id = 'membership' where id = 'account'");
  insert("login_account_people", { login_account_id: "account", person_id: "person", access_type: "self", is_available: 1, is_default: 1, created_at: NOW });
  for (const code of ["student", "alumni"]) insert("roles", { id: `role_${code}`, organisation_id: "org_test", code, name: code, created_at: NOW });
  insert("person_roles", { person_id: "person", role_id: "role_student", branch_key: "", status: "active", created_at: NOW });
  insert("referral_programmes", { id: "programme", organisation_id: "org_test", code: "test_programme", name: "Programme", validity_days: 30, minimum_fee_percentage: 50, status: "active", ...times });
  for (const referrer_type of ["student", "alumni"]) insert("referral_programme_referrer_types", { referral_programme_id: "programme", referrer_type, created_at: NOW });
  insert("courses", { id: "course", organisation_id: "org_test", code: "TEST", name: "Test course", status: "active", ...times });
  const snapshot = { version: "admission-confirmation-v1", organisationId: "org_test", personId: "person", enquiryId: "enquiry", draftId: "draft", branchId: "branch_test", courseId: "course" };
  insert("enquiries", { id: "enquiry", organisation_id: "org_test", branch_id: "branch_test", person_id: "person", enquiry_number: "EN1", mobile_used: "test_hash", source: "walk_in", status: "converted", pipeline_stage: "converted", ...times });
  insert("enrolments", { id: "enrolment", student_id: "student", branch_id: "branch_test", course_id: "course", enquiry_id: "enquiry", enrolment_number: "ER1", training_mode: "classroom", admission_date: "2026-10-01", joining_date: "2026-10-01", status: "confirmed", ...times });
  sqlite.exec("update enquiries set converted_enrolment_id = 'enrolment' where id = 'enquiry'");
  insert("admission_drafts", { id: "draft", organisation_id: "org_test", branch_id: "branch_test", enquiry_id: "enquiry", person_id: "person", payload_json: "{}", status: "confirmed", created_by_login_account_id: "account", updated_by_login_account_id: "account", confirmed_at: NOW, confirmation_locked_at: NOW, confirmation_snapshot_version: snapshot.version, confirmation_snapshot_json: JSON.stringify(snapshot), ...times });

  // Deliberately expose D1's normal surface; every call must use SELECT, and
  // SQLite query_only additionally protects against writes through any SQL form.
  const adapter = {
    prepare(sql: string) {
      expect(sql.trim()).toMatch(/^select\b/i);
      let values: SQLInputValue[] = [];
      const statement = {
        bind(...args: SQLInputValue[]) { values = args; return statement; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() { throw new Error("Evaluator attempted a write"); },
      };
      return statement;
    },
    async batch() { throw new Error("Evaluator attempted a batch"); },
  };
  const db = adapter as unknown as ReferralDb;
  const run = async (overrides: Partial<StudentReferralEligibilityInput> = {}) => {
    const before = dump(sqlite);
    sqlite.exec("pragma query_only = on");
    try {
      const result = await evaluate(db, { ...INPUT, ...overrides });
      expect(dump(sqlite)).toEqual(before);
      return result;
    } finally { sqlite.exec("pragma query_only = off"); }
  };
  const profile = (active = 1, owner: string | null = "person", org = "org_test", id = "profile") => insert("referrer_profiles", {
    id, organisation_id: org, person_id: owner, active, external_referrer_id: id, referral_token: `legacy_${id}`, personal_link: "https://example.test/legacy", ...times,
  });
  return { sqlite, run, profile, insert, snapshot };
}

function dump(db: DatabaseSync) {
  return db.prepare("select name from sqlite_master where type = 'table' order by name").all().map(({ name }) => ({
    name, rows: db.prepare(`select * from "${String(name).replaceAll('"', '""')}" order by rowid`).all(),
  }));
}

describe("student referral participation eligibility (real migrated SQLite)", () => {
  it("qualifies without a session, contacts, profile, or links; not_invited is valid effective access", async () => {
    expect(await fixture().run()).toEqual({ status: "eligible_for_initial_provisioning", reason: "eligible", referrerTypes: ["student"] });
  });

  it.each(["invited", "active"])("also permits portal_status %s", async (status) => {
    const f = fixture(); f.sqlite.prepare("update students set portal_status = ? where id = 'student'").run(status);
    expect((await f.run()).status).toBe("eligible_for_initial_provisioning");
  });

  it.each(["completed", "alumni"])("preserves %s students with an active permitted role", async (status) => {
    const f = fixture(); f.sqlite.prepare("update students set current_status = ? where id = 'student'").run(status);
    f.sqlite.exec("update enrolments set status = 'completed'");
    expect((await f.run()).status).toBe("eligible_for_initial_provisioning");
  });

  it("supports alumni-only Persons", async () => {
    const f = fixture(); f.sqlite.exec("update person_roles set role_id = 'role_alumni'");
    expect(await f.run()).toMatchObject({ status: "eligible_for_initial_provisioning", referrerTypes: ["alumni"] });
  });

  it.each(["confirmed", "not_started", "active", "on_hold", "completed"])("accepts %s enrolments with confirmed relational evidence", async (status) => {
    const f = fixture(); f.sqlite.prepare("update enrolments set status = ? where id = 'enrolment'").run(status);
    expect((await f.run()).status).toBe("eligible_for_initial_provisioning");
  });

  it("preserves completed enrolments with an alumni-only role", async () => {
    const f = fixture(); f.sqlite.exec("update enrolments set status = 'completed'; update person_roles set role_id = 'role_alumni'");
    expect(await f.run()).toMatchObject({ status: "eligible_for_initial_provisioning", referrerTypes: ["alumni"] });
  });

  it("rejects provisional enrolments despite confirmed draft and converted enquiry markers", async () => {
    const f = fixture(); f.sqlite.exec("update enrolments set status = 'provisional'");
    expect(await f.run()).toEqual({ status: "ineligible_admission", reason: "admission_confirmation_inconsistent" });
  });

  it("does not let converted enquiry markers alone qualify a provisional admission", async () => {
    const f = fixture(); f.sqlite.exec("update enrolments set status = 'provisional'; update admission_drafts set status = 'draft', confirmed_at = null");
    expect(await f.run()).toEqual({ status: "ineligible_admission", reason: "admission_not_confirmed" });
  });

  it("does not let confirmed draft markers alone qualify a provisional admission", async () => {
    const f = fixture(); f.sqlite.exec("update enrolments set status = 'provisional'; update enquiries set status = 'admission_pending', pipeline_stage = 'admission_pending', converted_enrolment_id = null");
    expect(await f.run()).toEqual({ status: "ineligible_admission", reason: "admission_confirmation_inconsistent" });
  });

  it("does not let an active profile bypass contradictory provisional admission evidence", async () => {
    const f = fixture(); f.profile(); f.sqlite.exec("update enrolments set status = 'provisional'");
    expect(await f.run()).toEqual({ status: "ineligible_admission", reason: "admission_confirmation_inconsistent" });
  });

  it.each(["cancelled", "expired", "transferred", "dropped_out"])("requires review for %s enrolments without inventing continuation policy", async (status) => {
    const f = fixture(); f.sqlite.prepare("update enrolments set status = ? where id = 'enrolment'").run(status);
    expect(await f.run()).toEqual({ status: "ineligible_admission", reason: "admission_enrolment_status_requires_review" });
    f.profile();
    expect(await f.run()).toEqual({ status: "ineligible_admission", reason: "admission_enrolment_status_requires_review" });
  });

  it("uses the server clock by default and rejects expired programmes at current time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    const f = fixture();
    expect((await f.run({ now: undefined })).status).toBe("eligible_for_initial_provisioning");
    f.sqlite.exec("update referral_programmes set ends_at = '2026-10-15T10:00:00.000Z' where id = 'programme'");
    expect(await f.run({ now: undefined })).toEqual({ status: "ineligible_programme_or_role", reason: "programme_not_current" });
  });

  it("keeps an injected historical test clock separate from current provisioning eligibility", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
    const f = fixture();
    f.sqlite.exec("update referral_programmes set ends_at = '2026-10-15T10:00:00.000Z' where id = 'programme'; update admission_drafts set confirmed_at = '2026-10-14T10:00:00.000Z', confirmation_locked_at = '2026-10-14T10:00:00.000Z'");
    // Test/diagnostic injection can evaluate the old date window. This result is
    // never authority to provision now; a provisioning caller must use current time.
    expect((await f.run({ now: "2026-10-14T10:00:00.000Z" })).status).toBe("eligible_for_initial_provisioning");
    expect(await f.run({ now: undefined })).toEqual({ status: "ineligible_programme_or_role", reason: "programme_not_current" });
    f.sqlite.exec("update organisation_memberships set status = 'revoked'");
    expect(await f.run({ now: "2026-10-14T10:00:00.000Z" })).toMatchObject({ status: "ineligible_authentication", reason: "membership_revoked" });
  });

  it("uses current server time to reject confirmation timestamps still in the future", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-15T10:00:00.000Z");
    expect(await fixture().run({ now: undefined })).toEqual({ status: "ineligible_admission", reason: "admission_confirmation_inconsistent" });
  });

  it.each(["bad-date", ""])("rejects invalid injected time %j before querying", async (now) => {
    const prepare = vi.fn(() => { throw new Error("Invalid time must not query the database"); });
    const batch = vi.fn(() => { throw new Error("Evaluator must never batch writes"); });
    const db = { prepare, batch } as unknown as ReferralDb;
    await expect(evaluate(db, { ...INPUT, now })).rejects.toBeInstanceOf(RangeError);
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns both permitted roles and accepts either permitted active role", async () => {
    const f = fixture(); f.insert("person_roles", { person_id: "person", role_id: "role_alumni", branch_key: "", status: "active", created_at: NOW });
    expect(await f.run()).toMatchObject({ referrerTypes: ["alumni", "student"] });
    f.sqlite.exec("delete from referral_programme_referrer_types where referrer_type = 'student'");
    expect(await f.run()).toMatchObject({ referrerTypes: ["alumni"] });
    f.sqlite.exec("update person_roles set status = 'inactive' where role_id = 'role_student'");
    expect(await f.run()).toMatchObject({ referrerTypes: ["alumni"] });
  });

  it("does not confuse another enrolment with the specified confirmed admission", async () => {
    const f = fixture();
    f.insert("enrolments", { id: "second", student_id: "student", branch_id: "branch_test", course_id: "course", enrolment_number: "ER2", training_mode: "online", admission_date: "2026-10-15", joining_date: "2026-10-15", status: "provisional", created_at: NOW, updated_at: NOW });
    expect((await f.run()).status).toBe("eligible_for_initial_provisioning");
    expect(await f.run({ admissionEnrolmentId: "second" })).toMatchObject({ status: "ineligible_admission", reason: "admission_not_confirmed" });
  });

  it("recognises an existing active profile after all gates", async () => {
    const f = fixture(); f.profile();
    expect(await f.run({ expectedReferrerProfileId: "profile" })).toEqual({ status: "already_active", reason: "profile_active", referrerProfileId: "profile", referrerTypes: ["student"] });
    f.sqlite.exec("update organisation_memberships set status = 'suspended'");
    expect(await f.run()).toMatchObject({ status: "ineligible_authentication", reason: "membership_suspended" });
  });

  it("never reactivates an inactive profile, even if authentication is restricted too", async () => {
    const f = fixture(); f.profile(0);
    expect(await f.run()).toEqual({ status: "inactive_profile_requires_review", reason: "profile_inactive", referrerProfileId: "profile" });
    f.sqlite.exec("update login_accounts set login_enabled = 0");
    expect((await f.run()).status).toBe("inactive_profile_requires_review");
  });

  const restrictions = [
    ["inactive Organisation", "update organisations set status = 'inactive' where id = 'org_test'", "ineligible_subject", "organisation_not_active"],
    ["inactive Person", "update people set status = 'inactive' where id = 'person'", "ineligible_subject", "person_not_active"],
    ["wrong Person tenant", "update people set organisation_id = 'org_other' where id = 'person'", "ownership_or_tenant_conflict", "person_organisation_mismatch"],
    ["wrong Student tenant", "update students set organisation_id = 'org_other' where id = 'student'", "ownership_or_tenant_conflict", "student_ownership_mismatch"],
    ["wrong Student owner", "update students set person_id = 'other_person', organisation_id = 'org_other' where id = 'student'", "ownership_or_tenant_conflict", "student_ownership_mismatch"],
    ["suspended membership", "update organisation_memberships set status = 'suspended'", "ineligible_authentication", "membership_suspended"],
    ["revoked membership", "update organisation_memberships set status = 'revoked'", "ineligible_authentication", "membership_revoked"],
    ["disabled account", "update login_accounts set status = 'disabled'", "ineligible_authentication", "login_account_not_active"],
    ["suspended account", "update login_accounts set status = 'suspended'", "ineligible_authentication", "login_account_not_active"],
    ["login disabled", "update login_accounts set login_enabled = 0", "ineligible_authentication", "login_disabled"],
    ["disabled identity", "update global_identities set status = 'disabled' where id = 'identity'", "ineligible_authentication", "global_identity_not_active"],
    ["suspended identity", "update global_identities set status = 'suspended' where id = 'identity'", "ineligible_authentication", "global_identity_not_active"],
    ["missing identity pointer", "update login_accounts set global_identity_id = null", "ineligible_authentication", "global_identity_missing"],
    ["identity mobile mismatch", "update login_accounts set mobile_normalized = 'wrong_hash'", "ownership_or_tenant_conflict", "account_identity_mismatch"],
    ["identity pointer mismatch", "update organisation_memberships set global_identity_id = 'other_identity'", "ownership_or_tenant_conflict", "membership_relationship_mismatch"],
    ["missing membership pointer", "update login_accounts set organisation_membership_id = null", "ownership_or_tenant_conflict", "membership_relationship_mismatch"],
    ["missing membership", "update login_accounts set organisation_membership_id = null; delete from organisation_memberships", "ineligible_authentication", "membership_missing"],
    ["wrong membership tenant", "update organisation_memberships set organisation_id = 'org_other'", "ownership_or_tenant_conflict", "membership_relationship_mismatch"],
    ["wrong account tenant", "update login_accounts set organisation_id = 'org_other'", "ownership_or_tenant_conflict", "account_organisation_mismatch"],
    ["missing self-link", "delete from login_account_people", "ineligible_self_link", "self_link_missing"],
    ["unavailable self-link", "update login_account_people set is_available = 0", "ineligible_self_link", "self_link_unavailable"],
    ["guardian-only link", "update login_account_people set access_type = 'guardian'", "ineligible_self_link", "non_self_account_person_link"],
    ["shared-family-only link", "update login_account_people set access_type = 'shared_family'", "ineligible_self_link", "non_self_account_person_link"],
    ["different Person", "update login_account_people set person_id = 'other_person'", "ownership_or_tenant_conflict", "different_linked_person"],
    ["unavailable different self owner", "update login_account_people set person_id = 'other_person', is_available = 0", "ownership_or_tenant_conflict", "different_linked_person"],
    ["disabled Portal access", "update students set portal_status = 'disabled' where id = 'student'", "ineligible_portal_access", "portal_access_disabled"],
    ["inactive role", "update person_roles set status = 'inactive'", "ineligible_programme_or_role", "student_alumni_role_not_active"],
    ["missing role", "delete from person_roles", "ineligible_programme_or_role", "student_alumni_role_not_active"],
    ["wrong role tenant", "update roles set organisation_id = 'org_other' where id = 'role_student'", "ineligible_programme_or_role", "student_alumni_role_not_active"],
    ["inactive programme", "update referral_programmes set status = 'inactive' where id = 'programme'", "ineligible_programme_or_role", "programme_not_current"],
    ["expired programme", "update referral_programmes set ends_at = '2026-10-15T10:00:00.000Z' where id = 'programme'", "ineligible_programme_or_role", "programme_not_current"],
    ["future programme", "update referral_programmes set starts_at = '2026-10-17T10:00:00.000Z' where id = 'programme'", "ineligible_programme_or_role", "programme_not_current"],
    ["malformed programme end", "update referral_programmes set ends_at = 'invalid' where id = 'programme'", "ineligible_programme_or_role", "programme_not_current"],
    ["wrong programme tenant", "update referral_programmes set organisation_id = 'org_other' where id = 'programme'", "ownership_or_tenant_conflict", "programme_organisation_mismatch"],
    ["student not permitted", "delete from referral_programme_referrer_types where referrer_type = 'student'", "ineligible_programme_or_role", "role_not_permitted"],
    ["unconfirmed admission", "update admission_drafts set status = 'draft', confirmed_at = null", "ineligible_admission", "admission_not_confirmed"],
    ["missing confirmed timestamp", "update admission_drafts set confirmed_at = null", "ineligible_admission", "admission_not_confirmed"],
    ["missing lock", "update admission_drafts set confirmation_locked_at = null", "ineligible_admission", "admission_confirmation_inconsistent"],
    ["unsupported snapshot", "update admission_drafts set confirmation_snapshot_version = 'future-version'", "ineligible_admission", "admission_confirmation_inconsistent"],
    ["malformed snapshot", "update admission_drafts set confirmation_snapshot_json = '{'", "ineligible_admission", "admission_confirmation_inconsistent"],
    ["partial snapshot", "update admission_drafts set confirmation_snapshot_json = '{}'", "ineligible_admission", "admission_confirmation_inconsistent"],
    ["conversion not finalised", "update enquiries set pipeline_stage = 'admission_pending'", "ineligible_admission", "admission_confirmation_inconsistent"],
    ["wrong conversion pointer", "update enquiries set converted_enrolment_id = null", "ineligible_admission", "admission_confirmation_inconsistent"],
    ["wrong admission Student", "update enrolments set student_id = 'other_student'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
    ["wrong admission Person", "update admission_drafts set person_id = 'other_person'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
    ["wrong enquiry Person", "update enquiries set person_id = 'other_person'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
    ["wrong enquiry tenant", "update enquiries set organisation_id = 'org_other'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
    ["wrong enquiry branch", "update enquiries set branch_id = 'branch_other'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
    ["wrong admission branch tenant", "update enrolments set branch_id = 'branch_other'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
    ["wrong admission Course tenant", "update courses set organisation_id = 'org_other' where id = 'course'", "ownership_or_tenant_conflict", "admission_ownership_mismatch"],
  ] as const;
  it.each(restrictions)("blocks %s without changing any table", async (_label, sql, status, reason) => {
    const f = fixture(); f.sqlite.exec(sql);
    expect(await f.run()).toEqual({ status, reason });
  });

  it.each(["organisationId", "personId", "studentId", "loginAccountId", "referralProgrammeId", "admissionEnrolmentId"] as const)("rejects missing %s", async (key) => {
    expect((await fixture().run({ [key]: "missing" })).status).not.toMatch(/^(eligible_for_initial_provisioning|already_active)$/);
  });

  it("uses inclusive programme date boundaries", async () => {
    const f = fixture(); f.sqlite.prepare("update referral_programmes set starts_at = ?, ends_at = ? where id = 'programme'").run(NOW, NOW);
    expect((await f.run()).status).toBe("eligible_for_initial_provisioning");
  });

  it("rejects wrong-tenant profiles, including inactive ones", async () => {
    const f = fixture(); f.profile(0, "person", "org_other");
    expect(await f.run()).toMatchObject({ status: "ownership_or_tenant_conflict", reason: "profile_ownership_conflict" });
  });

  it("rejects an expected profile belonging to another Person or missing", async () => {
    const f = fixture(); f.profile(1, "other_person");
    for (const id of ["profile", "missing"]) expect(await f.run({ expectedReferrerProfileId: id })).toMatchObject({ status: "ownership_or_tenant_conflict", reason: "profile_ownership_conflict" });
  });

  it("rejects additional available ownership even alongside a valid self-link", async () => {
    const f = fixture(); f.insert("login_account_people", { login_account_id: "account", person_id: "other_person", access_type: "guardian", is_available: 1, created_at: NOW });
    expect(await f.run()).toMatchObject({ reason: "different_linked_person" });
  });

  it("does not let account-level student or administrator roles substitute for an active Person role", async () => {
    const f = fixture(); f.sqlite.exec("delete from person_roles");
    f.insert("login_account_roles", { login_account_id: "account", role_id: "role_student", created_at: NOW });
    expect(await f.run()).toMatchObject({ reason: "student_alumni_role_not_active" });
  });

  it("rejects an expected education partner profile as a student profile", async () => {
    const f = fixture(); f.profile(1, null);
    f.insert("education_partners", { id: "partner", organisation_id: "org_test", home_branch_id: "branch_test", partner_type: "freelancer", business_name: "Test", contact_person_name: "Test", current_commission_basis_points: 1000, status: "active", created_at: NOW, updated_at: NOW });
    f.insert("education_partner_referrer_profiles", { education_partner_id: "partner", referrer_profile_id: "profile", created_at: NOW });
    expect(await f.run({ expectedReferrerProfileId: "profile" })).toMatchObject({ status: "ownership_or_tenant_conflict", reason: "profile_ownership_conflict" });
  });

  it("rejects a second unfinished draft instead of choosing arbitrary confirmation evidence", async () => {
    const f = fixture(); f.sqlite.exec("insert into admission_drafts select 'second_draft', organisation_id, branch_id, enquiry_id, person_id, payload_json, current_step, 'draft', created_by_login_account_id, updated_by_login_account_id, created_at, updated_at, null, null, null, null, null from admission_drafts where id = 'draft'");
    expect(await f.run()).toMatchObject({ reason: "admission_confirmation_inconsistent" });
  });

  it.each(["organisationId", "personId", "enquiryId", "draftId", "branchId", "courseId", "version"])("rejects mismatched snapshot %s", async (key) => {
    const f = fixture(); f.sqlite.prepare("update admission_drafts set confirmation_snapshot_json = ?").run(JSON.stringify({ ...f.snapshot, [key]: "wrong" }));
    expect(await f.run()).toMatchObject({ reason: "admission_confirmation_inconsistent" });
  });

  it.each(["2026-10-17T10:00:00.000Z", "bad-date"])("rejects invalid/future confirmation time %s", async (date) => {
    const f = fixture(); f.sqlite.prepare("update admission_drafts set confirmed_at = ?").run(date);
    expect(await f.run()).toMatchObject({ reason: "admission_confirmation_inconsistent" });
  });
});
