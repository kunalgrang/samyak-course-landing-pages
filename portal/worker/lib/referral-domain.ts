import { hashReferralToken, referralTokenLastFour as referralTokenLastFourValue } from "./referral-token";

export const REFERRAL_STATUSES = ["submitted", "accepted", "rejected", "active", "converted", "expired", "cancelled", "closed"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_CLOSURE_REASONS = [
  "existing_enquiry",
  "current_student",
  "former_student",
  "active_duplicate",
  "invalid_mobile",
  "invalid_link",
  "inactive_programme",
  "ineligible_course",
  "consent_missing",
  "expired",
  "admission_cancelled",
  "manual_closure",
] as const;
export type ReferralClosureReason = (typeof REFERRAL_CLOSURE_REASONS)[number];

export type RewardSlab = {
  id: string;
  minFinalFeePaise: number;
  maxFinalFeePaise: number | null;
  cashRewardPaise: number;
  courseCreditPaise: number;
  sortOrder: number;
};

export const REFERRAL_STATUS_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
  submitted: ["accepted", "rejected"],
  accepted: ["active", "rejected", "cancelled"],
  active: ["converted", "expired", "cancelled", "closed"],
  converted: ["cancelled", "closed"],
  expired: ["closed"],
  rejected: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

const DUPLICATE_BLOCKING_STATUSES = new Set<ReferralStatus>(["accepted", "active", "converted"]);
const SENSITIVE_SNAPSHOT_KEYS = ["mobile", "email", "aadhaar", "document", "bank", "upi"];

export function calculateReferralValidUntil(submittedAt: Date | string, validityDays: number) {
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) throw new Error("Invalid referral validity days");
  const submitted = typeof submittedAt === "string" ? new Date(submittedAt) : submittedAt;
  if (Number.isNaN(submitted.getTime())) throw new Error("Invalid referral submission date");
  return new Date(submitted.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString();
}

export function isActiveReferralForDuplicateWindow(input: { status: ReferralStatus; validUntil: string }, now: Date | string = new Date()) {
  const nowTime = typeof now === "string" ? Date.parse(now) : now.getTime();
  const validUntilTime = Date.parse(input.validUntil);
  return DUPLICATE_BLOCKING_STATUSES.has(input.status) && !Number.isNaN(validUntilTime) && validUntilTime >= nowTime;
}

export function findActiveDuplicateReferral<T extends { prospectMobileHash: string; status: ReferralStatus; validUntil: string }>(
  referrals: readonly T[],
  prospectMobileHash: string,
  now: Date | string = new Date(),
) {
  return referrals.find((referral) => referral.prospectMobileHash === prospectMobileHash && isActiveReferralForDuplicateWindow(referral, now)) ?? null;
}

export function selectRewardSlab(slabs: readonly RewardSlab[], finalFeePaise: number) {
  if (!Number.isInteger(finalFeePaise) || finalFeePaise < 0) throw new Error("Invalid final fee");
  const ordered = [...slabs].sort((left, right) => left.sortOrder - right.sortOrder);
  return ordered.find((slab) => finalFeePaise >= slab.minFinalFeePaise && (slab.maxFinalFeePaise === null || finalFeePaise <= slab.maxFinalFeePaise)) ?? null;
}

export function calculateMinimumQualifyingPaymentPaise(finalFeePaise: number, minimumFeePercentage: number) {
  if (!Number.isInteger(finalFeePaise) || finalFeePaise < 0) throw new Error("Invalid final fee");
  if (!Number.isInteger(minimumFeePercentage) || minimumFeePercentage < 0 || minimumFeePercentage > 100) throw new Error("Invalid minimum fee percentage");
  return Math.ceil((finalFeePaise * minimumFeePercentage) / 100);
}

export function validateRewardSlabNonOverlap(slabs: readonly RewardSlab[]) {
  const errors: string[] = [];
  const ordered = [...slabs].sort((left, right) => left.minFinalFeePaise - right.minFinalFeePaise || left.sortOrder - right.sortOrder);
  for (const slab of ordered) {
    if (!Number.isInteger(slab.minFinalFeePaise) || slab.minFinalFeePaise < 0) errors.push(`${slab.id}: min fee must be non-negative`);
    if (slab.maxFinalFeePaise !== null && (!Number.isInteger(slab.maxFinalFeePaise) || slab.maxFinalFeePaise < slab.minFinalFeePaise)) {
      errors.push(`${slab.id}: max fee must be null or greater than min fee`);
    }
    if (slab.cashRewardPaise < 0 || slab.courseCreditPaise < 0) errors.push(`${slab.id}: reward values must be non-negative`);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous.maxFinalFeePaise === null || current.minFinalFeePaise <= previous.maxFinalFeePaise) {
      errors.push(`${current.id}: reward slab overlaps ${previous.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function publicSafeReferralStatus(status: ReferralStatus) {
  switch (status) {
    case "submitted":
    case "accepted":
    case "active":
      return "Enquiry Received";
    case "converted":
      return "Admission Confirmed";
    case "expired":
    case "rejected":
    case "cancelled":
    case "closed":
      return "Closed";
  }
}

export function canTransitionReferralStatus(from: ReferralStatus, to: ReferralStatus) {
  return REFERRAL_STATUS_TRANSITIONS[from].includes(to);
}

export function assertReferralStatusTransition(from: ReferralStatus, to: ReferralStatus) {
  if (!canTransitionReferralStatus(from, to)) throw new Error(`Invalid referral status transition: ${from} to ${to}`);
}

export async function referralTokenLookupHash(secret: string, rawToken: string) {
  return hashReferralToken(rawToken, secret);
}

export function referralTokenLastFour(rawToken: string) {
  return referralTokenLastFourValue(rawToken);
}

export function classifyProspectRejection(input: {
  mobileValid: boolean;
  consentRecorded: boolean;
  linkValid: boolean;
  programmeActive: boolean;
  courseEligible: boolean;
  existingRecordType?: "existing_enquiry" | "current_student" | "former_student" | null;
  hasActiveDuplicate: boolean;
}): ReferralClosureReason | null {
  if (!input.mobileValid) return "invalid_mobile";
  if (!input.consentRecorded) return "consent_missing";
  if (!input.linkValid) return "invalid_link";
  if (!input.programmeActive) return "inactive_programme";
  if (!input.courseEligible) return "ineligible_course";
  if (input.existingRecordType) return input.existingRecordType;
  if (input.hasActiveDuplicate) return "active_duplicate";
  return null;
}

export function validateReferralRelationshipScope(input: {
  referralOrganisationId: string;
  branchOrganisationId: string;
  programmeOrganisationId: string;
  linkOrganisationId?: string | null;
  linkProgrammeId?: string | null;
  referrerProfileOrganisationId: string;
  referrerProfileId: string;
  linkReferrerProfileId?: string | null;
  referralProgrammeId: string;
}) {
  const errors: string[] = [];
  const expected = input.referralOrganisationId;
  if (input.branchOrganisationId !== expected) errors.push("branch_organisation_mismatch");
  if (input.programmeOrganisationId !== expected) errors.push("programme_organisation_mismatch");
  if (input.referrerProfileOrganisationId !== expected) errors.push("referrer_profile_organisation_mismatch");
  if (input.linkOrganisationId && input.linkOrganisationId !== expected) errors.push("link_organisation_mismatch");
  if (input.linkProgrammeId && input.linkProgrammeId !== input.referralProgrammeId) errors.push("link_programme_mismatch");
  if (input.linkReferrerProfileId && input.linkReferrerProfileId !== input.referrerProfileId) errors.push("link_referrer_profile_mismatch");
  return { ok: errors.length === 0, errors };
}

export function assertSnapshotJsonSafe(snapshotJson: string) {
  const parsed = JSON.parse(snapshotJson);
  const unsafe = findUnsafeSnapshotPath(parsed);
  if (unsafe) throw new Error(`Reward snapshot contains sensitive field: ${unsafe}`);
}

function findUnsafeSnapshotPath(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafe = findUnsafeSnapshotPath(value[index], `${path}[${index}]`);
      if (unsafe) return unsafe;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_SNAPSHOT_KEYS.some((term) => normalizedKey.includes(term))) return path ? `${path}.${key}` : key;
    const unsafe = findUnsafeSnapshotPath(child, path ? `${path}.${key}` : key);
    if (unsafe) return unsafe;
  }
  return null;
}
