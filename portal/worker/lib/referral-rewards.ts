import { z } from "zod";
import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { createOpaqueId, hmacHex } from "./crypto";
import { calculateMinimumQualifyingPaymentPaise, selectRewardSlab, type RewardSlab } from "./referral-domain";
import type { StaffContext } from "./staff-auth";

const payoutModeSchema = z.enum(["cash", "upi", "bank_transfer", "other"]);

export const referralRewardPayoutSchema = z.object({
  paymentDate: z.string().trim().max(40),
  paymentMode: payoutModeSchema,
  paymentReference: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/),
});

export type ReferralRewardPayoutInput = z.infer<typeof referralRewardPayoutSchema>;

export type ReferralRewardStatus =
  | "awaiting_admission"
  | "admission_outside_validity"
  | "awaiting_payment"
  | "qualified"
  | "approved"
  | "paid"
  | "not_eligible"
  | "payment_data_unavailable";

export type ReferralQualification = {
  referralId: string;
  branchId: string;
  referralStatus: string;
  status: ReferralRewardStatus;
  admitted: boolean;
  admittedWithinValidityWindow: boolean;
  finalAgreedFeePaise: number | null;
  minimumFeePercentage: number | null;
  minimumQualifyingPaymentPaise: number | null;
  totalReceivedPaise: number;
  paymentThresholdMet: boolean;
  rewardEligible: boolean;
  rewardSlab: RewardSlab | null;
  rewardAmountPaise: number | null;
  courseCreditPaise: number | null;
  rewardSnapshot: RewardSnapshot | null;
  payout: RewardPayout | null;
};

export type RewardSnapshot = {
  id: string;
  referralId: string;
  enrolmentId: string;
  feeAgreementId: string;
  rewardRuleSetId: string;
  slabId: string | null;
  finalAgreedFeePaise: number;
  minimumFeePercentage: number;
  minimumQualifyingPaymentPaise: number;
  cashRewardPaise: number;
  courseCreditPaise: number;
  status: string;
  approvedAt: string | null;
};

export type RewardPayout = {
  id: string;
  amountPaise: number;
  paymentDate: string;
  paymentMode: string;
  status: "paid";
  createdAt: string;
};

type ServiceFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

type QualificationRow = {
  referral_id: string;
  organisation_id: string;
  branch_id: string;
  referral_status: string;
  submitted_at: string;
  valid_until: string;
  referral_programme_id: string;
  referrer_profile_id: string;
  validity_days: number;
  minimum_fee_percentage: number;
  enrolment_id: string | null;
  enrolment_status: string | null;
  enrolment_branch_id: string | null;
  enrolment_referrer_profile_id: string | null;
  admission_date: string | null;
  fee_agreement_id: string | null;
  final_agreed_fee_paise: number | null;
  fee_agreement_status: string | null;
  reward_rule_set_id: string | null;
  reward_snapshot_id: string | null;
  snapshot_slab_id: string | null;
  snapshot_cash_reward_paise: number | null;
  snapshot_course_credit_paise: number | null;
  snapshot_status: string | null;
  approved_at: string | null;
  payout_id: string | null;
  payout_amount_paise: number | null;
  payout_payment_date: string | null;
  payout_payment_mode: string | null;
  payout_status: "paid" | null;
  payout_created_at: string | null;
  total_received_paise: number | null;
};

export function canApproveReferralRewards(staff: Pick<StaffContext, "roles">) {
  return staff.roles.includes("owner");
}

export async function getReferralQualification(c: AppContext, referralId: string): Promise<ReferralQualification | null> {
  const row = await qualificationRow(c, referralId);
  if (!row) return null;
  const slabs = row.reward_rule_set_id ? await activeSlabs(c, row.reward_rule_set_id) : [];
  return qualificationFromRow(row, slabs);
}

export async function getReferralQualifications(c: AppContext, referralIds: string[]) {
  const uniqueIds = [...new Set(referralIds)].filter(Boolean);
  const result = new Map<string, ReferralQualification>();
  if (uniqueIds.length === 0) return result;
  const rows = await qualificationRows(c, uniqueIds);
  const ruleSetIds = [...new Set(rows.map((row) => row.reward_rule_set_id).filter((value): value is string => Boolean(value)))];
  const slabsByRuleSet = await activeSlabsByRuleSet(c, ruleSetIds);
  for (const row of rows) result.set(row.referral_id, qualificationFromRow(row, slabsByRuleSet.get(row.reward_rule_set_id || "") || []));
  return result;
}

export async function approveReferralReward(c: AppContext, staff: StaffContext, referralId: string): Promise<{ ok: true; qualification: ReferralQualification; idempotent: boolean } | ServiceFailure> {
  if (!canApproveReferralRewards(staff)) return { ok: false, status: 403, code: "forbidden", message: "Only the owner can approve referral rewards." };
  const row = await qualificationRow(c, referralId);
  if (!row) return { ok: false, status: 404, code: "referral_not_found", message: "Referral was not found." };
  const existing = await getReferralQualification(c, referralId);
  if (existing?.rewardSnapshot) return { ok: true, qualification: existing, idempotent: true };
  const slabs = row.reward_rule_set_id ? await activeSlabs(c, row.reward_rule_set_id) : [];
  const qualification = qualificationFromRow(row, slabs);
  if (!qualification.rewardEligible || !qualification.rewardSlab || !row.enrolment_id || !row.fee_agreement_id || !row.reward_rule_set_id) {
    return { ok: false, status: 409, code: "reward_not_qualified", message: "Referral reward is not qualified for approval." };
  }

  const now = new Date().toISOString();
  const snapshotId = createOpaqueId("rrwd");
  const snapshotJson = JSON.stringify({
    referralId,
    referrerProfileId: row.referrer_profile_id,
    enrolmentId: row.enrolment_id,
    feeAgreementId: row.fee_agreement_id,
    rewardRuleSetId: row.reward_rule_set_id,
    slabId: qualification.rewardSlab.id,
    finalAgreedFeePaise: qualification.finalAgreedFeePaise,
    minimumFeePercentage: qualification.minimumFeePercentage,
    minimumQualifyingPaymentPaise: qualification.minimumQualifyingPaymentPaise,
    totalReceivedPaiseAtApproval: qualification.totalReceivedPaise,
    cashRewardPaise: qualification.rewardSlab.cashRewardPaise,
    courseCreditPaise: qualification.rewardSlab.courseCreditPaise,
    approvedAt: now,
  });

  const insertResult = await c.env.DB.prepare(
    `insert or ignore into referral_reward_snapshots
        (id, referral_id, enrolment_id, fee_agreement_id, reward_rule_set_id, slab_id,
         final_agreed_fee_paise, minimum_fee_percentage, minimum_qualifying_payment_paise,
         cash_reward_paise, course_credit_paise, snapshot_version, snapshot_json, status,
         approved_by_login_account_id, approved_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'approved', ?, ?, ?)`,
  ).bind(
    snapshotId,
    referralId,
    row.enrolment_id,
    row.fee_agreement_id,
    row.reward_rule_set_id,
    qualification.rewardSlab.id,
    qualification.finalAgreedFeePaise,
    qualification.minimumFeePercentage,
    qualification.minimumQualifyingPaymentPaise,
    qualification.rewardSlab.cashRewardPaise,
    qualification.rewardSlab.courseCreditPaise,
    snapshotJson,
    staff.loginAccountId,
    now,
    now,
  ).run();
  const created = Number(insertResult.meta?.changes || insertResult.meta?.rows_written || 0) > 0;
  if (!created) return { ok: true, qualification: (await getReferralQualification(c, referralId))!, idempotent: true };

  await c.env.DB.prepare(
      `insert into audit_logs
        (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, ?, ?, ?, 'referral_reward_approved', 'referral', ?, ?, ?)`,
  ).bind(
    createOpaqueId("audit"),
    ORG_ID,
    row.branch_id,
    staff.loginAccountId,
    staff.activePersonId,
    referralId,
    JSON.stringify({
      referralId,
      rewardSnapshotId: snapshotId,
      enrolmentId: row.enrolment_id,
      slabId: qualification.rewardSlab.id,
      cashRewardPaise: qualification.rewardSlab.cashRewardPaise,
      courseCreditPaise: qualification.rewardSlab.courseCreditPaise,
    }),
    now,
  ).run();

  return { ok: true, qualification: (await getReferralQualification(c, referralId))!, idempotent: false };
}

export async function recordReferralRewardPayout(
  c: AppContext,
  staff: StaffContext,
  referralId: string,
  input: ReferralRewardPayoutInput,
): Promise<{ ok: true; qualification: ReferralQualification; payout: RewardPayout; idempotent: boolean } | ServiceFailure> {
  if (!canApproveReferralRewards(staff)) return { ok: false, status: 403, code: "forbidden", message: "Only the owner can record referral reward payouts." };
  const parsedDate = new Date(input.paymentDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { ok: false, status: 400, code: "invalid_payout_date", message: "Enter a valid payout date.", fieldErrors: { paymentDate: ["Enter a valid payout date."] } };
  }
  if (parsedDate.getTime() > Date.now()) {
    return { ok: false, status: 400, code: "future_payout_date", message: "Payout date cannot be in the future.", fieldErrors: { paymentDate: ["Payout date cannot be in the future."] } };
  }
  const reference = input.paymentReference?.trim() || "";
  const notes = input.notes?.trim() || "";
  if (["upi", "bank_transfer"].includes(input.paymentMode) && !reference) {
    return { ok: false, status: 400, code: "payout_reference_required", message: "Payment reference is required for this payout mode.", fieldErrors: { paymentReference: ["Payment reference is required for this payout mode."] } };
  }
  if (input.paymentMode === "other" && !notes) {
    return { ok: false, status: 400, code: "payout_notes_required", message: "Notes are required for other payout mode.", fieldErrors: { notes: ["Notes are required for other payout mode."] } };
  }

  const qualification = await getReferralQualification(c, referralId);
  if (!qualification) return { ok: false, status: 404, code: "referral_not_found", message: "Referral was not found." };
  if (!qualification.rewardSnapshot) return { ok: false, status: 409, code: "reward_not_approved", message: "Approve the referral reward before recording payout." };
  const payoutAmountPaise = qualification.rewardSnapshot.cashRewardPaise;
  if (payoutAmountPaise <= 0) return { ok: false, status: 409, code: "no_cash_reward", message: "This reward has no cash payout amount." };

  const fingerprint = await payoutFingerprint(c, qualification.rewardSnapshot.id, payoutAmountPaise, input);
  const existingByKey = await c.env.DB.prepare(
    `select referral_reward_payouts.id, referral_reward_payouts.payload_fingerprint
     from referral_reward_payouts
     where organisation_id = ? and paid_by_login_account_id = ? and idempotency_key = ?
     limit 1`,
  )
    .bind(ORG_ID, staff.loginAccountId, input.idempotencyKey)
    .first<{ id: string; payload_fingerprint: string }>();
  if (existingByKey) {
    if (existingByKey.payload_fingerprint !== fingerprint) return { ok: false, status: 409, code: "idempotency_conflict", message: "This idempotency key was already used for a different payout payload." };
    const replayed = await getReferralQualification(c, referralId);
    return { ok: true, qualification: replayed!, payout: replayed!.payout!, idempotent: true };
  }
  if (qualification.payout) return { ok: false, status: 409, code: "reward_already_paid", message: "This referral reward payout has already been recorded." };

  const now = new Date().toISOString();
  const payoutId = createOpaqueId("rrpay");
  const insertResult = await c.env.DB.prepare(
    `insert or ignore into referral_reward_payouts
        (id, organisation_id, branch_id, reward_snapshot_id, referral_id, amount_paise,
         payment_date, payment_mode, payment_reference, notes, status, paid_by_login_account_id,
         idempotency_key, payload_fingerprint, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`,
  ).bind(
    payoutId,
    ORG_ID,
    qualification.branchId,
    qualification.rewardSnapshot.id,
    referralId,
    payoutAmountPaise,
    parsedDate.toISOString(),
    input.paymentMode,
    reference || null,
    notes || null,
    staff.loginAccountId,
    input.idempotencyKey,
    fingerprint,
    now,
    now,
  ).run();
  const created = Number(insertResult.meta?.changes || insertResult.meta?.rows_written || 0) > 0;
  if (!created) {
    const replayed = await getReferralQualification(c, referralId);
    if (replayed?.payout) return { ok: true, qualification: replayed, payout: replayed.payout, idempotent: true };
  }

  await c.env.DB.prepare(
      `insert into audit_logs
        (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, ?, ?, ?, 'referral_reward_paid', 'referral_reward_payout', ?, ?, ?)`,
  ).bind(
    createOpaqueId("audit"),
    ORG_ID,
    qualification.branchId,
    staff.loginAccountId,
    staff.activePersonId,
    payoutId,
    JSON.stringify({
      referralId,
      rewardSnapshotId: qualification.rewardSnapshot.id,
      payoutId,
      amountPaise: payoutAmountPaise,
      paymentMode: input.paymentMode,
    }),
    now,
  ).run();

  const next = await getReferralQualification(c, referralId);
  if (!next?.payout) return { ok: false, status: 409, code: "payout_not_recorded", message: "Payout could not be recorded. Please retry." };
  return { ok: true, qualification: next, payout: next.payout, idempotent: false };
}

async function qualificationRow(c: AppContext, referralId: string) {
  const rows = await qualificationRows(c, [referralId]);
  return rows[0] || null;
}

async function qualificationRows(c: AppContext, referralIds: string[]) {
  if (referralIds.length === 0) return [];
  const placeholders = referralIds.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `select
       referrals.id as referral_id,
       referrals.organisation_id,
       referrals.branch_id,
       referrals.status as referral_status,
       referrals.submitted_at,
       referrals.valid_until,
       referrals.referral_programme_id,
       referrals.referrer_profile_id,
       referral_programmes.validity_days,
       referral_programmes.minimum_fee_percentage,
       enrolments.id as enrolment_id,
       enrolments.status as enrolment_status,
       enrolments.branch_id as enrolment_branch_id,
       enrolments.referrer_profile_id as enrolment_referrer_profile_id,
       enrolments.admission_date,
       fee_agreements.id as fee_agreement_id,
       fee_agreements.final_agreed_fee_paise,
       fee_agreements.status as fee_agreement_status,
       referral_reward_rule_sets.id as reward_rule_set_id,
       referral_reward_snapshots.id as reward_snapshot_id,
       referral_reward_snapshots.slab_id as snapshot_slab_id,
       referral_reward_snapshots.cash_reward_paise as snapshot_cash_reward_paise,
       referral_reward_snapshots.course_credit_paise as snapshot_course_credit_paise,
       referral_reward_snapshots.status as snapshot_status,
       referral_reward_snapshots.approved_at,
       referral_reward_payouts.id as payout_id,
       referral_reward_payouts.amount_paise as payout_amount_paise,
       referral_reward_payouts.payment_date as payout_payment_date,
       referral_reward_payouts.payment_mode as payout_payment_mode,
       referral_reward_payouts.status as payout_status,
       referral_reward_payouts.created_at as payout_created_at,
       coalesce((
         select sum(receipts.amount_paise)
         from receipts
         where receipts.organisation_id = referrals.organisation_id
           and receipts.enrolment_id = enrolments.id
           and receipts.fee_agreement_id = fee_agreements.id
           and receipts.branch_id = referrals.branch_id
           and receipts.status = 'recorded'
       ), 0) as total_received_paise
     from referrals
     join referral_programmes on referral_programmes.id = referrals.referral_programme_id
       and referral_programmes.organisation_id = referrals.organisation_id
     left join enrolments on enrolments.referral_id = referrals.id
       and enrolments.referrer_profile_id = referrals.referrer_profile_id
     left join fee_agreements on fee_agreements.enrolment_id = enrolments.id
       and fee_agreements.status = 'active'
     left join referral_reward_rule_sets on referral_reward_rule_sets.referral_programme_id = referrals.referral_programme_id
       and referral_reward_rule_sets.organisation_id = referrals.organisation_id
       and referral_reward_rule_sets.status = 'active'
     left join referral_reward_snapshots on referral_reward_snapshots.referral_id = referrals.id
       and referral_reward_snapshots.enrolment_id = enrolments.id
     left join referral_reward_payouts on referral_reward_payouts.reward_snapshot_id = referral_reward_snapshots.id
     where referrals.id in (${placeholders}) and referrals.organisation_id = ?`,
  )
    .bind(...referralIds, ORG_ID)
    .all<QualificationRow>();
  return rows.results || [];
}

async function activeSlabs(c: AppContext, rewardRuleSetId: string) {
  const rows = await c.env.DB.prepare(
    `select id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order
     from referral_reward_slabs
     where reward_rule_set_id = ?
     order by sort_order`,
  )
    .bind(rewardRuleSetId)
    .all<{
      id: string;
      min_final_fee_paise: number;
      max_final_fee_paise: number | null;
      cash_reward_paise: number;
      course_credit_paise: number;
      sort_order: number;
    }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    minFinalFeePaise: Number(row.min_final_fee_paise),
    maxFinalFeePaise: row.max_final_fee_paise === null ? null : Number(row.max_final_fee_paise),
    cashRewardPaise: Number(row.cash_reward_paise),
    courseCreditPaise: Number(row.course_credit_paise),
    sortOrder: Number(row.sort_order),
  }));
}

async function activeSlabsByRuleSet(c: AppContext, rewardRuleSetIds: string[]) {
  const result = new Map<string, RewardSlab[]>();
  if (rewardRuleSetIds.length === 0) return result;
  const placeholders = rewardRuleSetIds.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `select id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order
     from referral_reward_slabs
     where reward_rule_set_id in (${placeholders})
     order by reward_rule_set_id, sort_order`,
  )
    .bind(...rewardRuleSetIds)
    .all<{
      id: string;
      reward_rule_set_id: string;
      min_final_fee_paise: number;
      max_final_fee_paise: number | null;
      cash_reward_paise: number;
      course_credit_paise: number;
      sort_order: number;
    }>();
  for (const row of rows.results || []) {
    const slabs = result.get(row.reward_rule_set_id) || [];
    slabs.push({
      id: row.id,
      minFinalFeePaise: Number(row.min_final_fee_paise),
      maxFinalFeePaise: row.max_final_fee_paise === null ? null : Number(row.max_final_fee_paise),
      cashRewardPaise: Number(row.cash_reward_paise),
      courseCreditPaise: Number(row.course_credit_paise),
      sortOrder: Number(row.sort_order),
    });
    result.set(row.reward_rule_set_id, slabs);
  }
  return result;
}

function qualificationFromRow(row: QualificationRow, slabs: RewardSlab[]): ReferralQualification {
  const admitted = Boolean(row.enrolment_id);
  const admittedWithinValidityWindow = admitted && validAdmission(row.admission_date, row.valid_until);
  const finalAgreedFeePaise = row.final_agreed_fee_paise === null ? null : Number(row.final_agreed_fee_paise);
  const minimumFeePercentage = row.minimum_fee_percentage === null ? null : Number(row.minimum_fee_percentage);
  const minimumQualifyingPaymentPaise = finalAgreedFeePaise === null || minimumFeePercentage === null
    ? null
    : calculateMinimumQualifyingPaymentPaise(finalAgreedFeePaise, minimumFeePercentage);
  const totalReceivedPaise = Number(row.total_received_paise || 0);
  const paymentThresholdMet = minimumQualifyingPaymentPaise !== null && totalReceivedPaise >= minimumQualifyingPaymentPaise;
  const rewardSlab = finalAgreedFeePaise === null ? null : selectRewardSlab(slabs, finalAgreedFeePaise);
  const snapshot = snapshotFromRow(row);
  const payout = payoutFromRow(row);
  const eligible = Boolean(
    admitted
      && row.enrolment_status === "confirmed"
      && row.enrolment_referrer_profile_id === row.referrer_profile_id
      && row.enrolment_branch_id === row.branch_id
      && row.fee_agreement_id
      && row.fee_agreement_status === "active"
      && admittedWithinValidityWindow
      && paymentThresholdMet
      && rewardSlab,
  );
  let status: ReferralRewardStatus = "awaiting_admission";
  if (snapshot && payout) status = "paid";
  else if (snapshot) status = "approved";
  else if (admitted && !admittedWithinValidityWindow) status = "admission_outside_validity";
  else if (admitted && (!row.fee_agreement_id || finalAgreedFeePaise === null || minimumQualifyingPaymentPaise === null || !rewardSlab)) status = "payment_data_unavailable";
  else if (admitted && !paymentThresholdMet) status = "awaiting_payment";
  else if (eligible) status = "qualified";
  else if (["rejected", "cancelled", "closed", "expired"].includes(row.referral_status)) status = "not_eligible";
  return {
    referralId: row.referral_id,
    branchId: row.branch_id,
    referralStatus: row.referral_status,
    status,
    admitted,
    admittedWithinValidityWindow,
    finalAgreedFeePaise,
    minimumFeePercentage,
    minimumQualifyingPaymentPaise,
    totalReceivedPaise,
    paymentThresholdMet,
    rewardEligible: eligible,
    rewardSlab,
    rewardAmountPaise: snapshot ? snapshot.cashRewardPaise : rewardSlab?.cashRewardPaise ?? null,
    courseCreditPaise: snapshot ? snapshot.courseCreditPaise : rewardSlab?.courseCreditPaise ?? null,
    rewardSnapshot: snapshot,
    payout,
  };
}

function snapshotFromRow(row: QualificationRow): RewardSnapshot | null {
  if (!row.reward_snapshot_id || !row.enrolment_id || !row.fee_agreement_id || !row.reward_rule_set_id) return null;
  return {
    id: row.reward_snapshot_id,
    referralId: row.referral_id,
    enrolmentId: row.enrolment_id,
    feeAgreementId: row.fee_agreement_id,
    rewardRuleSetId: row.reward_rule_set_id,
    slabId: row.snapshot_slab_id,
    finalAgreedFeePaise: Number(row.final_agreed_fee_paise || 0),
    minimumFeePercentage: Number(row.minimum_fee_percentage || 0),
    minimumQualifyingPaymentPaise: calculateMinimumQualifyingPaymentPaise(Number(row.final_agreed_fee_paise || 0), Number(row.minimum_fee_percentage || 0)),
    cashRewardPaise: Number(row.snapshot_cash_reward_paise || 0),
    courseCreditPaise: Number(row.snapshot_course_credit_paise || 0),
    status: row.snapshot_status || "approved",
    approvedAt: row.approved_at,
  };
}

function payoutFromRow(row: QualificationRow): RewardPayout | null {
  if (!row.payout_id || !row.payout_status || !row.payout_payment_date || !row.payout_payment_mode || !row.payout_created_at) return null;
  return {
    id: row.payout_id,
    amountPaise: Number(row.payout_amount_paise || 0),
    paymentDate: row.payout_payment_date,
    paymentMode: row.payout_payment_mode,
    status: row.payout_status,
    createdAt: row.payout_created_at,
  };
}

function validAdmission(admissionDate: string | null, validUntil: string) {
  const admissionTime = Date.parse(admissionDate || "");
  const validUntilTime = Date.parse(validUntil);
  return !Number.isNaN(admissionTime) && !Number.isNaN(validUntilTime) && admissionTime <= validUntilTime;
}

async function payoutFingerprint(c: AppContext, rewardSnapshotId: string, amountPaise: number, input: ReferralRewardPayoutInput) {
  return hmacHex(c.env.SESSION_PEPPER, "referral-reward-payout", JSON.stringify({
    rewardSnapshotId,
    amountPaise,
    paymentDate: new Date(input.paymentDate).toISOString(),
    paymentMode: input.paymentMode,
    paymentReference: input.paymentReference?.trim() || "",
    notes: input.notes?.trim() || "",
  }));
}
