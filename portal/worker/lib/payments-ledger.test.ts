/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { WorkerBindings } from "../bindings";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";
import { allocateInstalments, financialSummaryFromReceipts, getPaymentLedger, recordEnrolmentReceipt } from "./payments-ledger";

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

  close() {
    this.database.close();
  }
}

describe("Payments / Receipts Ledger V1", () => {
  it("allocates cumulative receipts FIFO across instalments with paise boundaries", () => {
    const schedule = [
      { instalmentNumber: 1, amountPaise: 500000, dueDate: null },
      { instalmentNumber: 2, amountPaise: 750000, dueDate: null },
      { instalmentNumber: 3, amountPaise: 750000, dueDate: null },
    ];
    expect(statuses(allocateInstalments(0, schedule))).toEqual(["pending:0", "pending:0", "pending:0"]);
    expect(statuses(allocateInstalments(300000, schedule))).toEqual(["part_paid:300000", "pending:0", "pending:0"]);
    expect(statuses(allocateInstalments(500000, schedule))).toEqual(["paid:500000", "pending:0", "pending:0"]);
    expect(statuses(allocateInstalments(600000, schedule))).toEqual(["paid:500000", "part_paid:100000", "pending:0"]);
    expect(statuses(allocateInstalments(1250000, schedule))).toEqual(["paid:500000", "paid:750000", "pending:0"]);
    expect(statuses(allocateInstalments(2000000, schedule))).toEqual(["paid:500000", "paid:750000", "paid:750000"]);
    expect(statuses(allocateInstalments(499999, schedule))).toEqual(["part_paid:499999", "pending:0", "pending:0"]);
    expect(statuses(allocateInstalments(500001, schedule))).toEqual(["paid:500000", "part_paid:1", "pending:0"]);
  });

  it("summarises first instalment, overall balance, class readiness and fully paid state", () => {
    const fullSchedule = [{ instalmentNumber: 1, amountPaise: 1400000, dueDate: null }];
    expect(financialSummaryFromReceipts(1400000, fullSchedule, [receipt("r1", 1300000)])).toMatchObject({
      totalReceivedPaise: 1300000,
      overallBalancePaise: 100000,
      firstInstalmentBalancePaise: 100000,
      classStartEligible: false,
      fullyPaid: false,
    });
    expect(financialSummaryFromReceipts(1400000, fullSchedule, [receipt("r1", 1400000)])).toMatchObject({
      totalReceivedPaise: 1400000,
      overallBalancePaise: 0,
      firstInstalmentBalancePaise: 0,
      classStartEligible: true,
      fullyPaid: true,
    });
    expect(financialSummaryFromReceipts(2000000, [{ instalmentNumber: 1, amountPaise: 500000, dueDate: null }], [receipt("r1", 500000)])).toMatchObject({
      classStartEligible: true,
      fullyPaid: false,
      overallBalancePaise: 1500000,
    });
  });

  it("records a post-confirm receipt in the canonical receipts table and refreshes balances", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      const result = await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", {
        amountPaise: 100000,
        paymentMode: "cash",
        idempotencyKey: "pay_cash_1000",
      });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error(result.message);
      expect(result.receipt.receiptNumber).toMatch(/^RCP-SION-\d{4}-000002$/);
      expect(result.financialSummary).toMatchObject({ totalReceivedPaise: 1400000, overallBalancePaise: 0, classStartEligible: true, fullyPaid: true });
      expect(row(db, "select count(*) as count from receipts")?.count).toBe(2);
      expect(row(db, "select enrolment_id, fee_agreement_id, student_id from receipts where receipt_number like '%000002'")).toMatchObject({ enrolment_id: "enrol_a", fee_agreement_id: "fee_a", student_id: "student_a" });
      expect(row(db, "select status, converted_enrolment_id from enquiries where id = 'enq_a'")).toMatchObject({ status: "converted", converted_enrolment_id: "enrol_a" });
      expect(row(db, "select status from admission_drafts where id = 'draft_a'")).toMatchObject({ status: "confirmed" });
    } finally {
      db.close();
    }
  });

  it("rejects overpayment and keeps the canonical sum capped at the final fee", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      const accepted = await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_balance" });
      expect(accepted.ok).toBe(true);
      const rejected = await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_stale_second" });
      expect(rejected).toMatchObject({ ok: false, code: "fee_fully_paid" });
      expect(row(db, "select sum(amount_paise) as total from receipts where enrolment_id = 'enrol_a'")?.total).toBe(1400000);
    } finally {
      db.close();
    }
  });

  it("allows only one concurrent remaining-balance payment to win", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      const [first, second] = await Promise.all([
        recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_race_a" }),
        recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_race_b" }),
      ]);
      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
      expect(row(db, "select sum(amount_paise) as total from receipts where enrolment_id = 'enrol_a'")?.total).toBe(1400000);
    } finally {
      db.close();
    }
  });

  it("keeps receipt idempotency stable and conflicts changed payloads", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      const first = await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_same" });
      const retry = await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_same" });
      expect(first.ok).toBe(true);
      expect(retry.ok).toBe(true);
      if (!first.ok || !retry.ok) throw new Error("idempotency failed");
      expect(retry.receipt.receiptNumber).toBe(first.receipt.receiptNumber);
      const changed = await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 99999, paymentMode: "cash", idempotencyKey: "pay_same" });
      expect(changed).toMatchObject({ ok: false, code: "idempotency_conflict" });
      const changedInputs = [
        { amountPaise: 100000, receivedAt: "2020-01-01T10:30:00.000Z", paymentMode: "cash", idempotencyKey: "pay_same" },
        { amountPaise: 100000, paymentMode: "upi", paymentReference: "UPI-123", idempotencyKey: "pay_same" },
        { amountPaise: 100000, paymentMode: "cash", paymentReference: "changed", idempotencyKey: "pay_same" },
        { amountPaise: 100000, paymentMode: "cash", notes: "changed", idempotencyKey: "pay_same" },
      ] as const;
      for (const input of changedInputs) {
        await expect(recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", input)).resolves.toMatchObject({ ok: false, code: "idempotency_conflict" });
      }
      await expect(recordEnrolmentReceipt(c, ownerStaff(), "enrol_b", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_same" })).resolves.toMatchObject({ ok: false, code: "idempotency_conflict" });
      expect(row(db, "select count(*) as count from receipts where enrolment_id = 'enrol_a'")?.count).toBe(2);
    } finally {
      db.close();
    }
  });

  it("returns the same receipt for concurrent identical idempotent submissions", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      const [first, retry] = await Promise.all([
        recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_concurrent_same" }),
        recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_concurrent_same" }),
      ]);
      expect(first.ok).toBe(true);
      expect(retry.ok).toBe(true);
      if (!first.ok || !retry.ok) throw new Error("concurrent idempotency failed");
      expect(retry.receipt.receiptNumber).toBe(first.receipt.receiptNumber);
      expect(row(db, "select count(*) as count from receipts where enrolment_id = 'enrol_a' and idempotency_key = 'pay_concurrent_same'")?.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("enforces payment-mode, role, backdate and branch rules", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      expect(await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 1000, paymentMode: "upi", idempotencyKey: "pay_upi_missing" })).toMatchObject({ ok: false, code: "payment_reference_required" });
      expect(await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 1000, paymentMode: "other", idempotencyKey: "pay_other_missing" })).toMatchObject({ ok: false, code: "receipt_notes_required" });
      expect(await recordEnrolmentReceipt(c, staffForRole("telecaller"), "enrol_a", { amountPaise: 1000, paymentMode: "cash", idempotencyKey: "pay_telecaller" })).toMatchObject({ ok: false, code: "forbidden" });
      expect(await recordEnrolmentReceipt(c, staffForRole("counsellor"), "enrol_a", { amountPaise: 1000, receivedAt: "2020-01-01T00:00:00.000Z", paymentMode: "cash", idempotencyKey: "pay_backdate_counsellor" })).toMatchObject({ ok: false, code: "receipt_backdate_forbidden" });
      expect(await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 1000, receivedAt: "2999-01-01T00:00:00.000Z", paymentMode: "cash", idempotencyKey: "pay_future_owner" })).toMatchObject({ ok: false, code: "future_receipt_date" });
      expect(await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 1000, receivedAt: "2020-01-01T00:00:00.000Z", paymentMode: "cash", idempotencyKey: "pay_backdate_owner" })).toMatchObject({ ok: true });
      expect(await getPaymentLedger(c, staffForRole("counsellor", "acct_wadala"), "enrol_a")).toMatchObject({ ok: false, code: "forbidden" });
      expect(await recordEnrolmentReceipt(c, ownerStaff(), "missing_enrolment", { amountPaise: 1000, paymentMode: "cash", idempotencyKey: "pay_missing" })).toMatchObject({ ok: false, code: "enrolment_not_found" });
    } finally {
      db.close();
    }
  });

  it("scopes summaries per enrolment and preserves referral attribution", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      await recordEnrolmentReceipt(c, ownerStaff(), "enrol_a", { amountPaise: 100000, paymentMode: "cash", idempotencyKey: "pay_a_only" });
      const ledgerA = await getPaymentLedger(c, ownerStaff(), "enrol_a");
      const ledgerB = await getPaymentLedger(c, ownerStaff(), "enrol_b");
      expect(ledgerA.ok && ledgerA.ledger.financialSummary.totalReceivedPaise).toBe(1400000);
      expect(ledgerB.ok && ledgerB.ledger.financialSummary.totalReceivedPaise).toBe(0);
      expect(row(db, "select referral_id, referrer_profile_id from enrolments where id = 'enrol_a'")).toMatchObject({ referral_id: "ref_a", referrer_profile_id: "refprof_a" });
      expect(row(db, "select count(*) as count from referral_reward_snapshots")?.count).toBe(0);
    } finally {
      db.close();
    }
  });
});

function statuses(rows: ReturnType<typeof allocateInstalments>) {
  return rows.map((row) => `${row.status}:${row.allocatedReceivedPaise}`);
}

function receipt(id: string, amountPaise: number) {
  return { id, receipt_number: id, amount_paise: amountPaise, received_at: "2026-08-20T09:00:00.000Z", payment_mode: "cash", payment_reference: null, notes: null, status: "recorded" as const, payload_fingerprint: id };
}

function seededDb() {
  const db = new SqliteD1();
  applyMigrations(db);
  db.database.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at)
    values ('org_samyak', 'Samyak', 'samyak', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
    values
      ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('branch_wadala', 'org_samyak', 'Wadala', 'WAD', 'Asia/Kolkata', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into roles (id, organisation_id, code, name, created_at)
    values
      ('role_owner', 'org_samyak', 'owner', 'Owner', '2026-08-20T00:00:00.000Z'),
      ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '2026-08-20T00:00:00.000Z'),
      ('role_telecaller', 'org_samyak', 'telecaller', 'Telecaller', '2026-08-20T00:00:00.000Z');
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, date_of_birth, status, created_at, updated_at)
    values
      ('person_owner', 'org_samyak', 'branch_sion', 'Owner User', 'Owner', null, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('person_counsellor', 'org_samyak', 'branch_sion', 'Counsellor User', 'Counsellor', null, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('person_telecaller', 'org_samyak', 'branch_sion', 'Telecaller User', 'Telecaller', null, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('person_student', 'org_samyak', 'branch_sion', 'Asha Student', 'Asha', '2001-02-03', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
    values
      ('acct_owner', 'org_samyak', 'owner_hash', 'owner_hash', '1111', 1, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('acct_counsellor', 'org_samyak', 'counsellor_hash', 'counsellor_hash', '2222', 1, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('acct_telecaller', 'org_samyak', 'telecaller_hash', 'telecaller_hash', '3333', 1, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
      ('acct_wadala', 'org_samyak', 'wadala_hash', 'wadala_hash', '4444', 1, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into login_account_people (login_account_id, person_id, access_type, is_default, created_at)
    values ('acct_owner', 'person_owner', 'staff', 1, '2026-08-20T00:00:00.000Z');
    insert into login_account_roles (login_account_id, role_id, branch_id, created_at)
    values
      ('acct_owner', 'role_owner', null, '2026-08-20T00:00:00.000Z'),
      ('acct_counsellor', 'role_counsellor', 'branch_sion', '2026-08-20T00:00:00.000Z'),
      ('acct_telecaller', 'role_telecaller', 'branch_sion', '2026-08-20T00:00:00.000Z'),
      ('acct_wadala', 'role_counsellor', 'branch_wadala', '2026-08-20T00:00:00.000Z');
    insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
    values ('course_tally', 'org_samyak', 'SYK-TLY-003', 'CAP - TALLY WITH TAX AND MS OFFICE', '6 months', 6, 1600000, 1200000, 1, 1, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
    values ('student_a', 'org_samyak', 'person_student', 'branch_sion', 'SYK-SION-000057', 57, '2026-08-20', 'active', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
    values ('refprof_a', 'org_samyak', 'person_student', 'EXT-57', 'token-57', 'https://example.test/r/token-57', 1, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into referral_programmes (id, organisation_id, code, name, validity_days, minimum_fee_percentage, status, created_at, updated_at)
    values ('programme_a', 'org_samyak', 'student_referral', 'Student Referral', 30, 50, 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into enquiries (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id, source, status, pipeline_stage, converted_enrolment_id, converted_at, created_at, updated_at)
    values ('enq_a', 'org_samyak', 'branch_sion', 'person_student', 'ENQ-SION-2026-D9A59899', 'mobile_hash', 'course_tally', 'walk_in', 'converted', 'converted', 'enrol_a', '2026-08-20T09:03:02.105Z', '2026-08-20T00:00:00.000Z', '2026-08-20T09:03:02.105Z');
    insert into referrals (id, organisation_id, branch_id, referral_programme_id, referrer_profile_id, prospect_person_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until, attributed_at, prospect_mobile_hash, consent_recorded_at, created_at, updated_at)
    values ('ref_a', 'org_samyak', 'branch_sion', 'programme_a', 'refprof_a', 'person_student', 'enq_a', 'course_tally', 'staff_entry', 'converted', '2026-08-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z', '2026-08-20T09:03:02.105Z', 'mobile_hash', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T09:03:02.105Z');
    insert into admission_drafts (id, organisation_id, branch_id, enquiry_id, person_id, payload_json, current_step, status, confirmed_at, created_by_login_account_id, updated_by_login_account_id, created_at, updated_at)
    values ('draft_a', 'org_samyak', 'branch_sion', 'enq_a', 'person_student', '{}', 'confirm', 'confirmed', '2026-08-20T09:03:02.105Z', 'acct_owner', 'acct_owner', '2026-08-20T00:00:00.000Z', '2026-08-20T09:03:02.105Z');
    insert into enrolments (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, admission_date, joining_date, status, nsdc_preference, referral_id, referrer_profile_id, created_at, updated_at)
    values
      ('enrol_a', 'student_a', 'branch_sion', 'course_tally', 'enq_a', 'ENR-SION-2026-000060', 'classroom', '2026-08-20', '2026-08-21', 'confirmed', 'yes', 'ref_a', 'refprof_a', '2026-08-20T09:03:02.105Z', '2026-08-20T09:03:02.105Z'),
      ('enrol_b', 'student_a', 'branch_sion', 'course_tally', null, 'ENR-SION-2026-000061', 'classroom', '2026-08-20', '2026-08-21', 'confirmed', 'no', null, null, '2026-08-20T09:03:02.105Z', '2026-08-20T09:03:02.105Z');
    insert into fee_agreements (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
    values
      ('fee_a', 'enrol_a', 1600000, 1400000, 200000, 'full', 1, 1300000, 'active', '2026-08-20T09:03:02.105Z', '2026-08-20T09:03:02.105Z'),
      ('fee_b', 'enrol_b', 1600000, 2000000, 0, 'instalments', 3, 500000, 'active', '2026-08-20T09:03:02.105Z', '2026-08-20T09:03:02.105Z');
    insert into fee_agreement_instalments (id, fee_agreement_id, instalment_number, amount_paise, due_date, created_at)
    values
      ('inst_a1', 'fee_a', 1, 1400000, null, '2026-08-20T09:03:02.105Z'),
      ('inst_b1', 'fee_b', 1, 500000, null, '2026-08-20T09:03:02.105Z'),
      ('inst_b2', 'fee_b', 2, 750000, null, '2026-08-20T09:03:02.105Z'),
      ('inst_b3', 'fee_b', 3, 750000, null, '2026-08-20T09:03:02.105Z');
    insert into receipts (id, organisation_id, branch_id, receipt_number, receipt_year, enquiry_id, admission_draft_id, person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode, status, created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at)
    values ('receipt_token', 'org_samyak', 'branch_sion', 'RCP-SION-2026-000001', 2026, 'enq_a', 'draft_a', 'person_student', 'student_a', 'enrol_a', 'fee_a', 1300000, '2026-08-20T09:00:00.000Z', 'cash', 'recorded', 'acct_owner', 'token_key', 'token_fingerprint', '2026-08-20T09:00:00.000Z', '2026-08-20T09:03:02.105Z');
    insert into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at)
    values ('seq_receipt_2026', 'org_samyak', 'branch_sion', 'receipt:2026', 2, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
  `);
  return db;
}

function context(db: SqliteD1): AppContext {
  return {
    env: {
      DB: db as unknown as D1Database,
      ENVIRONMENT: "development",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      SESSION_PEPPER: "test-pepper",
      DEV_OTP: "123456",
    } satisfies WorkerBindings,
  } as AppContext;
}

function applyMigrations(db: SqliteD1) {
  const migrationsDir = join(process.cwd(), "migrations");
  for (const file of readdirSync(migrationsDir).filter((name: string) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      db.database.exec(statement);
    }
  }
}

function ownerStaff(): StaffContext {
  return staffForRole("owner");
}

function staffForRole(role: string, loginAccountId = `acct_${role}`): StaffContext {
  return {
    loginAccountId,
    activePersonId: `person_${role}`,
    roles: [role],
  };
}

function row(db: SqliteD1, sql: string) {
  return db.database.prepare(sql).get() as Record<string, any> | undefined;
}
