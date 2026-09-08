import { z } from "zod";
import { ORG_ID, mobileHash } from "./auth-store";
import { createOpaqueId, decryptText } from "./crypto";
import type { AppContext } from "./http";
import { normalizeIndianMobile } from "./mobile";
import { ADMISSION_STAFF_ROLES, type StaffContext } from "./staff-auth";
import { allocateInstalments, financialSummaryFromReceipts, type LedgerInstalment } from "./payments-ledger";

export const COLLECTION_STAFF_ROLES = ADMISSION_STAFF_ROLES;
const COLLECTION_SCAN_LIMIT = 500;

const followupTypeSchema = z.enum(["call", "whatsapp", "in_person", "other"]);
const followupOutcomeSchema = z.enum(["contacted", "not_reachable", "promised_payment", "paid_or_receipt_pending", "dispute_or_query", "follow_up_later"]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const collectionQuerySchema = z.object({
  status: z.enum(["due_today", "overdue", "upcoming", "promise_due", "no_follow_up", "paid", "all"]).default("overdue"),
  agingBucket: z.enum(["1-7", "8-15", "16-30", "31-60", "60+"]).optional().or(z.literal("")),
  branchId: z.string().trim().max(120).optional().or(z.literal("")),
  courseId: z.string().trim().max(120).optional().or(z.literal("")),
  search: z.string().trim().max(120).optional().or(z.literal("")),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createCollectionFollowupSchema = z
  .object({
    followupType: followupTypeSchema,
    outcome: followupOutcomeSchema,
    note: z.string().trim().max(1000).optional().or(z.literal("")),
    promisedPaymentDate: isoDateSchema.optional().nullable().or(z.literal("")),
    promisedAmountPaise: z.coerce.number().int().positive().optional().nullable(),
    nextFollowUpAt: z.string().trim().max(40).optional().nullable().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === "promised_payment" && !value.promisedPaymentDate) {
      ctx.addIssue({ code: "custom", path: ["promisedPaymentDate"], message: "Promise date is required." });
    }
    if (value.nextFollowUpAt && Number.isNaN(Date.parse(value.nextFollowUpAt))) {
      ctx.addIssue({ code: "custom", path: ["nextFollowUpAt"], message: "Enter a valid follow-up date." });
    }
  });

export type CollectionQuery = z.infer<typeof collectionQuerySchema>;
type FollowupInput = z.infer<typeof createCollectionFollowupSchema>;

type EnrolmentCollectionRow = {
  enrolment_id: string;
  enrolment_number: string;
  enrolment_status: string;
  branch_id: string;
  branch_name: string | null;
  branch_code: string | null;
  student_id: string;
  student_number: string;
  person_id: string;
  student_name: string;
  student_status: string;
  course_id: string;
  course_code: string | null;
  course_name: string;
  fee_agreement_id: string;
  final_agreed_fee_paise: number;
  payment_plan_type: string;
  number_of_instalments: number | null;
  primary_contact_id: string | null;
  mobile_last_four: string | null;
  is_whatsapp: number | null;
  mobile_ciphertext: string | null;
  call_url?: string;
  whatsapp_url?: string;
};

type ReceiptRow = {
  id: string;
  receipt_number: string;
  amount_paise: number;
  received_at: string;
  payment_mode: string;
  payment_reference: string | null;
  notes: string | null;
  status: "recorded";
  payload_fingerprint: string;
  created_at: string;
  recorded_by: string | null;
};

type InstalmentRow = {
  fee_agreement_id: string;
  instalment_number: number;
  amount_paise: number;
  due_date: string | null;
};

type FollowupRow = {
  id: string;
  branch_id: string;
  student_id: string;
  enrolment_id: string;
  followup_type: string;
  outcome: string;
  note: string;
  promised_payment_date: string | null;
  promised_amount_paise: number | null;
  next_follow_up_at: string | null;
  created_by_login_account_id: string;
  created_at: string;
  created_by_name: string | null;
};

type CollectionFailure = { ok: false; status: number; code: string; message: string; fieldErrors?: Record<string, string[]> };

export type CollectionInstallment = LedgerInstalment & {
  label: "Paid" | "Part Paid" | "Due Today" | "Overdue" | "Upcoming" | "Pending";
  daysOverdue: number;
};

export type CollectionSummary = {
  agreedFeePaise: number;
  receivedPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  dueTodayPaise: number;
  nextDueDate: string | null;
  daysOverdue: number;
  agingBucket: string | null;
  lastPaymentAt: string | null;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  promiseDate: string | null;
  promiseAmountPaise: number | null;
  promiseMissed: boolean;
  fullyPaid: boolean;
};

export type CollectionItem = {
  enrolmentId: string;
  enrolmentNumber: string;
  enrolmentStatus: string;
  branchId: string;
  branchName: string;
  studentId: string;
  studentNumber: string;
  studentName: string;
  studentStatus: string;
  courseId: string;
  courseName: string;
  mobileDisplay: string | null;
  callUrl: string | null;
  whatsappUrl: string | null;
  summary: CollectionSummary;
  flags: string[];
};

export type CollectionFollowup = {
  id: string;
  followupType: string;
  outcome: string;
  note: string;
  promisedPaymentDate: string | null;
  promisedAmountPaise: number | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  recordedBy: string | null;
};

export type CollectionTimelineEvent = {
  id: string;
  type: "receipt" | "followup" | "promise_missed" | "next_followup";
  occurredAt: string;
  label: string;
  amountPaise: number | null;
  note: string | null;
  metadata: Record<string, unknown>;
};

export async function listCollections(c: AppContext, staff: StaffContext, query: CollectionQuery) {
  const today = indiaDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const base = await collectionRows(c, staff, query, Math.max(query.limit + query.offset + 1, COLLECTION_SCAN_LIMIT));
  const feeIds = base.map((row) => row.fee_agreement_id);
  const enrolmentIds = base.map((row) => row.enrolment_id);
  const [instalments, receipts, followups, collectedThisMonth] = await Promise.all([
    instalmentsByFee(c, feeIds),
    receiptsByEnrolment(c, enrolmentIds),
    followupsByEnrolment(c, enrolmentIds),
    collectedSince(c, staff, monthStart),
  ]);
  const allItems = base.map((row) => mapCollectionItem(row, instalments.get(row.fee_agreement_id) || [], receipts.get(row.enrolment_id) || [], followups.get(row.enrolment_id) || [], today));
  const filtered = allItems.filter((item) => matchesOperationalFilter(item, query.status, query.agingBucket || ""));
  const page = filtered.slice(query.offset, query.offset + query.limit);
  const overviewItems = allItems.filter((item) => !item.summary.fullyPaid);
  return {
    success: true as const,
    today,
    filters: query,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      hasMore: filtered.length > query.offset + query.limit || base.length > query.limit + query.offset,
      total: filtered.length,
    },
    overview: {
      totalOutstandingPaise: sum(overviewItems, (item) => item.summary.outstandingPaise),
      dueTodayPaise: sum(overviewItems, (item) => item.summary.dueTodayPaise),
      overduePaise: sum(overviewItems, (item) => item.summary.overduePaise),
      collectedThisMonthPaise: collectedThisMonth,
      promisesDueToday: overviewItems.filter((item) => item.summary.promiseDate === today).length,
    },
    sections: {
      needsAttention: overviewItems.filter((item) => item.flags.length > 0).slice(0, 8),
      dueToday: overviewItems.filter((item) => item.summary.dueTodayPaise > 0).slice(0, 8),
      overdue: overviewItems.filter((item) => item.summary.overduePaise > 0).sort((a, b) => b.summary.daysOverdue - a.summary.daysOverdue).slice(0, 8),
      upcoming: overviewItems.filter((item) => item.summary.nextDueDate && item.summary.nextDueDate > today && item.summary.nextDueDate <= addIndiaDays(today, 7)).slice(0, 8),
      recentCollections: recentCollections(receipts),
    },
    items: page,
  };
}

export async function getCollectionDetail(c: AppContext, staff: StaffContext, enrolmentId: string): Promise<{ ok: true; success: true; today: string; item: CollectionItem; installments: CollectionInstallment[]; receipts: ReturnType<typeof publicReceipt>[]; followups: CollectionFollowup[]; timeline: CollectionTimelineEvent[]; receiptCorrection: { supported: false; message: string } } | CollectionFailure> {
  const row = await collectionRowByEnrolment(c, staff, enrolmentId);
  if (!row) return { ok: false, status: 404, code: "collection_not_found", message: "Collection record was not found." };
  const today = indiaDate();
  const [instalments, receipts, followups] = await Promise.all([
    instalmentsByFee(c, [row.fee_agreement_id]),
    receiptsByEnrolment(c, [row.enrolment_id]),
    followupsByEnrolment(c, [row.enrolment_id]),
  ]);
  const item = mapCollectionItem(row, instalments.get(row.fee_agreement_id) || [], receipts.get(row.enrolment_id) || [], followups.get(row.enrolment_id) || [], today);
  const installmentRows = collectionInstallments(Number(row.final_agreed_fee_paise || 0), instalments.get(row.fee_agreement_id) || [], receipts.get(row.enrolment_id) || [], today);
  const receiptRows = (receipts.get(row.enrolment_id) || []).slice().reverse().map(publicReceipt);
  const followupRows = (followups.get(row.enrolment_id) || []).map(publicFollowup);
  return {
    ok: true,
    success: true,
    today,
    item,
    installments: installmentRows,
    receipts: receiptRows,
    followups: followupRows,
    timeline: collectionTimeline(receiptRows, followupRows, item.summary, today),
    receiptCorrection: {
      supported: false,
      message: "Receipt amounts and dates are immutable in the current ledger. Use owner review until a reversal workflow exists.",
    },
  };
}

export async function createCollectionFollowup(c: AppContext, staff: StaffContext, enrolmentId: string, input: FollowupInput): Promise<{ ok: true; success: true; followup: CollectionFollowup } | CollectionFailure> {
  const row = await collectionRowByEnrolment(c, staff, enrolmentId);
  if (!row) return { ok: false, status: 404, code: "collection_not_found", message: "Collection record was not found." };
  const now = new Date().toISOString();
  const id = createOpaqueId("collfu");
  await c.env.DB.prepare(
    `insert into collection_followups
       (id, organisation_id, branch_id, student_id, enrolment_id, followup_type, outcome, note, promised_payment_date, promised_amount_paise, next_follow_up_at, created_by_login_account_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      ORG_ID,
      row.branch_id,
      row.student_id,
      row.enrolment_id,
      input.followupType,
      input.outcome,
      input.note?.trim() || "",
      input.promisedPaymentDate || null,
      input.promisedAmountPaise || null,
      input.nextFollowUpAt ? normalizeDateTime(input.nextFollowUpAt) : null,
      staff.loginAccountId,
      now,
    )
    .run();
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, 'collection_followup_created', 'collection_followup', ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, row.branch_id, staff.loginAccountId, staff.activePersonId, id, JSON.stringify({ enrolmentId, studentId: row.student_id, outcome: input.outcome, followupType: input.followupType }), now)
    .run();
  const followup = await c.env.DB.prepare(
    `select collection_followups.*, coalesce(actor_people.public_name, actor_people.full_name) as created_by_name
     from collection_followups
     left join login_account_people on login_account_people.login_account_id = collection_followups.created_by_login_account_id
       and login_account_people.is_default = 1
     left join people actor_people on actor_people.id = login_account_people.person_id
     where collection_followups.id = ?`,
  )
    .bind(id)
    .first<FollowupRow>();
  return { ok: true, success: true, followup: publicFollowup(followup!) };
}

export function collectionInstallments(finalAgreedFeePaise: number, instalments: InstalmentRow[], receipts: ReceiptRow[], today: string): CollectionInstallment[] {
  const schedule = instalments.map((row) => ({ instalmentNumber: Number(row.instalment_number), amountPaise: Number(row.amount_paise), dueDate: row.due_date || null }));
  const totalReceived = receipts.reduce((total, receipt) => total + Number(receipt.amount_paise || 0), 0);
  const base = schedule.length ? allocateInstalments(totalReceived, schedule) : allocateInstalments(totalReceived, [{ instalmentNumber: 1, amountPaise: finalAgreedFeePaise, dueDate: null }]);
  return base.map((instalment) => {
    const daysOverdue = instalment.dueDate && instalment.balancePaise > 0 && instalment.dueDate < today ? daysBetween(instalment.dueDate, today) : 0;
    return { ...instalment, daysOverdue, label: installmentLabel(instalment, today, daysOverdue) };
  });
}

export function agingBucket(daysOverdue: number) {
  if (daysOverdue <= 0) return null;
  if (daysOverdue <= 7) return "1-7";
  if (daysOverdue <= 15) return "8-15";
  if (daysOverdue <= 30) return "16-30";
  if (daysOverdue <= 60) return "31-60";
  return "60+";
}

export function indiaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function mapCollectionItem(row: EnrolmentCollectionRow, instalments: InstalmentRow[], receipts: ReceiptRow[], followups: FollowupRow[], today: string): CollectionItem {
  const installments = collectionInstallments(Number(row.final_agreed_fee_paise || 0), instalments, receipts, today);
  const summary = financialSummaryFromReceipts(Number(row.final_agreed_fee_paise || 0), instalments.map((item) => ({ instalmentNumber: Number(item.instalment_number), amountPaise: Number(item.amount_paise), dueDate: item.due_date || null })), receipts);
  const latestFollowup = followups[0] || null;
  const latestPromise = followups.find((item) => item.outcome === "promised_payment" && item.promised_payment_date) || null;
  const nextFollowUpAt = followups.map((item) => item.next_follow_up_at).filter(Boolean).sort()[0] || null;
  const dueTodayPaise = sum(installments.filter((item) => item.dueDate === today && item.balancePaise > 0), (item) => item.balancePaise);
  const overdueInstallments = installments.filter((item) => item.daysOverdue > 0 && item.balancePaise > 0);
  const daysOverdue = overdueInstallments.reduce((max, item) => Math.max(max, item.daysOverdue), 0);
  const nextDueDate = installments.filter((item) => item.balancePaise > 0 && item.dueDate).map((item) => item.dueDate!).sort()[0] || null;
  const promiseDate = latestPromise?.promised_payment_date || null;
  const collectionSummary: CollectionSummary = {
    agreedFeePaise: summary.finalAgreedFeePaise,
    receivedPaise: summary.totalReceivedPaise,
    outstandingPaise: summary.overallBalancePaise,
    overduePaise: sum(overdueInstallments, (item) => item.balancePaise),
    dueTodayPaise,
    nextDueDate,
    daysOverdue,
    agingBucket: agingBucket(daysOverdue),
    lastPaymentAt: receipts[receipts.length - 1]?.received_at || null,
    lastFollowUpAt: latestFollowup?.created_at || null,
    nextFollowUpAt,
    promiseDate,
    promiseAmountPaise: latestPromise?.promised_amount_paise || null,
    promiseMissed: Boolean(promiseDate && promiseDate < today && summary.overallBalancePaise > 0),
    fullyPaid: summary.fullyPaid,
  };
  return {
    enrolmentId: row.enrolment_id,
    enrolmentNumber: row.enrolment_number,
    enrolmentStatus: row.enrolment_status,
    branchId: row.branch_id,
    branchName: row.branch_name || "",
    studentId: row.student_id,
    studentNumber: row.student_number,
    studentName: row.student_name,
    studentStatus: row.student_status,
    courseId: row.course_id,
    courseName: row.course_name,
    mobileDisplay: row.mobile_last_four ? `******${row.mobile_last_four}` : null,
    callUrl: row.call_url || null,
    whatsappUrl: row.whatsapp_url || null,
    summary: collectionSummary,
    flags: collectionFlags(collectionSummary, latestFollowup, today),
  };
}

async function collectionRows(c: AppContext, staff: StaffContext, query: CollectionQuery, limit: number) {
  const bindings: unknown[] = [ORG_ID, ORG_ID, ORG_ID, ORG_ID];
  let where = "students.organisation_id = ? and people.organisation_id = ? and courses.organisation_id = ? and branches.organisation_id = ? and people.status != 'archived' and fee_agreements.status = 'active'";
  where += branchScopeSql(staff, "enrolments.branch_id", bindings);
  if (query.branchId) {
    where += " and enrolments.branch_id = ?";
    bindings.push(query.branchId);
  }
  if (query.courseId) {
    where += " and enrolments.course_id = ?";
    bindings.push(query.courseId);
  }
  if (query.search) {
    const normalized = normalizeIndianMobile(query.search);
    const hash = normalized ? await mobileHash(c, normalized) : null;
    const like = `%${escapeLike(query.search.toLowerCase())}%`;
    where += ` and (
      lower(students.student_number) like ? escape '\\'
      or lower(enrolments.enrolment_number) like ? escape '\\'
      or lower(coalesce(person_identity_details.official_full_name, people.full_name, people.public_name, '')) like ? escape '\\'
      or lower(courses.name) like ? escape '\\'
      or lower(coalesce(courses.code, '')) like ? escape '\\'
      ${hash ? "or primary_mobile.normalized_value = ?" : ""}
    )`;
    bindings.push(like, like, like, like, like);
    if (hash) bindings.push(hash);
  }
  const rows = await c.env.DB.prepare(`${collectionBaseSql()} where ${where} order by enrolments.created_at desc limit ?`)
    .bind(...bindings, limit)
    .all<EnrolmentCollectionRow>();
  return hydrateContactUrls(c, rows.results || []);
}

async function collectionRowByEnrolment(c: AppContext, staff: StaffContext, enrolmentId: string) {
  const bindings: unknown[] = [ORG_ID, ORG_ID, ORG_ID, ORG_ID];
  let where = "students.organisation_id = ? and people.organisation_id = ? and courses.organisation_id = ? and branches.organisation_id = ? and people.status != 'archived' and fee_agreements.status = 'active' and enrolments.id = ?";
  bindings.push(enrolmentId);
  where += branchScopeSql(staff, "enrolments.branch_id", bindings);
  const row = await c.env.DB.prepare(`${collectionBaseSql()} where ${where} limit 1`).bind(...bindings).first<EnrolmentCollectionRow>();
  const rows = await hydrateContactUrls(c, row ? [row] : []);
  return rows[0] || null;
}

function collectionBaseSql() {
  return `select enrolments.id as enrolment_id, enrolments.enrolment_number, enrolments.status as enrolment_status,
            enrolments.branch_id, branches.name as branch_name, branches.code as branch_code,
            students.id as student_id, students.student_number, students.person_id, students.current_status as student_status,
            coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as student_name,
            courses.id as course_id, courses.code as course_code, courses.name as course_name,
            fee_agreements.id as fee_agreement_id, fee_agreements.final_agreed_fee_paise, fee_agreements.payment_plan_type, fee_agreements.number_of_instalments,
            primary_mobile.id as primary_contact_id,
            case when person_contact_details.contact_id is not null then primary_mobile.last_four else null end as mobile_last_four,
            person_contact_details.is_whatsapp,
            person_contact_secrets.value_ciphertext as mobile_ciphertext
     from enrolments
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     join branches on branches.id = enrolments.branch_id
     join courses on courses.id = enrolments.course_id
     join fee_agreements on fee_agreements.enrolment_id = enrolments.id
     left join person_contacts primary_mobile on primary_mobile.person_id = students.person_id and primary_mobile.contact_type = 'mobile' and primary_mobile.is_primary = 1
     left join person_contact_details on person_contact_details.contact_id = primary_mobile.id and coalesce(person_contact_details.status, 'active') = 'active' and (person_contact_details.valid_until is null or person_contact_details.valid_until > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     left join person_contact_secrets on person_contact_secrets.contact_id = person_contact_details.contact_id`;
}

async function hydrateContactUrls(c: AppContext, rows: EnrolmentCollectionRow[]) {
  for (const row of rows) {
    const mobile = row.primary_contact_id && row.mobile_ciphertext ? await decryptText(c.env.SESSION_PEPPER, `contact:${row.primary_contact_id}`, row.mobile_ciphertext).catch(() => null) : null;
    if (mobile && normalizeIndianMobile(mobile)) {
      row.call_url = `tel:+91${mobile}`;
      row.whatsapp_url = row.is_whatsapp === 0 ? "" : whatsappUrl(mobile, row.student_name);
    }
  }
  return rows;
}

async function instalmentsByFee(c: AppContext, feeAgreementIds: string[]) {
  const map = new Map<string, InstalmentRow[]>();
  if (!feeAgreementIds.length) return map;
  const rows = await c.env.DB.prepare(
    `select fee_agreement_id, instalment_number, amount_paise, due_date
     from fee_agreement_instalments
     where fee_agreement_id in (${placeholders(feeAgreementIds.length)})
     order by fee_agreement_id, instalment_number`,
  ).bind(...feeAgreementIds).all<InstalmentRow>();
  for (const row of rows.results || []) pushMap(map, row.fee_agreement_id, row);
  return map;
}

async function receiptsByEnrolment(c: AppContext, enrolmentIds: string[]) {
  const map = new Map<string, ReceiptRow[]>();
  if (!enrolmentIds.length) return map;
  const rows = await c.env.DB.prepare(
    `select receipts.id, receipts.receipt_number, receipts.amount_paise, receipts.received_at, receipts.payment_mode,
            receipts.payment_reference, receipts.notes, receipts.status, receipts.payload_fingerprint, receipts.created_at,
            receipts.enrolment_id, coalesce(actor_people.public_name, actor_people.full_name) as recorded_by
     from receipts
     left join login_account_people on login_account_people.login_account_id = receipts.created_by_login_account_id
       and login_account_people.is_default = 1
     left join people actor_people on actor_people.id = login_account_people.person_id
     where receipts.organisation_id = ? and receipts.enrolment_id in (${placeholders(enrolmentIds.length)}) and receipts.status = 'recorded'
     order by receipts.enrolment_id, receipts.received_at, receipts.created_at`,
  ).bind(ORG_ID, ...enrolmentIds).all<ReceiptRow & { enrolment_id: string }>();
  for (const row of rows.results || []) pushMap(map, row.enrolment_id, row);
  return map;
}

async function followupsByEnrolment(c: AppContext, enrolmentIds: string[]) {
  const map = new Map<string, FollowupRow[]>();
  if (!enrolmentIds.length) return map;
  const rows = await c.env.DB.prepare(
    `select collection_followups.*, coalesce(actor_people.public_name, actor_people.full_name) as created_by_name
     from collection_followups
     left join login_account_people on login_account_people.login_account_id = collection_followups.created_by_login_account_id
       and login_account_people.is_default = 1
     left join people actor_people on actor_people.id = login_account_people.person_id
     where collection_followups.organisation_id = ? and collection_followups.enrolment_id in (${placeholders(enrolmentIds.length)})
     order by collection_followups.enrolment_id, collection_followups.created_at desc`,
  ).bind(ORG_ID, ...enrolmentIds).all<FollowupRow>();
  for (const row of rows.results || []) pushMap(map, row.enrolment_id, row);
  return map;
}

async function collectedSince(c: AppContext, staff: StaffContext, fromDate: string) {
  const bindings: unknown[] = [ORG_ID, `${fromDate}T00:00:00.000+05:30`];
  const row = await c.env.DB.prepare(
    `select coalesce(sum(receipts.amount_paise), 0) as total
     from receipts
     join enrolments on enrolments.id = receipts.enrolment_id
     where receipts.organisation_id = ?
       and receipts.status = 'recorded'
       and receipts.received_at >= ?
       ${branchScopeSql(staff, "enrolments.branch_id", bindings)}`,
  ).bind(...bindings).first<{ total: number }>();
  return Number(row?.total || 0);
}

function branchScopeSql(staff: StaffContext, column: string, bindings: unknown[]) {
  if (staff.roles.some((role) => role === "owner" || role === "system_admin")) return "";
  bindings.push(staff.loginAccountId, ORG_ID, ...COLLECTION_STAFF_ROLES);
  return ` and exists (
    select 1 from login_account_roles lar
    join roles role_scope on role_scope.id = lar.role_id
    where lar.login_account_id = ?
      and role_scope.organisation_id = ?
      and role_scope.code in (${COLLECTION_STAFF_ROLES.map(() => "?").join(", ")})
      and (lar.branch_id is null or lar.branch_id = ${column})
  )`;
}

function matchesOperationalFilter(item: CollectionItem, status: string, aging: string) {
  if (aging && item.summary.agingBucket !== aging) return false;
  if (status === "all") return true;
  if (status === "due_today") return item.summary.dueTodayPaise > 0;
  if (status === "overdue") return item.summary.overduePaise > 0;
  if (status === "upcoming") return Boolean(item.summary.nextDueDate && item.summary.nextDueDate > indiaDate() && item.summary.nextDueDate <= addIndiaDays(indiaDate(), 7));
  if (status === "promise_due") return item.summary.promiseDate === indiaDate() || item.summary.promiseMissed;
  if (status === "no_follow_up") return item.summary.outstandingPaise > 0 && !item.summary.lastFollowUpAt;
  if (status === "paid") return item.summary.fullyPaid;
  return true;
}

function collectionFlags(summary: CollectionSummary, latestFollowup: FollowupRow | null, today: string) {
  const flags: string[] = [];
  if (summary.promiseMissed) flags.push("Promise missed");
  if (summary.nextFollowUpAt && summary.nextFollowUpAt.slice(0, 10) <= today) flags.push("Follow-up due");
  if (summary.overduePaise > 0 && !latestFollowup) flags.push("No follow-up");
  if (summary.daysOverdue >= 30) flags.push("30+ days overdue");
  if (summary.overduePaise > 0 && latestFollowup && daysBetween(latestFollowup.created_at.slice(0, 10), today) >= 7) flags.push("No recent contact");
  return flags;
}

function collectionTimeline(receipts: ReturnType<typeof publicReceipt>[], followups: CollectionFollowup[], summary: CollectionSummary, today: string) {
  const events: CollectionTimelineEvent[] = [
    ...receipts.map((receipt) => ({ id: receipt.id, type: "receipt" as const, occurredAt: receipt.receivedAt, label: `Receipt ${receipt.receiptNumber}`, amountPaise: receipt.amountPaise, note: null, metadata: { paymentMode: receipt.paymentMode, paymentReference: receipt.paymentReference, recordedBy: receipt.recordedBy } })),
    ...followups.map((followup) => ({ id: followup.id, type: "followup" as const, occurredAt: followup.createdAt, label: followup.outcome, amountPaise: followup.promisedAmountPaise, note: followup.note || null, metadata: { followupType: followup.followupType, promisedPaymentDate: followup.promisedPaymentDate, nextFollowUpAt: followup.nextFollowUpAt, recordedBy: followup.recordedBy } })),
  ];
  if (summary.promiseMissed && summary.promiseDate) {
    events.push({ id: `promise_missed_${summary.promiseDate}`, type: "promise_missed", occurredAt: `${today}T00:00:00.000+05:30`, label: "Promise Missed", amountPaise: summary.promiseAmountPaise, note: null, metadata: { promisedPaymentDate: summary.promiseDate } });
  }
  if (summary.nextFollowUpAt) {
    events.push({ id: `next_followup_${summary.nextFollowUpAt}`, type: "next_followup", occurredAt: summary.nextFollowUpAt, label: "Next Follow-up", amountPaise: null, note: null, metadata: {} });
  }
  return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function recentCollections(receipts: Map<string, ReceiptRow[]>) {
  return [...receipts.values()].flat().slice().sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 8).map(publicReceipt);
}

function publicReceipt(receipt: ReceiptRow) {
  return {
    id: receipt.id,
    receiptNumber: receipt.receipt_number,
    amountPaise: Number(receipt.amount_paise),
    receivedAt: receipt.received_at,
    paymentMode: receipt.payment_mode,
    paymentReference: receipt.payment_reference || null,
    notes: receipt.notes || null,
    status: "recorded" as const,
    recordedBy: receipt.recorded_by || null,
  };
}

function publicFollowup(row: FollowupRow): CollectionFollowup {
  return {
    id: row.id,
    followupType: row.followup_type,
    outcome: row.outcome,
    note: row.note || "",
    promisedPaymentDate: row.promised_payment_date || null,
    promisedAmountPaise: row.promised_amount_paise ? Number(row.promised_amount_paise) : null,
    nextFollowUpAt: row.next_follow_up_at || null,
    createdAt: row.created_at,
    recordedBy: row.created_by_name || null,
  };
}

function installmentLabel(instalment: LedgerInstalment, today: string, daysOverdue: number): CollectionInstallment["label"] {
  if (instalment.status === "paid") return "Paid";
  if (daysOverdue > 0) return "Overdue";
  if (instalment.dueDate === today) return "Due Today";
  if (instalment.dueDate && instalment.dueDate > today) return "Upcoming";
  if (instalment.status === "part_paid") return "Part Paid";
  return "Pending";
}

function whatsappUrl(mobile: string, name: string) {
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const message = `Hi ${firstName}, this is Samyak Computer Classes. We wanted to follow up regarding your pending course fee. Please let us know when we can connect. Thank you.`;
  return `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`;
}

function normalizeDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function daysBetween(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000));
}

function addIndiaDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function pushMap<T>(map: Map<string, T[]>, key: string, item: T) {
  const items = map.get(key) || [];
  items.push(item);
  map.set(key, items);
}

function sum<T>(items: T[], value: (item: T) => number) {
  return items.reduce((total, item) => total + value(item), 0);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
