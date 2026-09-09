/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerBindings } from "../bindings";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";
import { agingBucket, collectionInstallments, createCollectionFollowup, getCollectionDetail, listCollections } from "./collections";

const NOW = "2026-09-08T00:00:00.000Z";

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

describe("Payments / Collections V2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives collection balances, due states, aging and FIFO allocation from receipts", async () => {
    const db = seededDb();
    try {
      const detail = await getCollectionDetail(context(db), ownerStaff(), "enrol_a");
      expect(detail).toMatchObject({ ok: true });
      if (!detail.ok) throw new Error(detail.message);
      expect(detail.item.summary).toMatchObject({
        agreedFeePaise: 1000000,
        receivedPaise: 700000,
        outstandingPaise: 300000,
        overduePaise: 300000,
        dueTodayPaise: 0,
        daysOverdue: 7,
        agingBucket: "1-7",
        lastPaymentAt: "2026-09-02T09:00:00.000Z",
      });
      expect(detail.installments.map((item) => `${item.label}:${item.allocatedReceivedPaise}:${item.balancePaise}`)).toEqual(["Paid:500000:0", "Overdue:200000:300000"]);
      expect(detail.receiptCorrection.supported).toBe(false);
    } finally {
      db.close();
    }
  });

  it("handles no-schedule agreements without marking them overdue", () => {
    const installments = collectionInstallments(800000, [], [], "2026-09-08");
    expect(installments).toMatchObject([{ requiredPaise: 800000, balancePaise: 800000, dueDate: null, label: "Pending" }]);
  });

  it("returns all four scheduled instalments with overdue and next-due state", () => {
    const installments = collectionInstallments(
      1000000,
      [
        { fee_agreement_id: "fee_four", instalment_number: 1, amount_paise: 250000, due_date: "2026-09-01" },
        { fee_agreement_id: "fee_four", instalment_number: 2, amount_paise: 250000, due_date: "2026-09-08" },
        { fee_agreement_id: "fee_four", instalment_number: 3, amount_paise: 250000, due_date: "2026-10-08" },
        { fee_agreement_id: "fee_four", instalment_number: 4, amount_paise: 250000, due_date: "2026-11-08" },
      ],
      [{ id: "r1", receipt_number: "R1", amount_paise: 300000, received_at: "2026-09-02T09:00:00.000Z", payment_mode: "cash", payment_reference: null, notes: null, status: "recorded", payload_fingerprint: "fp", created_at: "2026-09-02T09:00:00.000Z", recorded_by: null }],
      "2026-09-08",
    );

    expect(installments).toHaveLength(4);
    expect(installments.map((item) => `${item.label}:${item.allocatedReceivedPaise}:${item.balancePaise}`)).toEqual(["Paid:250000:0", "Due Today:50000:200000", "Upcoming:0:250000", "Upcoming:0:250000"]);
  });

  it("returns all six scheduled instalments and allocates overdue receipts FIFO", () => {
    const installments = collectionInstallments(
      600000,
      Array.from({ length: 6 }, (_item, index) => ({
        instalment_number: index + 1,
        fee_agreement_id: "fee_six",
        amount_paise: 100000,
        due_date: `2026-09-0${index + 1}`,
      })),
      [{ id: "r1", receipt_number: "R1", amount_paise: 350000, received_at: "2026-09-07T09:00:00.000Z", payment_mode: "cash", payment_reference: null, notes: null, status: "recorded", payload_fingerprint: "fp", created_at: "2026-09-07T09:00:00.000Z", recorded_by: null }],
      "2026-09-08",
    );

    expect(installments).toHaveLength(6);
    expect(installments.map((item) => `${item.instalmentNumber}:${item.label}:${item.allocatedReceivedPaise}:${item.balancePaise}`)).toEqual([
      "1:Paid:100000:0",
      "2:Paid:100000:0",
      "3:Paid:100000:0",
      "4:Overdue:50000:50000",
      "5:Overdue:0:100000",
      "6:Overdue:0:100000",
    ]);
  });

  it("classifies aging bucket boundaries", () => {
    expect([1, 7, 8, 15, 16, 30, 31, 60, 61].map(agingBucket)).toEqual(["1-7", "1-7", "8-15", "8-15", "16-30", "16-30", "31-60", "31-60", "60+"]);
  });

  it("lists operational queues, search results and privacy-safe DTOs", async () => {
    const db = seededDb();
    try {
      const result = await listCollections(context(db), ownerStaff(), { status: "all", limit: 25, offset: 0 });
      expect(result.overview).toMatchObject({ totalOutstandingPaise: 1300000, overduePaise: 300000, dueTodayPaise: 300000, collectedThisMonthPaise: 200000 });
      expect(result.sections.dueToday.map((item) => item.enrolmentId)).toEqual(["enrol_b"]);
      expect(result.sections.overdue.map((item) => item.enrolmentId)).toEqual(["enrol_a"]);
      const searched = await listCollections(context(db), ownerStaff(), { status: "all", search: "Ravi", limit: 25, offset: 0 });
      expect(searched.items.map((item) => item.studentNumber)).toEqual(["SYK-SION-0002"]);
      const text = JSON.stringify(result);
      expect(text).not.toContain("aadhaar");
      expect(text).not.toContain("mobile_hash");
      expect(text).not.toContain("cipher");
      expect(text).not.toContain("referral");
    } finally {
      db.close();
    }
  });

  it("records immutable follow-ups, requires promise dates and flags missed promises", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      await expect(createCollectionFollowup(c, ownerStaff(), "enrol_a", {
        followupType: "call",
        outcome: "promised_payment",
        note: "Student will pay after salary.",
        promisedPaymentDate: "2026-09-05",
        promisedAmountPaise: 300000,
        nextFollowUpAt: "2026-09-09T10:00",
      })).resolves.toMatchObject({ ok: true });
      const detail = await getCollectionDetail(c, ownerStaff(), "enrol_a");
      expect(detail.ok && detail.item.summary.promiseMissed).toBe(true);
      expect(detail.ok && detail.item.flags).toContain("Promise missed");
      expect(db.database.prepare("select count(*) as count from collection_followups where enrolment_id = 'enrol_a'").get()).toMatchObject({ count: 1 });
      expect(db.database.prepare("select count(*) as count from audit_logs where action = 'collection_followup_created'").get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("keeps branch and enrolment data isolated", async () => {
    const db = seededDb();
    try {
      const c = context(db);
      const sion = await listCollections(c, staffForRole("counsellor", "acct_counsellor"), { status: "all", limit: 25, offset: 0 });
      expect(sion.items.map((item) => item.enrolmentId)).toEqual(["enrol_b", "enrol_a"]);
      await expect(getCollectionDetail(c, staffForRole("counsellor", "acct_wadala"), "enrol_a")).resolves.toMatchObject({ ok: false, code: "collection_not_found" });
      await expect(createCollectionFollowup(c, staffForRole("counsellor", "acct_wadala"), "enrol_a", { followupType: "call", outcome: "contacted", note: "" })).resolves.toMatchObject({ ok: false, code: "collection_not_found" });
    } finally {
      db.close();
    }
  });
});

function seededDb() {
  const db = new SqliteD1();
  applyMigrations(db);
  db.database.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at)
    values ('org_samyak', 'Samyak', 'samyak', 'active', '${NOW}', '${NOW}');
    insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
    values
      ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}'),
      ('branch_wadala', 'org_samyak', 'Wadala', 'WAD', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}');
    insert into roles (id, organisation_id, code, name, created_at)
    values
      ('role_owner', 'org_samyak', 'owner', 'Owner', '${NOW}'),
      ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '${NOW}');
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, date_of_birth, status, created_at, updated_at)
    values
      ('person_owner', 'org_samyak', 'branch_sion', 'Owner User', 'Owner', null, 'active', '${NOW}', '${NOW}'),
      ('person_counsellor', 'org_samyak', 'branch_sion', 'Counsellor User', 'Counsellor', null, 'active', '${NOW}', '${NOW}'),
      ('person_wadala', 'org_samyak', 'branch_wadala', 'Wadala User', 'Wadala', null, 'active', '${NOW}', '${NOW}'),
      ('person_a', 'org_samyak', 'branch_sion', 'Asha Student', 'Asha', null, 'active', '${NOW}', '${NOW}'),
      ('person_b', 'org_samyak', 'branch_sion', 'Ravi Student', 'Ravi', null, 'active', '${NOW}', '${NOW}');
    insert into person_identity_details (person_id, official_full_name, date_of_birth, created_at, updated_at)
    values ('person_a', 'Asha Student', '2001-01-01', '${NOW}', '${NOW}'), ('person_b', 'Ravi Student', '2002-02-02', '${NOW}', '${NOW}');
    insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
    values
      ('acct_owner', 'org_samyak', 'owner_hash', 'owner_hash', '1111', 1, 'active', '${NOW}', '${NOW}'),
      ('acct_counsellor', 'org_samyak', 'counsellor_hash', 'counsellor_hash', '2222', 1, 'active', '${NOW}', '${NOW}'),
      ('acct_wadala', 'org_samyak', 'wadala_hash', 'wadala_hash', '3333', 1, 'active', '${NOW}', '${NOW}');
    insert into login_account_people (login_account_id, person_id, access_type, is_default, created_at)
    values ('acct_owner', 'person_owner', 'staff', 1, '${NOW}');
    insert into login_account_roles (login_account_id, role_id, branch_id, created_at)
    values
      ('acct_owner', 'role_owner', null, '${NOW}'),
      ('acct_counsellor', 'role_counsellor', 'branch_sion', '${NOW}'),
      ('acct_wadala', 'role_counsellor', 'branch_wadala', '${NOW}');
    insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
    values ('course_excel', 'org_samyak', 'AEX', 'Advanced Excel', '3 months', 3, 1000000, 800000, 1, 0, 'active', '${NOW}', '${NOW}');
    insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
    values
      ('student_a', 'org_samyak', 'person_a', 'branch_sion', 'SYK-SION-0001', 1, '2026-08-01', 'active', 'active', '${NOW}', '${NOW}'),
      ('student_b', 'org_samyak', 'person_b', 'branch_sion', 'SYK-SION-0002', 2, '2026-08-01', 'active', 'active', '${NOW}', '${NOW}');
    insert into enrolments (id, student_id, branch_id, course_id, enrolment_number, training_mode, admission_date, joining_date, status, nsdc_preference, created_at, updated_at)
    values
      ('enrol_a', 'student_a', 'branch_sion', 'course_excel', 'ENR-SION-0001', 'classroom', '2026-08-01', '2026-08-02', 'confirmed', 'no', '2026-09-01T00:00:00.000Z', '${NOW}'),
      ('enrol_b', 'student_b', 'branch_sion', 'course_excel', 'ENR-SION-0002', 'classroom', '2026-08-01', '2026-08-02', 'confirmed', 'no', '2026-09-02T00:00:00.000Z', '${NOW}');
    insert into fee_agreements (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
    values
      ('fee_a', 'enrol_a', 1000000, 1000000, 0, 'two_instalments', 2, 500000, 'active', '${NOW}', '${NOW}'),
      ('fee_b', 'enrol_b', 1000000, 1000000, 0, 'two_instalments', 2, 500000, 'active', '${NOW}', '${NOW}');
    insert into fee_agreement_instalments (id, fee_agreement_id, instalment_number, amount_paise, due_date, created_at)
    values
      ('inst_a1', 'fee_a', 1, 500000, '2026-08-01', '${NOW}'),
      ('inst_a2', 'fee_a', 2, 500000, '2026-09-01', '${NOW}'),
      ('inst_b1', 'fee_b', 1, 300000, '2026-09-08', '${NOW}'),
      ('inst_b2', 'fee_b', 2, 700000, '2026-09-15', '${NOW}');
    insert into receipts (id, organisation_id, branch_id, receipt_number, receipt_year, person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode, status, created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at)
    values
      ('receipt_a1', 'org_samyak', 'branch_sion', 'RCP-SION-2026-000001', 2026, 'person_a', 'student_a', 'enrol_a', 'fee_a', 500000, '2026-08-01T09:00:00.000Z', 'cash', 'recorded', 'acct_owner', 'idem_a1', 'fp_a1', '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z'),
      ('receipt_a2', 'org_samyak', 'branch_sion', 'RCP-SION-2026-000002', 2026, 'person_a', 'student_a', 'enrol_a', 'fee_a', 200000, '2026-09-02T09:00:00.000Z', 'upi', 'recorded', 'acct_owner', 'idem_a2', 'fp_a2', '2026-09-02T09:00:00.000Z', '2026-09-02T09:00:00.000Z');
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
  return staffForRole("owner", "acct_owner");
}

function staffForRole(role: string, loginAccountId = `acct_${role}`): StaffContext {
  return { loginAccountId, activePersonId: `person_${role}`, roles: [role] };
}
