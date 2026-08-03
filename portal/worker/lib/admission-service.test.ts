/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";
import type { WorkerBindings } from "../bindings";
import { decryptText } from "./crypto";
import {
  confirmAdmission,
  decideDiscountApproval,
  listDiscountApprovals,
  requestDiscountApproval,
  saveAdmissionDraft,
  validateAdmissionDraftPayload,
  validateAdmissionForConfirmation,
} from "./admission-service";

type Row = Record<string, any>;
type AdmissionTestPayload = any;

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
    this.db.maybeFail(this.sql);
    const result = this.db.database.prepare(this.sql).run(...(this.values as any[]));
    return { success: true, meta: { changes: result.changes, rows_written: result.changes } };
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  failOnceSqlIncludes: string | null = null;

  prepare(sql: string) {
    return new SqliteD1Statement(this, sql);
  }

  async batch<T extends { run: () => Promise<unknown> }>(statements: T[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  maybeFail(sql: string) {
    if (!this.failOnceSqlIncludes) return;
    if (!compactSql(sql).includes(this.failOnceSqlIncludes)) return;
    this.failOnceSqlIncludes = null;
    throw new Error("Simulated D1 write failure");
  }

  close() {
    this.database.close();
  }
}

describe("Admission Workflow v1 rules", () => {
  it("accepts a complete regular admission with locality and city but no full address", () => {
    const payload = validPayload();
    expect(payload.locality.fullAddress).toBe("");
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);
  });

  it("requires locality, city, configured course and Aadhaar name/DOB confirmation", () => {
    const payload = validPayload();
    payload.locality.locality = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.locality.locality = "Sion";
    payload.locality.city = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.locality.city = "Mumbai";
    payload.course.courseId = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.course.courseId = "course_full_stack";
    payload.identity.identityConfirmed = false;
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("accepts valid Indian mobile shape in admission payloads", () => {
    const payload = validPayload();
    payload.contact.primaryMobile = "+91 98765 43210";
    payload.contact.alternateMobile = "+91 98765 43211";
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);

    payload.contact.primaryMobile = "5123456789";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.contact.primaryMobile = "+91 98765 43210";
    payload.contact.alternateMobile = "5123456789";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("rejects future DOB, invalid admission dates and names containing numbers", () => {
    const payload = validPayload();
    payload.identity.dateOfBirth = "2999-01-01";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.identity.dateOfBirth = "2001-02-03";
    payload.course.admissionDate = "2026-02-31";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.course.admissionDate = "2026-08-01";
    payload.identity.officialFullName = "Asha 2";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("allows draft standardFeePaise as non-authoritative display data", () => {
    const payload = validPayload();
    payload.fee.standardFeePaise = 1;
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "";
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);
  });

  it("requires father's name and NSDC declarations when NSDC is Yes", () => {
    const payload = validPayload();
    payload.course.nsdcPreference = "yes";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.identity.fatherName = "Ramesh Student";
    payload.declarations.nsdcProcessingAccepted = true;
    payload.declarations.nsdcPendingDocumentsUnderstood = true;
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);
  });

  it("blocks sensitive draft payload keys", () => {
    expect(validateAdmissionDraftPayload({ identity: {}, aadhaarNumber: "123412341234" })).toMatchObject({ success: false });
    expect(validateAdmissionDraftPayload({ bankDetails: "secret" })).toMatchObject({ success: false });
  });
});

describe("confirmAdmission service integration", () => {
  it("creates the first admission and persists all primary records", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");

    const confirmed = await confirmAdmission(c, staff, "enq_first");
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.message);

    expect(confirmed.result.studentNumber).toMatch(/^SYK-SION-\d{6}$/);
    expect(confirmed.result.enrolmentNumber).toMatch(/^ENR-SION-2026-\d{6}$/);
    expect(count(db, "students")).toBe(1);
    expect(count(db, "enrolments")).toBe(1);
    expect(count(db, "fee_agreements")).toBe(1);
    expect(row(db, "select status, converted_enrolment_id from enquiries where id = 'enq_first'")).toMatchObject({
      status: "converted",
      converted_enrolment_id: confirmed.result.enrolmentId,
    });
    expect(row(db, "select status from admission_drafts where enquiry_id = 'enq_first'")).toMatchObject({ status: "confirmed" });
    db.close();
  });

  it("retains Student ID for a returning student and creates a second enrolment", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");
    const first = await expectOk(confirmAdmission(c, staff, "enq_first"));
    seedEnquiry(db, { id: "enq_returning", personId: "person_asha", number: "ENQ-SION-2026-002" });
    await createAdmissionDraft(c, "enq_returning");

    const second = await expectOk(confirmAdmission(c, staff, "enq_returning"));
    expect(second.studentId).toBe(first.studentId);
    expect(second.studentNumber).toBe(first.studentNumber);
    expect(second.enrolmentId).not.toBe(first.enrolmentId);
    expect(count(db, "students")).toBe(1);
    expect(count(db, "enrolments")).toBe(2);
    db.close();
  });

  it("is idempotent on retry and does not duplicate child records", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");

    const first = await expectOk(confirmAdmission(c, staff, "enq_first"));
    const second = await expectOk(confirmAdmission(c, staff, "enq_first"));

    expect(second).toMatchObject({
      studentId: first.studentId,
      studentNumber: first.studentNumber,
      enrolmentId: first.enrolmentId,
      enrolmentNumber: first.enrolmentNumber,
    });
    expect(count(db, "enrolments")).toBe(1);
    expect(count(db, "fee_agreements")).toBe(1);
    expect(count(db, "student_consents")).toBe(count(db, "select distinct consent_type from student_consents"));
    expect(count(db, "person_localities")).toBe(1);
    expect(count(db, "education_records")).toBe(1);
    expect(count(db, "audit_logs where action = 'admission_confirmed'")).toBe(1);
    db.close();
  });

  it("resolves simultaneous confirmations to one logical admission", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");

    const [first, second] = await Promise.all([confirmAdmission(c, staff, "enq_first"), confirmAdmission(c, staff, "enq_first")]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Concurrent confirmation failed");
    expect(second.result).toMatchObject({
      studentId: first.result.studentId,
      studentNumber: first.result.studentNumber,
      enrolmentId: first.result.enrolmentId,
      enrolmentNumber: first.result.enrolmentNumber,
    });
    expect(count(db, "students")).toBe(1);
    expect(count(db, "enrolments")).toBe(1);
    expect(count(db, "fee_agreements")).toBe(1);
    expect(count(db, "admission_drafts where confirmation_locked_at is not null")).toBe(1);
    db.close();
  });

  it("recovers when a retry follows failure after enrolment creation", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");
    db.failOnceSqlIncludes = "insert into fee_agreements";

    await expect(confirmAdmission(c, staff, "enq_first")).rejects.toThrow("Simulated D1 write failure");
    expect(count(db, "enrolments")).toBe(1);
    const locked = confirmationSnapshot(db);
    expect(locked).toMatchObject({ courseId: "course_full_stack", listedFeePaise: 5000000 });
    expect(row(db, "select status, converted_enrolment_id from enquiries where id = 'enq_first'")).toMatchObject({
      status: "admission_pending",
      converted_enrolment_id: null,
    });

    const changed = validPayload();
    changed.course.courseId = "course_data";
    seedCourse(db, "course_data", "DA", "Data Analytics", 4500000, 3800000);
    const save = await saveAdmissionDraft(c, staff, "enq_first", { payload: changed, currentStep: "course" });
    expect(save).toMatchObject({ ok: false, status: 409, code: "admission_confirmation_locked" });

    const recovered = await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(row(db, "select converted_enrolment_id from enquiries where id = 'enq_first'")?.converted_enrolment_id).toBe(recovered.enrolmentId);
    expect(row(db, "select status from admission_drafts where enquiry_id = 'enq_first'")).toMatchObject({ status: "confirmed" });
    expect(count(db, "enrolments")).toBe(1);
    expect(count(db, "fee_agreements")).toBe(1);
    expect(count(db, "person_localities")).toBe(1);
    expect(count(db, "education_records")).toBe(1);
    db.close();
  });

  it("creates a safe snapshot before enrolment creation and recovers when enrolment insertion initially fails", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");
    db.failOnceSqlIncludes = "insert or ignore into enrolments";

    await expect(confirmAdmission(c, staff, "enq_first")).rejects.toThrow("Simulated D1 write failure");
    expect(count(db, "enrolments")).toBe(0);
    const snapshotJson = String(row(db, "select confirmation_snapshot_json from admission_drafts where enquiry_id = 'enq_first'")?.confirmation_snapshot_json || "");
    expect(snapshotJson).toContain("course_full_stack");
    expect(snapshotJson).not.toContain("9876543210");
    expect(snapshotJson).not.toMatch(/aadhaarNumber|bank|secret|document/i);

    db.database.exec("update courses set status = 'inactive', default_fee_paise = 5100000, lowest_acceptable_fee_paise = 4100000 where id = 'course_full_stack'");
    const recovered = await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(recovered.studentNumber).toMatch(/^SYK-SION-/);
    expect(row(db, "select course_id, admission_date from enrolments")).toMatchObject({ course_id: "course_full_stack", admission_date: "2026-08-01" });
    expect(row(db, "select standard_fee_paise, final_agreed_fee_paise from fee_agreements")).toMatchObject({
      standard_fee_paise: 5000000,
      final_agreed_fee_paise: 5000000,
    });
    db.close();
  });

  it.each([
    ["course", (payload: AdmissionTestPayload) => { payload.course.courseId = "course_data"; }],
    ["admission date", (payload: AdmissionTestPayload) => { payload.course.admissionDate = "2026-09-01"; }],
    ["final fee", (payload: AdmissionTestPayload) => { payload.fee.finalAgreedFeePaise = 4500000; payload.fee.discountReasonCode = "merit"; payload.fee.discountReason = "Merit scholarship"; }],
    ["payment plan", (payload: AdmissionTestPayload) => { payload.fee.paymentPlanType = "three_instalments"; payload.fee.numberOfInstalments = 3; }],
  ])("rejects %s edits after confirmation lock", async (_label, mutate) => {
    const db = testDb();
    const c = context(db);
    seedCourse(db, "course_data", "DA", "Data Analytics", 4500000, 3800000);
    await createAdmissionDraft(c, "enq_first");
    db.failOnceSqlIncludes = "insert or ignore into enrolments";
    await expect(confirmAdmission(c, staff, "enq_first")).rejects.toThrow("Simulated D1 write failure");

    const changed = validPayload();
    mutate(changed);
    const save = await saveAdmissionDraft(c, staff, "enq_first", { payload: changed, currentStep: "review" });

    expect(save).toMatchObject({ ok: false, status: 409, code: "admission_confirmation_locked" });
    expect(JSON.parse(String(row(db, "select payload_json from admission_drafts where enquiry_id = 'enq_first'")?.payload_json)).course.courseId).toBe("course_full_stack");
    db.close();
  });

  it("recovers below-floor approval using locked approval values after Course Master floor changes", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first", belowFloorPayload());
    const requested = await requestDiscountApproval(c, staff, "enq_first");
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.message);
    await decideDiscountApproval(c, staffForRole("owner", "acct_owner"), requested.approvalId, "approved");
    db.failOnceSqlIncludes = "insert into fee_agreements";

    await expect(confirmAdmission(c, staff, "enq_first")).rejects.toThrow("Simulated D1 write failure");
    db.database.exec("update courses set lowest_acceptable_fee_paise = 4500000 where id = 'course_full_stack'");
    await expectOk(confirmAdmission(c, staff, "enq_first"));

    expect(row(db, "select standard_fee_paise, final_agreed_fee_paise, discount_approval_id, discount_approved_by from fee_agreements")).toMatchObject({
      standard_fee_paise: 5000000,
      final_agreed_fee_paise: 3500000,
      discount_approval_id: requested.approvalId,
      discount_approved_by: "acct_owner",
    });
    db.close();
  });

  it.each([
    ["course", (db: SqliteD1) => { seedCourse(db, "course_data", "DA", "Data Analytics", 4500000, 3800000); db.database.exec("update enrolments set course_id = 'course_data'"); }],
    ["branch", (db: SqliteD1) => { seedBranch(db, "branch_wadala", "WAD"); db.database.exec("update enrolments set branch_id = 'branch_wadala'"); }],
    ["person", (db: SqliteD1) => { db.database.exec("update students set person_id = 'person_staff' where id in (select student_id from enrolments)"); }],
  ])("stops recovery when existing enrolment %s differs from the snapshot", async (_label, mutate) => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");
    db.failOnceSqlIncludes = "insert into fee_agreements";
    await expect(confirmAdmission(c, staff, "enq_first")).rejects.toThrow("Simulated D1 write failure");

    mutate(db);
    const recovered = await confirmAdmission(c, staff, "enq_first");
    expect(recovered).toMatchObject({ ok: false, status: 409, code: "recovery_integrity_error" });
    expect(count(db, "fee_agreements")).toBe(0);
    db.close();
  });

  it("uses Course Master fee despite tampered draft standard fee", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.fee.standardFeePaise = 1;
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "Approved scholarship";
    payload.fee.discountReasonCode = "merit";
    await createAdmissionDraft(c, "enq_first", payload);

    await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(row(db, "select standard_fee_paise, final_agreed_fee_paise, discount_paise from fee_agreements")).toMatchObject({
      standard_fee_paise: 5000000,
      final_agreed_fee_paise: 4500000,
      discount_paise: 500000,
    });
    db.close();
  });

  it("rejects an admission draft branch that does not match the enquiry branch", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.course.branchId = "branch_tampered";
    await createAdmissionDraft(c, "enq_first", payload);

    const confirmed = await confirmAdmission(c, staff, "enq_first");
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) throw new Error("Expected branch mismatch to fail");
    expect(confirmed.fieldErrors?.["course.branchId"]?.[0]).toContain("locked");
    expect(count(db, "enrolments")).toBe(0);
    db.close();
  });

  it("rejects payment plans not allowed by the course duration rules", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.fee.paymentPlanType = "custom";
    payload.fee.numberOfInstalments = 4;
    await createAdmissionDraft(c, "enq_first", payload);

    const confirmed = await confirmAdmission(c, staff, "enq_first");
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) throw new Error("Expected disallowed payment plan to fail");
    expect(confirmed.fieldErrors?.["fee.paymentPlanType"]?.[0]).toContain("allowed");
    db.close();
  });

  it("requires matching owner approval for below-floor final fees", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.fee.finalAgreedFeePaise = 3500000;
    payload.fee.discountReason = "Merit scholarship";
    payload.fee.discountReasonCode = "merit";
    await createAdmissionDraft(c, "enq_first", payload);

    const blocked = await confirmAdmission(c, staff, "enq_first");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("Expected below-floor fee to need approval");
    expect(blocked.fieldErrors?.["fee.finalAgreedFeePaise"]?.[0]).toContain("Owner approval");

    const requested = await requestDiscountApproval(c, staff, "enq_first");
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.message);
    const owner = staffForRole("owner", "acct_owner");
    const decided = await decideDiscountApproval(c, owner, requested.approvalId, "approved");
    expect(decided.ok).toBe(true);

    await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(row(db, "select final_agreed_fee_paise, discount_approved_by, discount_approval_id from fee_agreements")).toMatchObject({
      final_agreed_fee_paise: 3500000,
      discount_approved_by: "acct_owner",
      discount_approval_id: requested.approvalId,
    });
    db.close();
  });

  it.each(["admin", "system_admin", "admission_admin", "counsellor"])("rejects %s discount decisions at the service boundary", async (role) => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first", belowFloorPayload());
    const requested = await requestDiscountApproval(c, staff, "enq_first");
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.message);

    const decided = await decideDiscountApproval(c, staffForRole(role, "acct_staff"), requested.approvalId, "approved");
    expect(decided).toMatchObject({ ok: false, status: 403 });
    expect(row(db, "select status, decided_by_login_account_id from admission_discount_approvals")).toMatchObject({
      status: "pending",
      decided_by_login_account_id: null,
    });
    db.close();
  });

  it("records no approver for within-floor discounts", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "Merit scholarship";
    payload.fee.discountReasonCode = "merit";
    await createAdmissionDraft(c, "enq_first", payload);

    await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(row(db, "select discount_paise, discount_approved_by, discount_approval_id from fee_agreements")).toMatchObject({
      discount_paise: 500000,
      discount_approved_by: null,
      discount_approval_id: null,
    });
    db.close();
  });

  it("records no approver for listed-price admissions", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");

    await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(row(db, "select discount_paise, discount_approved_by, discount_approval_id from fee_agreements")).toMatchObject({
      discount_paise: 0,
      discount_approved_by: null,
      discount_approval_id: null,
    });
    db.close();
  });

  it.each([
    ["final fee", (payload: AdmissionTestPayload) => { payload.fee.finalAgreedFeePaise = 3400000; }],
    ["discount reason", (payload: AdmissionTestPayload) => { payload.fee.discountReasonCode = "custom"; payload.fee.discountReason = "Owner exception"; }],
    ["course", (payload: AdmissionTestPayload, db: SqliteD1) => { seedCourse(db, "course_data", "DA", "Data Analytics", 4500000, 3800000); payload.course.courseId = "course_data"; }],
  ])("supersedes approval when %s changes", async (_label, mutate) => {
    const db = testDb();
    const c = context(db);
    const payload = belowFloorPayload();
    await createAdmissionDraft(c, "enq_first", payload);
    const requested = await requestDiscountApproval(c, staff, "enq_first");
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.message);
    await decideDiscountApproval(c, staffForRole("owner", "acct_owner"), requested.approvalId, "approved");

    mutate(payload, db);
    await saveAdmissionDraft(c, staff, "enq_first", { payload, currentStep: "fee" });
    expect(row(db, "select status from admission_discount_approvals where id = '" + requested.approvalId + "'")).toMatchObject({ status: "superseded" });
    const confirmed = await confirmAdmission(c, staff, "enq_first");
    expect(confirmed.ok).toBe(false);
    db.close();
  });

  it.each([
    ["listed price", "default_fee_paise", 5100000],
    ["floor price", "lowest_acceptable_fee_paise", 4100000],
  ])("supersedes approval when Course Master %s changes", async (_label, column, value) => {
    const db = testDb();
    const c = context(db);
    const payload = belowFloorPayload();
    await createAdmissionDraft(c, "enq_first", payload);
    const requested = await requestDiscountApproval(c, staff, "enq_first");
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.message);
    await decideDiscountApproval(c, staffForRole("owner", "acct_owner"), requested.approvalId, "approved");

    db.database.exec(`update courses set ${column} = ${value} where id = 'course_full_stack'`);
    await saveAdmissionDraft(c, staff, "enq_first", { payload, currentStep: "fee" });
    expect(row(db, "select status from admission_discount_approvals where id = '" + requested.approvalId + "'")).toMatchObject({ status: "superseded" });
    expect((await confirmAdmission(c, staff, "enq_first")).ok).toBe(false);
    db.close();
  });

  it("deduplicates concurrent identical approval requests to one active fingerprint", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first", belowFloorPayload());

    const [first, second] = await Promise.all([requestDiscountApproval(c, staff, "enq_first"), requestDiscountApproval(c, staff, "enq_first")]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("approval requests failed");
    expect(first.approvalId).toBe(second.approvalId);
    expect(count(db, "admission_discount_approvals where status in ('pending', 'approved')")).toBe(1);
    db.close();
  });

  it("returns commercial snapshot values in the approval queue", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first", belowFloorPayload());
    const requested = await requestDiscountApproval(c, staff, "enq_first");
    expect(requested.ok).toBe(true);

    const approvals = await listDiscountApprovals(c);
    expect(approvals[0]).toMatchObject({
      listed_fee_paise: 5000000,
      lowest_acceptable_fee_paise: 4000000,
      requested_final_fee_paise: 3500000,
      discount_amount_paise: 1500000,
      enquiry_number: "ENQ-SION-2026-001",
      course_name: "Full Stack Development",
    });
    db.close();
  });

  it("blocks incomplete migrated courses until explicitly configured", async () => {
    const db = testDb();
    const c = context(db);
    db.database.exec("update courses set admission_configuration_complete = 0 where id = 'course_full_stack'");
    await createAdmissionDraft(c, "enq_first");

    const blocked = await confirmAdmission(c, staff, "enq_first");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("Expected incomplete course to fail");
    expect(blocked.fieldErrors?.["course.courseId"]?.[0]).toContain("requires Course Master configuration");

    db.database.exec("update courses set admission_configuration_complete = 1 where id = 'course_full_stack'");
    await expectOk(confirmAdmission(c, staff, "enq_first"));
    db.close();
  });

  it("uses the admission date year in the enrolment number", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.course.admissionDate = "2025-12-30";
    payload.course.joiningDate = "2026-01-02";
    await createAdmissionDraft(c, "enq_first", payload);

    const confirmed = await expectOk(confirmAdmission(c, staff, "enq_first"));
    expect(confirmed.enrolmentNumber).toMatch(/^ENR-SION-2025-/);
    expect(row(db, "select sequence_key from number_sequences where sequence_key like 'enrolment:%'")).toMatchObject({
      sequence_key: "enrolment:2025",
    });
    db.close();
  });

  it("persists alternate mobile encrypted and outside draft JSON", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.contact.alternateMobile = "+919876543211";
    await createAdmissionDraft(c, "enq_first", payload);

    expect(count(db, "person_contacts")).toBe(2);
    const contacts = all(db, "select person_contacts.id, person_contacts.is_primary, person_contact_secrets.value_ciphertext from person_contacts join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id order by is_primary desc");
    expect(contacts.map((contact) => contact.is_primary)).toEqual([1, 0]);
    expect(JSON.stringify(contacts)).not.toContain("9876543211");
    const alternate = contacts.find((contact) => contact.is_primary === 0)!;
    await expect(decryptText("test-pepper", `contact:${alternate.id}`, alternate.value_ciphertext)).resolves.toBe("+919876543211");
    expect(row(db, "select payload_json from admission_drafts where enquiry_id = 'enq_first'")?.payload_json).not.toContain("9876543211");
    db.close();
  });

  it("keeps exactly one primary mobile after replacement", async () => {
    const db = testDb();
    const c = context(db);
    await createAdmissionDraft(c, "enq_first");
    const payload = validPayload();
    payload.contact.primaryMobile = "+919999999999";
    await saveAdmissionDraft(c, staff, "enq_first", { payload, currentStep: "contact" });

    expect(count(db, "person_contacts where contact_type = 'mobile'")).toBe(2);
    expect(count(db, "person_contacts where contact_type = 'mobile' and is_primary = 1")).toBe(1);
    const primary = row(db, "select last_four from person_contacts where is_primary = 1");
    expect(primary).toMatchObject({ last_four: "9999" });
    db.close();
  });

  it("creates one NSDC aadhaar-pending profile and does not duplicate it on retry", async () => {
    const db = testDb();
    const c = context(db);
    const payload = validPayload();
    payload.course.nsdcPreference = "yes";
    payload.identity.fatherName = "Ramesh Student";
    payload.declarations.nsdcProcessingAccepted = true;
    payload.declarations.nsdcPendingDocumentsUnderstood = true;
    await createAdmissionDraft(c, "enq_first", payload);

    await expectOk(confirmAdmission(c, staff, "enq_first"));
    await expectOk(confirmAdmission(c, staff, "enq_first"));

    expect(count(db, "nsdc_profiles")).toBe(1);
    expect(row(db, "select status, aadhaar_verified from nsdc_profiles")).toMatchObject({ status: "aadhaar_pending", aadhaar_verified: 0 });
    db.close();
  });
});

const staff: StaffContext = {
  loginAccountId: "acct_staff",
  activePersonId: "person_staff",
  roles: ["admission_admin"],
};

function staffForRole(role: string, loginAccountId = `acct_${role}`): StaffContext {
  return {
    loginAccountId,
    activePersonId: `person_${role}`,
    roles: [role],
  };
}

function validPayload(): AdmissionTestPayload {
  return {
    identity: {
      officialFullName: "Asha Student",
      firstName: "Asha",
      dateOfBirth: "2001-02-03",
      gender: "female",
      fatherName: "",
      identityConfirmed: true,
    },
    contact: { primaryMobile: "+919876543210", belongsTo: "student", isWhatsapp: true, alternateMobile: "", preferredLanguage: "English", preferredLanguageCode: "english" },
    locality: { locality: "Sion East", city: "Mumbai", fullAddress: "" },
    education: { qualificationLevel: "HSC / 12th", qualificationLevelCode: "hsc", occupationStatus: "Student", occupationStatusCode: "student", currentlyPursuing: false, passingYear: 2024 },
    course: {
      courseId: "course_full_stack",
      branchId: "branch_sion",
      trainingMode: "classroom",
      batchPreference: "8 AM to 11 AM",
      batchPreferenceCode: "8_11",
      admissionDate: "2026-08-01",
      joiningDate: "2026-08-05",
      nsdcPreference: "no",
    },
    fee: {
      standardFeePaise: 5000000,
      finalAgreedFeePaise: 5000000,
      discountReason: "",
      discountReasonCode: "",
      paymentPlanType: "two_instalments",
      numberOfInstalments: 2,
      initialPaymentExpectedPaise: 0,
    },
    declarations: {
      informationCorrect: true,
      nameDobMatchesAadhaar: true,
      courseRulesExplained: true,
      feeTermsAccepted: true,
      dataProcessingAccepted: true,
      nsdcProcessingAccepted: false,
      nsdcPendingDocumentsUnderstood: false,
    },
  };
}

function belowFloorPayload() {
  const payload = validPayload();
  payload.fee.finalAgreedFeePaise = 3500000;
  payload.fee.discountReason = "Merit scholarship";
  payload.fee.discountReasonCode = "merit";
  return payload;
}

async function createAdmissionDraft(c: AppContext, enquiryId: string, payload = validPayload()) {
  const saved = await saveAdmissionDraft(c, staff, enquiryId, { payload, currentStep: "review" });
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error(saved.message);
  return saved;
}

async function expectOk(resultPromise: ReturnType<typeof confirmAdmission>) {
  const result = await resultPromise;
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.result;
}

function testDb() {
  const db = new SqliteD1();
  applyMigrations(db);
  seedBase(db);
  seedEnquiry(db, { id: "enq_first", personId: "person_asha", number: "ENQ-SION-2026-001" });
  return db;
}

function context(db: SqliteD1): AppContext {
  return {
    env: {
      DB: db as unknown as D1Database,
      ENVIRONMENT: "development",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      PORTAL_APPS_SCRIPT_URL: "https://script.test",
      PORTAL_APPS_SCRIPT_SECRET: "portal-secret",
      SESSION_PEPPER: "test-pepper",
      DEV_OTP: "123456",
    } satisfies WorkerBindings,
  } as AppContext;
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

function seedBase(db: SqliteD1) {
  db.database.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at)
    values ('org_samyak', 'Samyak', 'samyak', 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
    insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
    values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, date_of_birth, status, created_at, updated_at)
    values
      ('person_staff', 'org_samyak', 'branch_sion', 'Staff User', 'Staff', null, 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('person_owner', 'org_samyak', 'branch_sion', 'Owner User', 'Owner', null, 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('person_asha', 'org_samyak', 'branch_sion', 'Asha Student', 'Asha', '2001-02-03', 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
    insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
    values
      ('acct_staff', 'org_samyak', 'staff_mobile_hash', 'staff_mobile_hash', '0000', 1, 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('acct_owner', 'org_samyak', 'owner_mobile_hash', 'owner_mobile_hash', '1111', 1, 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
    insert into login_account_roles (login_account_id, role_id, branch_id, created_at)
    select 'acct_owner', roles.id, null, '2026-07-21T00:00:00.000Z' from roles where roles.organisation_id = 'org_samyak' and roles.code = 'owner';
    insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
    values ('course_full_stack', 'org_samyak', 'FSD', 'Full Stack Development', '6 months', 6, 5000000, 4000000, 1, 1, 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
    insert into admission_option_values (id, organisation_id, category, code, label, sort_order, requires_custom_label, is_active, created_at, updated_at)
    values
      ('opt_lang_en', 'org_samyak', 'preferred_language', 'english', 'English', 1, 0, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('opt_qual_hsc', 'org_samyak', 'qualification_level', 'hsc', 'HSC / 12th', 1, 0, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('opt_occ_student', 'org_samyak', 'occupation_status', 'student', 'Student', 1, 0, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('opt_batch_8_11', 'org_samyak', 'batch_preference', '8_11', '8 AM to 11 AM', 1, 0, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('opt_discount_merit', 'org_samyak', 'discount_reason', 'merit', 'Merit scholarship', 1, 0, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
    insert into payment_plan_rules (id, organisation_id, min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active, created_at, updated_at)
    values
      ('rule_full', 'org_samyak', 4, 6, 'full', 1, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('rule_two', 'org_samyak', 4, 6, 'two_instalments', 2, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'),
      ('rule_three', 'org_samyak', 4, 6, 'three_instalments', 3, 1, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z');
  `);
}

function seedEnquiry(db: SqliteD1, input: { id: string; personId: string; number: string }) {
  db.database.prepare(
    `insert into enquiries
       (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id, source, status, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, ?, 'mobile_hash', 'course_full_stack', 'walk_in', 'admission_pending', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')`,
  ).run(input.id, input.personId, input.number);
}

function seedCourse(db: SqliteD1, id: string, code: string, name: string, listedFeePaise: number, floorFeePaise: number) {
  db.database.prepare(
    `insert into courses
       (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
     values (?, 'org_samyak', ?, ?, '6 months', 6, ?, ?, 1, 0, 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')`,
  ).run(id, code, name, listedFeePaise, floorFeePaise);
}

function seedBranch(db: SqliteD1, id: string, code: string) {
  db.database.prepare(
    `insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
     values (?, 'org_samyak', ?, ?, 'Asia/Kolkata', 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')`,
  ).run(id, code, code);
}

function confirmationSnapshot(db: SqliteD1) {
  const snapshotJson = row(db, "select confirmation_snapshot_json from admission_drafts where enquiry_id = 'enq_first'")?.confirmation_snapshot_json;
  expect(snapshotJson).toBeTruthy();
  return JSON.parse(String(snapshotJson)) as Record<string, unknown>;
}

function row(db: SqliteD1, sql: string) {
  return db.database.prepare(sql).get() as Row | undefined;
}

function all(db: SqliteD1, sql: string) {
  return db.database.prepare(sql).all() as Row[];
}

function count(db: SqliteD1, tableOrSql: string) {
  const source = tableOrSql.trim().toLowerCase().startsWith("select") ? `(${tableOrSql})` : tableOrSql;
  return Number(row(db, `select count(*) as count from ${source}`)?.count || 0);
}

function compactSql(sql: string) {
  return sql.toLowerCase().replace(/\s+/g, " ").trim();
}
