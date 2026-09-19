import { z } from "zod";
import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { createOpaqueId, hmacHex } from "./crypto";
import { ADMISSION_STAFF_ROLES, canBackdateReceipts, canRecordReceipts, canReverseReceipts, type StaffContext } from "./staff-auth";

const positivePaiseSchema = z.coerce.number().int().positive();
const paymentModeSchema = z.enum(["cash", "upi", "card", "bank_transfer", "cheque", "other"]);

export const recordEnrolmentReceiptSchema = z.object({
  amountPaise: positivePaiseSchema,
  receivedAt: z.string().trim().max(40).optional(),
  paymentMode: paymentModeSchema,
  paymentReference: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/),
});

export const reverseReceiptSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  expectedReceiptVersion: z.string().trim().min(16).max(240),
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/),
});

type EnrolmentLedgerRecord = {
  enrolment_id: string;
  enrolment_number: string;
  enrolment_status: string;
  branch_id: string;
  branch_code: string | null;
  branch_name: string | null;
  branch_timezone: string | null;
  person_id: string;
  student_id: string;
  student_number: string;
  student_name: string;
  course_id: string;
  course_code: string | null;
  course_name: string;
  enquiry_id: string | null;
  referral_id: string | null;
  referrer_profile_id: string | null;
  fee_agreement_id: string;
  final_agreed_fee_paise: number;
  fee_agreement_status: string;
};

type ReceiptRecord = {
  id: string;
  receipt_number: string;
  enrolment_id?: string | null;
  fee_agreement_id?: string | null;
  branch_id?: string | null;
  person_id?: string | null;
  student_id?: string | null;
  amount_paise: number;
  received_at: string;
  payment_mode: string;
  payment_reference: string | null;
  notes: string | null;
  status: "recorded";
  payload_fingerprint: string;
  created_at?: string;
  created_by_name?: string | null;
  reversal_id?: string | null;
  reversal_reason?: string | null;
  reversed_at?: string | null;
  reversed_by_name?: string | null;
};

export type LedgerInstalmentStatus = "paid" | "part_paid" | "pending";

export type LedgerInstalment = {
  instalmentNumber: number;
  requiredPaise: number;
  allocatedReceivedPaise: number;
  balancePaise: number;
  status: LedgerInstalmentStatus;
  dueDate: string | null;
};

export type FinancialSummary = {
  finalAgreedFeePaise: number;
  totalReceivedPaise: number;
  overallBalancePaise: number;
  firstInstalmentRequiredPaise: number;
  firstInstalmentReceivedPaise: number;
  firstInstalmentBalancePaise: number;
  classStartEligible: boolean;
  fullyPaid: boolean;
  receiptCount: number;
  instalments: LedgerInstalment[];
  tokenReceipt: PublicReceipt | null;
};

export type PublicReceipt = {
  id: string;
  receiptNumber: string;
  amountPaise: number;
  receivedAt: string;
  paymentMode: string;
  paymentReference: string | null;
  notes?: string | null;
  status: "recorded" | "reversed";
  recordedBy: string | null;
  correctionVersion: string;
  reversal: {
    id: string;
    reason: string;
    reversedAt: string;
    reversedBy: string | null;
  } | null;
};

export type PaymentLedger = {
  enrolment: {
    id: string;
    enrolmentNumber: string;
    status: string;
    branchName: string | null;
    studentId: string;
    studentNumber: string;
    studentName: string;
    courseId: string;
    courseCode: string | null;
    courseName: string;
  };
  financialSummary: FinancialSummary;
  receipts: PublicReceipt[];
  receiptCorrection: {
    canReverse: boolean;
    reasonRequired: true;
    ownerOnly: true;
  };
};

type ServiceFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

type ReceiptInput = z.infer<typeof recordEnrolmentReceiptSchema>;
type ReversalInput = z.infer<typeof reverseReceiptSchema>;
export type ReceiptReversalInput = ReversalInput;

export function financialSummaryFromReceipts(finalAgreedFeePaise: number, instalments: Array<{ instalmentNumber: number; amountPaise: number; dueDate: string | null }>, receipts: ReceiptRecord[]): FinancialSummary {
  const effectiveReceipts = receipts.filter((receipt) => !receipt.reversal_id);
  const totalReceivedPaise = effectiveReceipts.reduce((total, receipt) => total + Number(receipt.amount_paise || 0), 0);
  const allocated = allocateInstalments(totalReceivedPaise, instalments);
  const first = allocated[0];
  const firstInstalmentRequiredPaise = first?.requiredPaise || finalAgreedFeePaise;
  const firstInstalmentReceivedPaise = Math.min(totalReceivedPaise, firstInstalmentRequiredPaise);
  return {
    finalAgreedFeePaise,
    totalReceivedPaise,
    overallBalancePaise: Math.max(0, finalAgreedFeePaise - totalReceivedPaise),
    firstInstalmentRequiredPaise,
    firstInstalmentReceivedPaise,
    firstInstalmentBalancePaise: Math.max(0, firstInstalmentRequiredPaise - firstInstalmentReceivedPaise),
    classStartEligible: firstInstalmentRequiredPaise > 0 && totalReceivedPaise >= firstInstalmentRequiredPaise,
    fullyPaid: finalAgreedFeePaise > 0 && totalReceivedPaise === finalAgreedFeePaise,
    receiptCount: effectiveReceipts.length,
    instalments: allocated,
    tokenReceipt: effectiveReceipts[0] ? publicReceipt(effectiveReceipts[0], false) : null,
  };
}

export function allocateInstalments(totalReceivedPaise: number, instalments: Array<{ instalmentNumber: number; amountPaise: number; dueDate: string | null }>): LedgerInstalment[] {
  let remainingReceived = Math.max(0, totalReceivedPaise);
  return instalments
    .slice()
    .sort((a, b) => a.instalmentNumber - b.instalmentNumber)
    .map((instalment) => {
      const requiredPaise = Number(instalment.amountPaise || 0);
      const allocatedReceivedPaise = Math.min(requiredPaise, remainingReceived);
      remainingReceived = Math.max(0, remainingReceived - allocatedReceivedPaise);
      const balancePaise = Math.max(0, requiredPaise - allocatedReceivedPaise);
      const status: LedgerInstalmentStatus = allocatedReceivedPaise === requiredPaise ? "paid" : allocatedReceivedPaise > 0 ? "part_paid" : "pending";
      return {
        instalmentNumber: Number(instalment.instalmentNumber),
        requiredPaise,
        allocatedReceivedPaise,
        balancePaise,
        status,
        dueDate: instalment.dueDate || null,
      };
    });
}

export async function getPaymentLedger(c: AppContext, staff: StaffContext, enrolmentId: string): Promise<{ ok: true; ledger: PaymentLedger } | ServiceFailure> {
  const enrolment = await getLedgerEnrolment(c, enrolmentId);
  if (!enrolment) return { ok: false, status: 404, code: "enrolment_not_found", message: "Enrolment was not found." };
  if (!(await hasReceiptCapabilityForBranch(c, staff, enrolment.branch_id, false))) {
    return { ok: false, status: 403, code: "forbidden", message: "This role cannot view payments for this branch." };
  }
  const ledger = await ledgerForRecord(c, enrolment, true, await canReverseReceiptForBranch(c, staff, enrolment.branch_id));
  return { ok: true, ledger };
}

export async function recordEnrolmentReceipt(c: AppContext, staff: StaffContext, enrolmentId: string, input: ReceiptInput): Promise<{ ok: true; receipt: PublicReceipt; financialSummary: FinancialSummary } | ServiceFailure> {
  if (!canRecordReceipts(staff)) return { ok: false, status: 403, code: "forbidden", message: "This role cannot record receipts." };
  const enrolment = await getLedgerEnrolment(c, enrolmentId);
  if (!enrolment) return { ok: false, status: 404, code: "enrolment_not_found", message: "Enrolment was not found." };
  if (enrolment.enrolment_status !== "confirmed") return { ok: false, status: 409, code: "enrolment_not_confirmed", message: "Receipts can be recorded only for confirmed enrolments." };
  if (enrolment.fee_agreement_status !== "active") return { ok: false, status: 409, code: "fee_agreement_not_active", message: "An active fee agreement is required before recording a receipt." };
  if (!(await hasReceiptCapabilityForBranch(c, staff, enrolment.branch_id, false))) {
    return { ok: false, status: 403, code: "forbidden", message: "This role cannot record receipts for this branch." };
  }
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, status: 400, code: "invalid_receipt_amount", message: "Receipt amount must be greater than zero.", fieldErrors: { amountPaise: ["Receipt amount must be greater than zero."] } };
  }
  const paymentValidation = await validateReceiptPaymentFields(c, input, staff, enrolment.branch_id);
  if (!paymentValidation.ok) return paymentValidation;
  const existingByKey = await receiptByIdempotencyKey(c, staff, input.idempotencyKey);
  const receivedAt = input.receivedAt ? normalizedReceivedAt(input.receivedAt) : existingByKey?.received_at || normalizedReceivedAt(input.receivedAt);
  const fingerprint = await receiptPayloadFingerprint(c, enrolment, input, receivedAt);
  if (existingByKey) {
    const idempotentFingerprint = input.receivedAt ? fingerprint : await receiptPayloadFingerprint(c, enrolment, input, existingByKey.received_at);
    if (existingByKey.payload_fingerprint !== idempotentFingerprint) {
      return { ok: false, status: 409, code: "idempotency_conflict", message: "This idempotency key was already used for a different receipt payload." };
    }
    return { ok: true, receipt: publicReceipt(existingByKey, true), financialSummary: (await ledgerForRecord(c, enrolment, false)).financialSummary };
  }
  const current = await ledgerForRecord(c, enrolment, false);
  if (current.financialSummary.fullyPaid) {
    const idempotent = await idempotentReceiptResult(c, staff, enrolment, input, fingerprint);
    if (idempotent) return idempotent;
    return { ok: false, status: 409, code: "fee_fully_paid", message: "This fee is already fully paid." };
  }
  if (current.financialSummary.totalReceivedPaise + input.amountPaise > current.financialSummary.finalAgreedFeePaise) {
    const idempotent = await idempotentReceiptResult(c, staff, enrolment, input, fingerprint);
    if (idempotent) return idempotent;
    return { ok: false, status: 400, code: "receipt_exceeds_final_fee", message: "Receipt amount cannot exceed the outstanding balance.", fieldErrors: { amountPaise: ["Receipt amount cannot exceed the outstanding balance."] } };
  }

  const now = new Date().toISOString();
  const receiptYear = receiptYearFor(receivedAt, enrolment.branch_timezone || "Asia/Kolkata");
  const sequence = await allocateSequence(c, ORG_ID, enrolment.branch_id, `receipt:${receiptYear}`);
  const receiptNumber = `RCP-${String(enrolment.branch_code || "BR").toUpperCase()}-${receiptYear}-${formatSequence(sequence)}`;
  const receiptId = createOpaqueId("receipt");
  try {
    const inserted = await c.env.DB.prepare(
      `insert into receipts
         (id, organisation_id, branch_id, receipt_number, receipt_year, enquiry_id, admission_draft_id, person_id, student_id, enrolment_id, fee_agreement_id,
          amount_paise, received_at, payment_mode, payment_reference, notes, status,
          created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at)
       select ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?, ?, ?
       where (
         select coalesce(sum(amount_paise), 0)
         from receipts
         left join receipt_reversals on receipt_reversals.receipt_id = receipts.id
         where receipts.organisation_id = ?
           and receipts.enrolment_id = ?
           and receipts.fee_agreement_id = ?
           and receipts.status = 'recorded'
           and receipt_reversals.id is null
       ) + ? <= ?`,
    )
      .bind(
        receiptId,
        ORG_ID,
        enrolment.branch_id,
        receiptNumber,
        receiptYear,
        enrolment.enquiry_id,
        enrolment.person_id,
        enrolment.student_id,
        enrolment.enrolment_id,
        enrolment.fee_agreement_id,
        input.amountPaise,
        receivedAt,
        input.paymentMode,
        input.paymentReference?.trim() || null,
        input.notes?.trim() || null,
        staff.loginAccountId,
        input.idempotencyKey,
        fingerprint,
        now,
        now,
        ORG_ID,
        enrolment.enrolment_id,
        enrolment.fee_agreement_id,
        input.amountPaise,
        enrolment.final_agreed_fee_paise,
      )
      .run();
    if (!changed(inserted)) {
      const idempotent = await idempotentReceiptResult(c, staff, enrolment, input, fingerprint);
      if (idempotent) return idempotent;
      return { ok: false, status: 400, code: "receipt_exceeds_final_fee", message: "Receipt amount cannot exceed the outstanding balance.", fieldErrors: { amountPaise: ["Receipt amount cannot exceed the outstanding balance."] } };
    }
  } catch {
    const idempotent = await receiptByIdempotencyKey(c, staff, input.idempotencyKey);
    if (idempotent) {
      const idempotentFingerprint = input.receivedAt ? fingerprint : await receiptPayloadFingerprint(c, enrolment, input, idempotent.received_at);
      if (idempotent.payload_fingerprint !== idempotentFingerprint) {
        return { ok: false, status: 409, code: "idempotency_conflict", message: "This idempotency key was already used for a different receipt payload." };
      }
      return { ok: true, receipt: publicReceipt(idempotent, true), financialSummary: (await ledgerForRecord(c, enrolment, false)).financialSummary };
    }
    return { ok: false, status: 409, code: "receipt_not_recorded", message: "Receipt could not be recorded. Please retry." };
  }

  const receipt = await receiptById(c, receiptId);
  await audit(c, staff, enrolment.branch_id, "payment_receipt_recorded", "receipt", receiptId, {
    receiptId,
    receiptNumber,
    amountPaise: input.amountPaise,
    paymentMode: input.paymentMode,
    enrolmentId: enrolment.enrolment_id,
    branchId: enrolment.branch_id,
  });
  return { ok: true, receipt: publicReceipt(receipt!, true), financialSummary: (await ledgerForRecord(c, enrolment, false)).financialSummary };
}

export async function reverseEnrolmentReceipt(c: AppContext, staff: StaffContext, enrolmentId: string, receiptId: string, input: ReversalInput): Promise<{ ok: true; receipt: PublicReceipt; financialSummary: FinancialSummary } | ServiceFailure> {
  if (!canReverseReceipts(staff)) return { ok: false, status: 403, code: "forbidden", message: "This role cannot reverse receipts." };
  const enrolment = await getLedgerEnrolment(c, enrolmentId);
  if (!enrolment) return { ok: false, status: 404, code: "enrolment_not_found", message: "Enrolment was not found." };
  if (!(await canReverseReceiptForBranch(c, staff, enrolment.branch_id))) {
    return { ok: false, status: 403, code: "forbidden", message: "This role cannot reverse receipts for this branch." };
  }

  const receipt = await receiptById(c, receiptId);
  if (!receipt || receipt.enrolment_id !== enrolment.enrolment_id || receipt.fee_agreement_id !== enrolment.fee_agreement_id || receipt.branch_id !== enrolment.branch_id) {
    return { ok: false, status: 404, code: "receipt_not_found", message: "Receipt was not found for this enrolment." };
  }

  const fingerprint = await reversalPayloadFingerprint(c, receipt, input);
  const existingByKey = await reversalByIdempotencyKey(c, staff, input.idempotencyKey);
  if (existingByKey) {
    if (existingByKey.payload_fingerprint !== fingerprint) {
      return { ok: false, status: 409, code: "idempotency_conflict", message: "This idempotency key was already used for a different reversal." };
    }
    const idempotentReceipt = await receiptById(c, existingByKey.receipt_id);
    return { ok: true, receipt: publicReceipt(idempotentReceipt || receipt, true), financialSummary: (await ledgerForRecord(c, enrolment, false)).financialSummary };
  }

  const currentVersion = receiptCorrectionVersion(receipt);
  if (receipt.reversal_id) return { ok: false, status: 409, code: "receipt_already_reversed", message: "This receipt is already reversed." };
  if (input.expectedReceiptVersion !== currentVersion) {
    return { ok: false, status: 409, code: "stale_receipt", message: "Receipt state changed. Refresh before reversing." };
  }

  const now = new Date().toISOString();
  const reversalId = createOpaqueId("reversal");
  const statements = [
    c.env.DB.prepare(
      `insert into receipt_reversals
         (id, organisation_id, branch_id, receipt_id, enrolment_id, fee_agreement_id, reason, reversed_by_login_account_id, idempotency_key, payload_fingerprint, created_at)
       select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       where exists (
         select 1 from receipts
         where id = ? and organisation_id = ? and enrolment_id = ? and fee_agreement_id = ? and status = 'recorded'
       )
       and not exists (select 1 from receipt_reversals where receipt_id = ?)`,
    ).bind(reversalId, ORG_ID, enrolment.branch_id, receipt.id, enrolment.enrolment_id, enrolment.fee_agreement_id, input.reason.trim(), staff.loginAccountId, input.idempotencyKey, fingerprint, now, receipt.id, ORG_ID, enrolment.enrolment_id, enrolment.fee_agreement_id, receipt.id),
    c.env.DB.prepare(
      `insert into audit_logs
         (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       select ?, ?, ?, ?, ?, 'payment_receipt_reversed', 'receipt', ?, ?, ?
       where exists (select 1 from receipt_reversals where id = ?)`,
    ).bind(createOpaqueId("audit"), ORG_ID, enrolment.branch_id, staff.loginAccountId, staff.activePersonId, receipt.id, JSON.stringify({ receiptId: receipt.id, receiptNumber: receipt.receipt_number, reversalId, reason: input.reason.trim(), enrolmentId: enrolment.enrolment_id, branchId: enrolment.branch_id, amountPaise: receipt.amount_paise }), now, reversalId),
  ];

  const results = await c.env.DB.batch(statements);
  if (!changed(results[0])) {
    const existing = await receiptById(c, receiptId);
    if (existing?.reversal_id) return { ok: false, status: 409, code: "receipt_already_reversed", message: "This receipt is already reversed." };
    return { ok: false, status: 409, code: "receipt_not_reversed", message: "Receipt could not be reversed. Please retry." };
  }
  const reversed = await receiptById(c, receiptId);
  return { ok: true, receipt: publicReceipt(reversed!, true), financialSummary: (await ledgerForRecord(c, enrolment, false)).financialSummary };
}

async function idempotentReceiptResult(c: AppContext, staff: StaffContext, enrolment: EnrolmentLedgerRecord, input: ReceiptInput, fingerprint: string): Promise<({ ok: true; receipt: PublicReceipt; financialSummary: FinancialSummary } | ServiceFailure) | null> {
  const idempotent = await receiptByIdempotencyKey(c, staff, input.idempotencyKey);
  if (!idempotent) return null;
  const idempotentFingerprint = input.receivedAt ? fingerprint : await receiptPayloadFingerprint(c, enrolment, input, idempotent.received_at);
  if (idempotent.payload_fingerprint !== idempotentFingerprint) {
    return { ok: false, status: 409, code: "idempotency_conflict", message: "This idempotency key was already used for a different receipt payload." };
  }
  return { ok: true, receipt: publicReceipt(idempotent, true), financialSummary: (await ledgerForRecord(c, enrolment, false)).financialSummary };
}

async function getLedgerEnrolment(c: AppContext, enrolmentId: string) {
  return c.env.DB.prepare(
    `select enrolments.id as enrolment_id, enrolments.enrolment_number, enrolments.status as enrolment_status,
            enrolments.branch_id, branches.code as branch_code, branches.name as branch_name, branches.timezone as branch_timezone,
            students.person_id, students.id as student_id, students.student_number,
            coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as student_name,
            courses.id as course_id, courses.code as course_code, courses.name as course_name,
            enrolments.enquiry_id, enrolments.referral_id, enrolments.referrer_profile_id,
            fee_agreements.id as fee_agreement_id, fee_agreements.final_agreed_fee_paise, fee_agreements.status as fee_agreement_status
     from enrolments
     join students on students.id = enrolments.student_id and students.organisation_id = ?
     join people on people.id = students.person_id and people.organisation_id = ?
     left join person_identity_details on person_identity_details.person_id = people.id
     join branches on branches.id = enrolments.branch_id and branches.organisation_id = ?
     join courses on courses.id = enrolments.course_id and courses.organisation_id = ?
     join fee_agreements on fee_agreements.enrolment_id = enrolments.id
     where enrolments.id = ?
     limit 1`,
  )
    .bind(ORG_ID, ORG_ID, ORG_ID, ORG_ID, enrolmentId)
    .first<EnrolmentLedgerRecord>();
}

async function ledgerForRecord(c: AppContext, enrolment: EnrolmentLedgerRecord, includeHistory: boolean, canReverse = false): Promise<PaymentLedger> {
  const [instalmentRows, receipts] = await Promise.all([
    c.env.DB.prepare(
      `select instalment_number, amount_paise, due_date
       from fee_agreement_instalments
       where fee_agreement_id = ?
       order by instalment_number`,
    )
      .bind(enrolment.fee_agreement_id)
      .all<{ instalment_number: number; amount_paise: number; due_date: string | null }>(),
    c.env.DB.prepare(
      `select receipts.id, receipts.receipt_number, receipts.enrolment_id, receipts.fee_agreement_id, receipts.branch_id,
              receipts.person_id, receipts.student_id, receipts.amount_paise, receipts.received_at, receipts.payment_mode,
              receipts.payment_reference, receipts.notes, receipts.status, receipts.payload_fingerprint, receipts.created_at,
              coalesce(actor_people.public_name, actor_people.full_name) as created_by_name,
              receipt_reversals.id as reversal_id, receipt_reversals.reason as reversal_reason, receipt_reversals.created_at as reversed_at,
              coalesce(reversal_people.public_name, reversal_people.full_name) as reversed_by_name
       from receipts
       left join login_account_people on login_account_people.login_account_id = receipts.created_by_login_account_id
         and login_account_people.is_default = 1
       left join people actor_people on actor_people.id = login_account_people.person_id
       left join receipt_reversals on receipt_reversals.receipt_id = receipts.id
       left join login_account_people reversal_account_people on reversal_account_people.login_account_id = receipt_reversals.reversed_by_login_account_id
         and reversal_account_people.is_default = 1
       left join people reversal_people on reversal_people.id = reversal_account_people.person_id
       where receipts.organisation_id = ? and receipts.enrolment_id = ? and receipts.fee_agreement_id = ? and receipts.status = 'recorded'
       order by receipts.received_at, receipts.created_at`,
    )
      .bind(ORG_ID, enrolment.enrolment_id, enrolment.fee_agreement_id)
      .all<ReceiptRecord>(),
  ]);
  const instalments = (instalmentRows.results || []).map((row) => ({ instalmentNumber: Number(row.instalment_number), amountPaise: Number(row.amount_paise), dueDate: row.due_date || null }));
  const receiptRows = receipts.results || [];
  const summary = financialSummaryFromReceipts(Number(enrolment.final_agreed_fee_paise || 0), instalments, receiptRows);
  return {
    enrolment: {
      id: enrolment.enrolment_id,
      enrolmentNumber: enrolment.enrolment_number,
      status: enrolment.enrolment_status,
      branchName: enrolment.branch_name,
      studentId: enrolment.student_id,
      studentNumber: enrolment.student_number,
      studentName: enrolment.student_name,
      courseId: enrolment.course_id,
      courseCode: enrolment.course_code,
      courseName: enrolment.course_name,
    },
    financialSummary: summary,
    receipts: includeHistory ? receiptRows.slice().reverse().map((receipt) => publicReceipt(receipt, true)) : [],
    receiptCorrection: { canReverse, reasonRequired: true, ownerOnly: true },
  };
}

async function validateReceiptPaymentFields(c: AppContext, input: ReceiptInput, staff: StaffContext, branchId: string): Promise<ServiceFailure | { ok: true }> {
  const reference = input.paymentReference?.trim() || "";
  const notes = input.notes?.trim() || "";
  if (["upi", "card", "bank_transfer", "cheque"].includes(input.paymentMode) && !reference) {
    return { ok: false, status: 400, code: "payment_reference_required", message: "Payment reference is required for this payment mode.", fieldErrors: { paymentReference: ["Payment reference is required for this payment mode."] } };
  }
  if (input.paymentMode === "other" && !notes) {
    return { ok: false, status: 400, code: "receipt_notes_required", message: "Notes are required for other payment mode.", fieldErrors: { notes: ["Notes are required for other payment mode."] } };
  }
  if (input.receivedAt && !strictDateTime(input.receivedAt)) {
    return { ok: false, status: 400, code: "invalid_receipt_date", message: "Enter a valid receipt date.", fieldErrors: { receivedAt: ["Enter a valid receipt date."] } };
  }
  const receivedAt = normalizedReceivedAt(input.receivedAt);
  if (Date.parse(receivedAt) > Date.now()) {
    return { ok: false, status: 400, code: "future_receipt_date", message: "Receipt date cannot be in the future.", fieldErrors: { receivedAt: ["Receipt date cannot be in the future."] } };
  }
  if (!(await canBackdateReceipt(c, staff, branchId, receivedAt))) {
    return { ok: false, status: 403, code: "receipt_backdate_forbidden", message: "This role can record only current-day receipts." };
  }
  return { ok: true };
}

function publicReceipt(receipt: ReceiptRecord, includeOperationalFields: boolean): PublicReceipt {
  const reversal = receipt.reversal_id && receipt.reversal_reason && receipt.reversed_at
    ? {
        id: receipt.reversal_id,
        reason: receipt.reversal_reason,
        reversedAt: receipt.reversed_at,
        reversedBy: receipt.reversed_by_name || null,
      }
    : null;
  return {
    id: receipt.id,
    receiptNumber: receipt.receipt_number,
    amountPaise: Number(receipt.amount_paise),
    receivedAt: receipt.received_at,
    paymentMode: receipt.payment_mode,
    paymentReference: includeOperationalFields ? receipt.payment_reference || null : receipt.payment_reference || null,
    notes: includeOperationalFields ? receipt.notes || null : undefined,
    status: reversal ? "reversed" : "recorded",
    recordedBy: receipt.created_by_name || null,
    correctionVersion: receiptCorrectionVersion(receipt),
    reversal,
  };
}

async function receiptById(c: AppContext, receiptId: string) {
  return c.env.DB.prepare(
    `select receipts.id, receipts.receipt_number, receipts.enrolment_id, receipts.fee_agreement_id, receipts.branch_id,
            receipts.person_id, receipts.student_id, receipts.amount_paise, receipts.received_at, receipts.payment_mode,
            receipts.payment_reference, receipts.notes, receipts.status, receipts.payload_fingerprint, receipts.created_at,
            coalesce(actor_people.public_name, actor_people.full_name) as created_by_name,
            receipt_reversals.id as reversal_id, receipt_reversals.reason as reversal_reason, receipt_reversals.created_at as reversed_at,
            coalesce(reversal_people.public_name, reversal_people.full_name) as reversed_by_name
     from receipts
     left join login_account_people on login_account_people.login_account_id = receipts.created_by_login_account_id
       and login_account_people.is_default = 1
     left join people actor_people on actor_people.id = login_account_people.person_id
     left join receipt_reversals on receipt_reversals.receipt_id = receipts.id
     left join login_account_people reversal_account_people on reversal_account_people.login_account_id = receipt_reversals.reversed_by_login_account_id
       and reversal_account_people.is_default = 1
     left join people reversal_people on reversal_people.id = reversal_account_people.person_id
     where receipts.id = ? and receipts.organisation_id = ?`,
  )
    .bind(receiptId, ORG_ID)
    .first<ReceiptRecord>();
}

async function receiptByIdempotencyKey(c: AppContext, staff: StaffContext, idempotencyKey: string) {
  return c.env.DB.prepare(
    `select receipts.id, receipts.receipt_number, receipts.enrolment_id, receipts.fee_agreement_id, receipts.branch_id,
            receipts.person_id, receipts.student_id, receipts.amount_paise, receipts.received_at, receipts.payment_mode,
            receipts.payment_reference, receipts.notes, receipts.status, receipts.payload_fingerprint, receipts.created_at,
            receipt_reversals.id as reversal_id, receipt_reversals.reason as reversal_reason, receipt_reversals.created_at as reversed_at
     from receipts
     left join receipt_reversals on receipt_reversals.receipt_id = receipts.id
     where receipts.organisation_id = ? and receipts.created_by_login_account_id = ? and receipts.idempotency_key = ?
     limit 1`,
  )
    .bind(ORG_ID, staff.loginAccountId, idempotencyKey)
    .first<ReceiptRecord>();
}

async function reversalByIdempotencyKey(c: AppContext, staff: StaffContext, idempotencyKey: string) {
  return c.env.DB.prepare(
    `select id, receipt_id, payload_fingerprint
     from receipt_reversals
     where organisation_id = ? and reversed_by_login_account_id = ? and idempotency_key = ?
     limit 1`,
  )
    .bind(ORG_ID, staff.loginAccountId, idempotencyKey)
    .first<{ id: string; receipt_id: string; payload_fingerprint: string }>();
}

function normalizedReceivedAt(value: string | undefined) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (!strictDateTime(value)) return new Date().toISOString();
  return parsed.toISOString();
}

function strictDateTime(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const datePart = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
  const date = new Date(`${datePart}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === datePart;
}

function receiptYearFor(receivedAt: string, timeZone: string) {
  const year = new Intl.DateTimeFormat("en", { timeZone, year: "numeric" }).format(new Date(receivedAt));
  return Number(year);
}

async function canBackdateReceipt(c: AppContext, staff: StaffContext, branchId: string, receivedAt: string) {
  if (await hasReceiptCapabilityForBranch(c, staff, branchId, true)) return true;
  const received = new Date(receivedAt);
  const now = new Date();
  const kolkataDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return kolkataDay.format(received) === kolkataDay.format(now);
}

async function hasReceiptCapabilityForBranch(c: AppContext, staff: StaffContext, branchId: string, backdate: boolean) {
  const roleAllowedInSession = backdate ? canBackdateReceipts(staff) : staff.roles.some((role) => ADMISSION_STAFF_ROLES.includes(role as (typeof ADMISSION_STAFF_ROLES)[number]));
  if (!roleAllowedInSession) return false;
  const roleCodes = backdate ? ["owner", "system_admin", "admin", "admission_admin"] : ["owner", "system_admin", "admin", "admission_admin", "counsellor"];
  const placeholders = roleCodes.map(() => "?").join(", ");
  const row = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code in (${placeholders})
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     limit 1`,
  )
    .bind(staff.loginAccountId, ORG_ID, ...roleCodes, branchId)
    .first<{ ok: number }>();
  return Boolean(row);
}

export async function canReverseReceiptForBranch(c: AppContext, staff: StaffContext, branchId: string) {
  if (!canReverseReceipts(staff)) return false;
  const row = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code = 'owner'
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     limit 1`,
  )
    .bind(staff.loginAccountId, ORG_ID, branchId)
    .first<{ ok: number }>();
  return Boolean(row);
}

async function receiptPayloadFingerprint(c: AppContext, enrolment: EnrolmentLedgerRecord, input: ReceiptInput, receivedAt: string) {
  return hmacHex(
    c.env.SESSION_PEPPER,
    "enrolment-receipt",
    JSON.stringify({
      enrolmentId: enrolment.enrolment_id,
      feeAgreementId: enrolment.fee_agreement_id,
      amountPaise: input.amountPaise,
      receivedAt,
      paymentMode: input.paymentMode,
      paymentReference: input.paymentReference?.trim() || "",
      notes: input.notes?.trim() || "",
    }),
  );
}

async function reversalPayloadFingerprint(c: AppContext, receipt: ReceiptRecord, input: ReversalInput) {
  return hmacHex(
    c.env.SESSION_PEPPER,
    "receipt-reversal",
    JSON.stringify({
      receiptId: receipt.id,
      amountPaise: Number(receipt.amount_paise || 0),
      reason: input.reason.trim(),
    }),
  );
}

function receiptCorrectionVersion(receipt: ReceiptRecord) {
  return [
    "receipt",
    receipt.id,
    receipt.payload_fingerprint,
    receipt.created_at || "",
    receipt.reversal_id || "active",
    receipt.reversed_at || "",
  ].join(":");
}

async function allocateSequence(c: AppContext, organisationId: string, branchId: string, sequenceKey: string) {
  const now = new Date().toISOString();
  const id = `seq_${organisationId}_${branchId}_${sequenceKey}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
  await c.env.DB.prepare(
    `insert or ignore into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at)
     values (?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, organisationId, branchId, sequenceKey, now, now)
    .run();
  const row = await c.env.DB.prepare(
    `update number_sequences
     set next_sequence = next_sequence + 1, updated_at = ?
     where organisation_id = ? and branch_id = ? and sequence_key = ?
     returning next_sequence - 1 as sequence`,
  )
    .bind(now, organisationId, branchId, sequenceKey)
    .first<{ sequence: number }>();
  if (!row) throw new Error("Could not allocate sequence");
  return Number(row.sequence);
}

function formatSequence(sequence: number) {
  return String(sequence).padStart(6, "0");
}

async function audit(c: AppContext, staff: StaffContext, branchId: string | null, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString())
    .run();
}

function changed(result: unknown) {
  const meta = (result as { meta?: { changes?: number } } | null)?.meta;
  return Number(meta?.changes || 0) > 0;
}
