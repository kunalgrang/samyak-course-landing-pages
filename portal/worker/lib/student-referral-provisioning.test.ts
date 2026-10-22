/// <reference types="node" />
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferralDb } from "./referral-repository";
import { recordForwardAdmissionConfirmation as record, ensureForwardStudentReferralParticipation as ensure, type ForwardReferralInput } from "./student-referral-provisioning";

const NOW = "2025-01-01T00:00:00.000Z";
const INPUT: ForwardReferralInput = {
  organisationId: "org_test", personId: "person", studentId: "student", loginAccountId: "account",
  referralProgrammeId: "programme", admissionEnrolmentId: "enrolment", draftId: "draft", enquiryId: "enquiry", intentId: "sr-intent:enrolment",
};
const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers(); for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), "kun73-referral-"))) throw new Error("Unexpected disposable fixture directory");
    rmSync(directory, { recursive: true, force: true });
  }
});
type Hooks = { beforeWrite?: () => void; afterWrite?: () => void };
function adapter(sqlite: DatabaseSync, hooks: Hooks = {}): ReferralDb {
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const statement = {
        bind(...args: SQLInputValue[]) { values = args; return statement; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() {
          const write = /^\s*insert/i.test(sql);
          if (write && hooks.beforeWrite) { const hook = hooks.beforeWrite; delete hooks.beforeWrite; hook(); }
          const results = sqlite.prepare(sql).all(...values) as T[];
          if (write && hooks.afterWrite) { const hook = hooks.afterWrite; delete hooks.afterWrite; hook(); }
          return { results, success: true };
        },
      };
      return statement;
    },
    async batch() { throw new Error("No multi-statement batches required"); },
  } as unknown as ReferralDb;
}
function fixture(databaseName = ":memory:") {
  const sqlite = new DatabaseSync(databaseName);
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


  sqlite.exec("update admission_drafts set status = 'draft', confirmed_at = null; update enquiries set status = 'admission_pending', pipeline_stage = 'admission_pending', converted_enrolment_id = null");
  Object.assign(snapshot, { admissionDate: "2026-10-01", joiningDate: "2026-10-01", expectedCompletionDate: null, trainingMode: "classroom", batchPreference: null, nsdcPreference: "decide_later", listedFeePaise: 100000, finalAgreedFeePaise: 100000, discountAmountPaise: 0, discountApprovedByLoginAccountId: null, discountApprovalId: null, paymentPlanType: "full", numberOfInstalments: 1, initialPaymentExpectedPaise: 1000, tokenReceiptId: "receipt" });
  sqlite.prepare("update admission_drafts set confirmation_snapshot_json = ?").run(JSON.stringify(snapshot));
  insert("fee_agreements", { id: "fee", enrolment_id: "enrolment", standard_fee_paise: 100000, final_agreed_fee_paise: 100000, discount_paise: 0, payment_plan_type: "full", number_of_instalments: 1, initial_payment_expected_paise: 1000, ...times });
  insert("fee_agreement_instalments", { id: "instalment", fee_agreement_id: "fee", instalment_number: 1, amount_paise: 100000, due_date: null, created_at: NOW });
  insert("receipts", { id: "receipt", organisation_id: "org_test", branch_id: "branch_test", receipt_number: "R1", receipt_year: 2025,
    enquiry_id: "enquiry", admission_draft_id: "draft", person_id: "person", student_id: "student", enrolment_id: "enrolment", fee_agreement_id: "fee",
    amount_paise: 1000, received_at: NOW, payment_mode: "cash", created_by_login_account_id: "account", idempotency_key: "receipt1", payload_fingerprint: "test", ...times });
  const hooks: Hooks = {};
  const db = adapter(sqlite, hooks);
  const financial = () => ["fee_agreements", "fee_agreement_instalments", "receipts", "receipt_reversals", "referral_reward_snapshots", "referral_reward_payouts", "referrals"].map((table) => sqlite.prepare(`select * from ${table} order by rowid`).all());
  const run = async (overrides: Partial<ForwardReferralInput> = {}) => {
    const before = financial();
    try { return await ensure(db, { ...INPUT, ...overrides }); } finally { expect(financial()).toEqual(before); }
  };
  const confirm = () => record(db, INPUT);
  const ready = async () => {
    expect((await confirm()).status).toBe("recorded");
    // Windows Date and SQLite clocks can differ by a clock tick. Advance only the
    // test preflight clock; SQL guards continue using SQLite's independent clock.
    const dbNow = String(sqlite.prepare("select strftime('%Y-%m-%dT%H:%M:%fZ','now') as t").get()?.t);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(dbNow) + 1000);
  };
  const count = (table: string) => Number(sqlite.prepare(`select count(*) as n from ${table}`).get()?.n);
  const profile = (active = 1, id = "existing") => insert("referrer_profiles", { id, organisation_id: "org_test", person_id: "person", active, external_referrer_id: id, referral_token: "legacy", personal_link: "", ...times });
  const failAudit = (action: string) => sqlite.exec(`create temp trigger injected_audit_failure before insert on audit_logs when new.action = '${action}' begin select raise(abort, 'injected operational failure'); end`);
  return { sqlite, db, insert, hooks, run, confirm, ready, count, profile, failAudit, financial };
}

describe("durable forward admission intent (real migrated SQLite)", () => {
  it("atomically finalizes a genuinely new transition, intent and unique qualifying audit", async () => {
    const f = fixture(); const before = f.financial();
    expect((await f.confirm()).status).toBe("recorded");
    expect(f.sqlite.prepare("select status, confirmed_at from admission_drafts where id = 'draft'").get()).toMatchObject({ status: "confirmed", confirmed_at: expect.any(String) });
    expect(f.sqlite.prepare("select status, pipeline_stage, converted_enrolment_id from enquiries where id = 'enquiry'").get()).toMatchObject({ status: "converted", pipeline_stage: "converted", converted_enrolment_id: "enrolment" });
    expect((await f.confirm()).status).toBe("already_recorded");
    expect(f.count("student_referral_admission_intents")).toBe(1); expect(f.count("audit_logs")).toBe(1);
    expect(f.financial()).toEqual(before); expect(f.count("referrer_profiles")).toBe(0);
  });
  it("does not discover historical confirmed admissions", async () => {
    const f = fixture(); f.sqlite.exec("update admission_drafts set status = 'confirmed', confirmed_at = created_at; update enquiries set status = 'converted', pipeline_stage = 'converted', converted_enrolment_id = 'enrolment'");
    expect((await f.confirm()).status).toBe("invalid_forward_intent");
    expect((await f.run()).status).toBe("invalid_forward_intent"); expect(f.count("referrer_profiles")).toBe(0);
  });
  it.each([
    "update enrolments set status = 'provisional'",
    "update enrolments set student_id = 'other_student'",
    "update enrolments set branch_id = 'branch_other'",
    "update fee_agreements set final_agreed_fee_paise = 99999",
    "delete from receipts",
    "update receipts set organisation_id = 'org_other'",
    "update admission_drafts set confirmation_snapshot_json = '{}'",
    "update admission_drafts set confirmation_locked_at = 'invalid'",
    "update enquiries set converted_enrolment_id = 'enrolment'",
  ])("rejects contradictory preparation: %s", async (sql) => {
    const f = fixture(); f.sqlite.exec(sql);
    expect((await f.confirm()).status).toBe("integrity_conflict"); expect(f.count("student_referral_admission_intents")).toBe(0); expect(f.count("audit_logs")).toBe(0);
    expect(f.sqlite.prepare("select status from admission_drafts where id = 'draft'").get()?.status).toBe("draft");
  });
  it("rolls back both markers and intent when the qualifying audit fails", async () => {
    const f = fixture(); const before = f.financial(); f.failAudit("student_referral.forward_confirmation");
    expect((await f.confirm()).status).toBe("retryable_failure");
    expect(f.count("student_referral_admission_intents")).toBe(0); expect(f.count("audit_logs")).toBe(0);
    expect(f.sqlite.prepare("select status, confirmed_at from admission_drafts where id = 'draft'").get()).toMatchObject({ status: "draft", confirmed_at: null });
    expect(f.sqlite.prepare("select converted_enrolment_id from enquiries where id = 'enquiry'").get()?.converted_enrolment_id).toBeNull();
    expect(f.financial()).toEqual(before);
  });
  it("does not treat a zero-row stale-snapshot write as success", async () => {
    const f = fixture(); f.hooks.beforeWrite = () => f.sqlite.exec("update admission_drafts set confirmation_snapshot_json = '{}'");
    expect((await f.confirm()).status).toBe("integrity_conflict"); expect(f.count("student_referral_admission_intents")).toBe(0); expect(f.count("audit_logs")).toBe(0);
  });
  it("reconciles uncertain success without replaying financial processing", async () => {
    const f = fixture(); const before = f.financial(); f.hooks.afterWrite = () => { throw new Error("transport lost after commit"); };
    expect((await f.confirm()).status).toBe("retryable_failure"); expect((await f.confirm()).status).toBe("already_recorded");
    expect(f.count("audit_logs")).toBe(1); expect(f.financial()).toEqual(before);
  });
  it("serializes simultaneous confirmation attempts to exactly one transition", async () => {
    const f = fixture(); expect((await Promise.all([f.confirm(), f.confirm()])).map((x) => x.status).sort()).toEqual(["already_recorded", "recorded"]);
    expect(f.count("student_referral_admission_intents")).toBe(1); expect(f.count("audit_logs")).toBe(1);
  });
  it.each(["organisationId", "personId", "studentId", "admissionEnrolmentId", "draftId", "enquiryId"] as const)("rejects wrong %s", async (key) => {
    const f = fixture(); await f.ready(); expect((await record(f.db, { ...INPUT, [key]: "wrong" })).status).not.toBe("recorded");
    expect((await f.run({ [key]: "wrong" })).status).not.toBe("created"); expect(f.count("referrer_profiles")).toBe(0);
  });
});

describe("forward-only referral provisioning (real migrated SQLite)", () => {
  function sharedFixture() {
    const directory = mkdtempSync(join(tmpdir(), "kun73-referral-")); directories.push(directory);
    const file = join(directory, "fixture.sqlite"); const f = fixture(file);
    const second = new DatabaseSync(file); databases.push(second); second.exec("pragma foreign_keys = on");
    return { ...f, second, secondDb: adapter(second) };
  }
  it("serializes two independent connections competing for the same profile", async () => {
    const f = sharedFixture(); await f.ready(); const before = f.financial();
    expect((await Promise.all([f.run(), ensure(f.secondDb, INPUT)])).map((r) => r.status).sort()).toEqual(["already_provisioned", "created"]);
    expect(f.count("referrer_profiles")).toBe(1); expect(f.count("audit_logs")).toBe(2); expect(f.financial()).toEqual(before);
  });
  it("respects a revocation committed by a second connection after preflight", async () => {
    const f = sharedFixture(); await f.ready();
    f.hooks.beforeWrite = () => f.second.exec("update organisation_memberships set status = 'revoked'");
    expect((await f.run()).status).toBe("restricted"); expect(f.count("referrer_profiles")).toBe(0); expect(f.count("audit_logs")).toBe(1);
  });
  it("returns a retryable lock failure and retries only provisioning after the lock clears", async () => {
    const f = sharedFixture(); await f.ready();
    f.second.exec("begin immediate");
    try { expect((await f.run()).status).toBe("retryable_failure"); } finally { f.second.exec("rollback"); }
    expect(f.count("referrer_profiles")).toBe(0); expect((await f.run()).status).toBe("created"); expect(f.count("audit_logs")).toBe(2);
  });
  it("creates exactly one profile and audit with no usable token, URL, link or secret", async () => {
    const f = fixture(); await f.ready(); expect((await f.run()).status).toBe("created"); expect((await f.run()).status).toBe("already_provisioned");
    expect(f.count("referrer_profiles")).toBe(1); expect(f.count("student_referral_provisioning_events")).toBe(1); expect(f.count("audit_logs")).toBe(2);
    expect(f.sqlite.prepare("select active, referral_token, personal_link, external_referrer_id from referrer_profiles").get()).toMatchObject({ active: 1, referral_token: "unissued:person", personal_link: "", external_referrer_id: "forward:person" });
    expect(f.count("referral_links")).toBe(0); expect(f.count("referral_link_secrets")).toBe(0);
  });
  it.each([0, 1])("preserves preexisting profile active=%s", async (active) => {
    const f = fixture(); await f.ready(); f.profile(active);
    expect((await f.run()).status).toBe(active ? "already_provisioned" : "inactive_profile_requires_admin");
    expect(f.count("student_referral_provisioning_events")).toBe(0); expect(f.count("audit_logs")).toBe(1);
  });
  it("serializes simultaneous provisioning attempts and retries", async () => {
    const f = fixture(); await f.ready(); expect((await Promise.all([f.run(), f.run(), f.run()])).map((x) => x.status).sort()).toEqual(["already_provisioned", "already_provisioned", "created"]);
    expect(f.count("referrer_profiles")).toBe(1); expect(f.count("audit_logs")).toBe(2);
  });
  it("rolls back profile and event when audit recording fails, then retries independently", async () => {
    const f = fixture(); await f.ready(); f.failAudit("student_referral.profile_created");
    expect((await f.run()).status).toBe("retryable_failure"); expect(f.count("referrer_profiles")).toBe(0); expect(f.count("student_referral_provisioning_events")).toBe(0); expect(f.count("audit_logs")).toBe(1);
    f.sqlite.exec("drop trigger injected_audit_failure"); expect((await f.run()).status).toBe("created");
  });
  it("reconciles an uncertain commit exactly once", async () => {
    const f = fixture(); await f.ready(); f.hooks.afterWrite = () => { throw new Error("transport lost"); };
    expect((await f.run()).status).toBe("retryable_failure"); expect((await f.run()).status).toBe("already_provisioned"); expect(f.count("audit_logs")).toBe(2);
  });
  it("preserves admin inactivity after uncertain commit", async () => {
    const f = fixture(); await f.ready(); f.hooks.afterWrite = () => { f.sqlite.exec("update referrer_profiles set active = 0"); throw new Error("transport lost"); };
    expect((await f.run()).status).toBe("retryable_failure"); expect((await f.run()).status).toBe("inactive_profile_requires_admin");
  });
  it("does not swallow an unrelated unique legacy identity collision", async () => {
    const f = fixture(); await f.ready(); f.insert("referrer_profiles", { id: "collision", organisation_id: "org_test", person_id: null, active: 1, external_referrer_id: "forward:person", referral_token: "collision", personal_link: "", created_at: NOW, updated_at: NOW });
    expect((await f.run()).status).toBe("integrity_conflict"); expect(f.count("student_referral_provisioning_events")).toBe(0); expect(f.count("audit_logs")).toBe(1);
  });
  it("returns retryable failure before write without a success audit", async () => {
    const f = fixture(); await f.ready(); f.hooks.beforeWrite = () => { throw new Error("database unavailable"); };
    expect((await f.run()).status).toBe("retryable_failure"); expect(f.count("referrer_profiles")).toBe(0); expect(f.count("audit_logs")).toBe(1);
  });
  it("waits for the explicitly selected account without discovering or creating another", async () => {
    const f = fixture(); await f.ready(); const accounts = f.count("login_accounts");
    expect((await f.run({ loginAccountId: "not_yet_provisioned" })).status).toBe("waiting");
    expect(f.count("login_accounts")).toBe(accounts); expect(f.count("referrer_profiles")).toBe(0);
    expect((await f.run()).status).toBe("created");
  });
  const revocations = [
    ["inactive Organisation", "update organisations set status = 'inactive' where id = 'org_test'", "integrity_conflict"],
    ["inactive Person", "update people set status = 'inactive' where id = 'person'", "integrity_conflict"],
    ["suspended membership", "update organisation_memberships set status = 'suspended'", "restricted"],
    ["revoked membership", "update organisation_memberships set status = 'revoked'", "restricted"],
    ["disabled account", "update login_accounts set status = 'disabled'", "restricted"],
    ["login disabled", "update login_accounts set login_enabled = 0", "restricted"],
    ["inactive identity", "update global_identities set status = 'disabled'", "restricted"],
    ["unavailable self", "update login_account_people set is_available = 0", "waiting"],
    ["non-self", "update login_account_people set access_type = 'guardian'", "waiting"],
    ["wrong self owner", "update login_account_people set person_id = 'other_person'", "ownership_conflict"],
    ["account tenant", "update login_accounts set organisation_id = 'org_other'", "ownership_conflict"],
    ["identity ownership", "update organisation_memberships set global_identity_id = 'other_identity'", "ownership_conflict"],
    ["membership pointer", "update login_accounts set organisation_membership_id = null", "ownership_conflict"],
    ["membership tenant", "update organisation_memberships set organisation_id = 'org_other'", "ownership_conflict"],
    ["missing identity pointer", "update login_accounts set global_identity_id = null", "waiting"],
    ["identity key", "update login_accounts set mobile_normalized = 'different'", "ownership_conflict"],
    ["portal disabled", "update students set portal_status = 'disabled' where id = 'student'", "waiting"],
    ["inactive role", "update person_roles set status = 'inactive'", "waiting"],
    ["wrong role tenant", "update roles set organisation_id = 'org_other' where code = 'student'", "waiting"],
    ["unpermitted role", "delete from referral_programme_referrer_types", "waiting"],
    ["inactive programme", "update referral_programmes set status = 'inactive'", "waiting"],
    ["expired programme", "update referral_programmes set ends_at = '2024-01-01T00:00:00.000Z'", "waiting"],
    ["SQLite relative programme date", "update referral_programmes set starts_at = 'now'", "waiting"],
    ["invalid programme end", "update referral_programmes set ends_at = 'invalid'", "waiting"],
    ["SQLite relative lock date", "update admission_drafts set confirmation_locked_at = 'now'", "integrity_conflict"],
    ["wrong programme tenant", "update referral_programmes set organisation_id = 'org_other'", "ownership_conflict"],
    ["Centre ownership", "update enrolments set branch_id = 'branch_other'", "integrity_conflict"],
    ["student ownership", "update students set organisation_id = 'org_other' where id = 'student'", "integrity_conflict"],
    ["Person ownership", "update people set organisation_id = 'org_other' where id = 'person'", "integrity_conflict"],
    ["draft confirmation revoked", "update admission_drafts set status = 'draft'", "integrity_conflict"],
    ["conversion revoked", "update enquiries set status = 'admission_pending'", "integrity_conflict"],
    ["provisional enrolment", "update enrolments set status = 'provisional'", "integrity_conflict"],
  ];
  for (const phase of ["before preflight", "after preflight"] as const) {
    it.each(revocations)(`blocks %s ${phase} without profile/event/audit`, async (_label, sql, status) => {
      const f = fixture(); await f.ready();
      if (phase === "before preflight") f.sqlite.exec(sql); else f.hooks.beforeWrite = () => f.sqlite.exec(sql);
      expect((await f.run()).status).toBe(status); expect(f.count("referrer_profiles")).toBe(0); expect(f.count("student_referral_provisioning_events")).toBe(0); expect(f.count("audit_logs")).toBe(1);
    });
  }
  it("preserves concurrent administrator deactivation, never reactivating it", async () => {
    const f = fixture(); await f.ready(); f.hooks.beforeWrite = () => f.profile(0);
    expect((await f.run()).status).toBe("inactive_profile_requires_admin"); expect(f.count("audit_logs")).toBe(1);
  });
  it("does not accept a caller clock or historical preflight to authorize a current write", async () => {
    const f = fixture(); await f.ready();
    expect((await f.run({ now: "2020-01-01" } as Partial<ForwardReferralInput>)).status).toBe("created");
    const g = fixture(); await g.ready();
    // JS clock can be stale; the SQL write guard still uses the current DB clock.
    // Even a faulty future JS server clock cannot authorize a not-yet-current
    // programme: the write guard uses the database clock, not a bound timestamp.
    g.sqlite.exec("update referral_programmes set starts_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour')");
    vi.setSystemTime(Date.now() + 86400000);
    expect((await g.run()).status).toBe("integrity_conflict"); expect(g.count("referrer_profiles")).toBe(0);
  });
  it.each(["completed", "not_started", "active", "on_hold"])("permits %s lifecycle with fresh eligibility", async (status) => {
    const f = fixture(); await f.ready(); f.sqlite.prepare("update enrolments set status = ?").run(status); expect((await f.run()).status).toBe("created");
  });
  it("supports alumni-only roles and ignores unrelated additional enrolments", async () => {
    const f = fixture(); await f.ready(); f.sqlite.exec("update person_roles set role_id = 'role_alumni'; update enrolments set status = 'completed'");
    f.insert("enrolments", { id: "other_enrolment", student_id: "student", branch_id: "branch_test", course_id: "course", enrolment_number: "ER2", training_mode: "online", admission_date: "2026-10-01", joining_date: "2026-10-01", status: "provisional", created_at: NOW, updated_at: NOW });
    expect((await f.run()).status).toBe("created");
  });
  it.each(["cancelled", "expired", "transferred", "dropped_out"])("requires review for %s", async (status) => {
    const f = fixture(); await f.ready(); f.sqlite.prepare("update enrolments set status = ?").run(status); expect((await f.run()).status).toBe("integrity_conflict"); expect(f.count("referrer_profiles")).toBe(0);
  });
  it("fails closed on an unknown legacy lifecycle", async () => {
    const f = fixture(); await f.ready(); f.sqlite.exec("pragma ignore_check_constraints = on; update enrolments set status = 'unknown'; pragma ignore_check_constraints = off");
    expect((await f.run()).status).toBe("integrity_conflict");
  });
  it("fails closed if qualifying audit or provisioning evidence is lost", async () => {
    const f = fixture(); await f.ready(); expect((await f.run()).status).toBe("created"); f.sqlite.exec("delete from audit_logs where action = 'student_referral.profile_created'");
    expect((await f.run()).status).toBe("integrity_conflict");
    f.sqlite.exec("delete from audit_logs"); expect((await f.run()).status).toBe("integrity_conflict");
  });
});
