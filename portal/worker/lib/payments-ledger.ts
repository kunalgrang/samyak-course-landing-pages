import { z } from "zod";
import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { createOpaqueId, hmacHex } from "./crypto";
import { ADMISSION_STAFF_ROLES, canBackdateReceipts, canRecordReceipts, type StaffContext } from "./staff-auth";

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
  amount_paise: number;
  received_at: string;
  payment_mode: string;
  payment_reference: string | null;
  notes: string | null;
  status: "recorded";
  payload_fingerprint: string;
  created_at?: string;
  created_by_name?: string | null;
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
  status: "recorded";
  recordedBy: string | null;
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
};

type ServiceFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

type ReceiptInput = z.infer<typeof recordEnrolmentReceiptSchema>;

export function financialSummaryFromReceipts(finalAgreedFeePaise: number, instalments: Array<{ instalmentNumber: number; amountPaise: number; dueDate: string | null }>, receipts: ReceiptRecord[]): FinancialSummary {
  const totalReceivedPaise = receipts.reduce((total, receipt) => total + Number(receipt.amount_paise || 0), 0);
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
    receiptCount: receipts.length,
    instalments: allocated,
    tokenReceipt: receipts[0] ? publicReceipt(receipts[0], false) : null,
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
  const ledger = await ledgerForRecord(c, enrolment, true);
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
         where organisation_id = ?
           and enrolment_id = ?
           and fee_agreement_id = ?
           and status = 'recorded'
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

async function ledgerForRecord(c: AppContext, enrolment: EnrolmentLedgerRecord, includeHistory: boolean): Promise<PaymentLedger> {
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
      `select receipts.id, receipts.receipt_number, receipts.amount_paise, receipts.received_at, receipts.payment_mode,
              receipts.payment_reference, receipts.notes, receipts.status, receipts.payload_fingerprint, receipts.created_at,
              coalesce(actor_people.public_name, actor_people.full_name) as created_by_name
       from receipts
       left join login_account_people on login_account_people.login_account_id = receipts.created_by_login_account_id
         and login_account_people.is_default = 1
       left join people actor_people on actor_people.id = login_account_people.person_id
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
  if (input.receivedAt && Number.isNaN(Date.parse(input.receivedAt))) {
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
  return {
    id: receipt.id,
    receiptNumber: receipt.receipt_number,
    amountPaise: Number(receipt.amount_paise),
    receivedAt: receipt.received_at,
    paymentMode: receipt.payment_mode,
    paymentReference: includeOperationalFields ? receipt.payment_reference || null : receipt.payment_reference || null,
    notes: includeOperationalFields ? receipt.notes || null : undefined,
    status: "recorded",
    recordedBy: receipt.created_by_name || null,
  };
}

async function receiptById(c: AppContext, receiptId: string) {
  return c.env.DB.prepare(
    `select id, receipt_number, amount_paise, received_at, payment_mode, payment_reference, notes, status, payload_fingerprint, created_at
     from receipts where id = ?`,
  )
    .bind(receiptId)
    .first<ReceiptRecord>();
}

async function receiptByIdempotencyKey(c: AppContext, staff: StaffContext, idempotencyKey: string) {
  return c.env.DB.prepare(
    `select id, receipt_number, amount_paise, received_at, payment_mode, payment_reference, notes, status, payload_fingerprint, created_at
     from receipts
     where organisation_id = ? and created_by_login_account_id = ? and idempotency_key = ?
     limit 1`,
  )
    .bind(ORG_ID, staff.loginAccountId, idempotencyKey)
    .first<ReceiptRecord>();
}

function normalizedReceivedAt(value: string | undefined) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
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
