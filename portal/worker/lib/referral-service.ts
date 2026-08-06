import { calculateReferralValidUntil } from "./referral-domain";
import { ReferralRepository, type ActorIdentity, type EligibleCourseRecord, type ReferralDb, type ReferralLinkRecord } from "./referral-repository";
import { generateReferralToken, hashReferralToken, referralTokenLastFour, validateReferralTokenFormat } from "./referral-token";
import { encryptText, hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";

export type ReferralServiceEnv = {
  DB: ReferralDb;
  SESSION_PEPPER: string;
  REFERRAL_TOKEN_PEPPER: string;
};

export type ReferralRejectionCode =
  | "invalid_name"
  | "existing_enquiry"
  | "current_student"
  | "former_student"
  | "active_duplicate"
  | "invalid_mobile"
  | "invalid_link"
  | "inactive_programme"
  | "ineligible_course"
  | "consent_missing"
  | "idempotency_conflict";

export class ReferralServiceError extends Error {
  constructor(
    readonly code: ReferralRejectionCode | "invalid_organisation" | "invalid_referrer" | "configuration_error",
    message: string,
  ) {
    super(message);
    this.name = "ReferralServiceError";
  }
}

export type IssueReferralLinkInput = ActorIdentity & {
  organisationId: string;
  referralProgrammeId: string;
  referrerProfileId: string;
  expiresAt?: string | null;
  now?: Date | string;
  tokenPepper?: string;
};

export type IssueReferralLinkResult = {
  issued: boolean;
  rawToken: string | null;
  link: {
    id: string;
    referralProgrammeId: string;
    referrerProfileId: string;
    tokenLastFour: string | null;
    linkVersion: number;
    status: string;
    activatedAt: string | null;
    expiresAt: string | null;
  };
};

export type ResolveReferralLinkResult =
  | {
      valid: true;
      programme: { id: string; code: string; publicName: string; validityDays: number };
      referrer: { profileId: string; publicDisplayName: string };
      link: { id: string; status: string; expiresAt: string | null };
      courses: EligibleCourseRecord[];
    }
  | { valid: false; reason: "invalid_link" };

export type SubmitReferralInput = {
  organisationId: string;
  rawReferralToken: string;
  branchId: string;
  prospectName: string;
  prospectMobile: string;
  prospectEmail?: string | null;
  courseId: string;
  consentAccepted: boolean;
  source: "personal_link";
  idempotencyKey?: string | null;
  now?: Date | string;
  sessionPepper?: string;
  tokenPepper?: string;
};

export type SubmitReferralResult =
  | {
      ok: true;
      referralId: string;
      enquiryId: string;
      enquiryNumber: string;
      idempotent: boolean;
    }
  | {
      ok: false;
      code: ReferralRejectionCode;
    };

type InternalResolution =
  | { ok: true; link: ReferralLinkRecord }
  | { ok: false; code: "invalid_link" | "inactive_programme" };

export async function issueReferralLink(env: ReferralServiceEnv, input: IssueReferralLinkInput): Promise<IssueReferralLinkResult> {
  const repo = new ReferralRepository(env.DB);
  const nowIso = toIso(input.now);
  const tokenPepper = input.tokenPepper || env.REFERRAL_TOKEN_PEPPER;

  await assertOrganisationProgrammeAndReferrer(repo, input.organisationId, input.referralProgrammeId, input.referrerProfileId, nowIso, input);

  const existing = await repo.findActiveReferralLink(input.organisationId, input.referralProgrammeId, input.referrerProfileId, nowIso);
  if (existing) return issuedLinkResult(false, null, existing);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rawToken = generateReferralToken();
    const tokenHash = await hashReferralToken(rawToken, tokenPepper);
    try {
      const linkId = await repo.insertReferralLink({
        organisationId: input.organisationId,
        referralProgrammeId: input.referralProgrammeId,
        referrerProfileId: input.referrerProfileId,
        tokenHash,
        tokenLastFour: referralTokenLastFour(rawToken),
        linkVersion: 1,
        activatedAt: nowIso,
        expiresAt: input.expiresAt || null,
        actor: input,
      });
      return {
        issued: true,
        rawToken,
        link: {
          id: linkId,
          referralProgrammeId: input.referralProgrammeId,
          referrerProfileId: input.referrerProfileId,
          tokenLastFour: referralTokenLastFour(rawToken),
          linkVersion: 1,
          status: "active",
          activatedAt: nowIso,
          expiresAt: input.expiresAt || null,
        },
      };
    } catch (error) {
      const active = await repo.findActiveReferralLink(input.organisationId, input.referralProgrammeId, input.referrerProfileId, nowIso);
      if (active) return issuedLinkResult(false, null, active);
      if (!isUniqueConstraintError(error) || attempt === 1) throw error;
    }
  }
  throw new ReferralServiceError("configuration_error", "Referral link could not be issued.");
}

export async function resolveReferralLink(env: ReferralServiceEnv, input: { organisationId: string; rawToken: string; now?: Date | string; tokenPepper?: string }): Promise<ResolveReferralLinkResult> {
  const repo = new ReferralRepository(env.DB);
  const nowIso = toIso(input.now);
  const resolved = await resolveReferralLinkInternal(repo, input.organisationId, input.rawToken, input.tokenPepper || env.REFERRAL_TOKEN_PEPPER, nowIso);
  if (!resolved.ok) return { valid: false, reason: "invalid_link" };
  const courses = await repo.listEligibleReferralCourses(input.organisationId, resolved.link.referral_programme_id, nowIso);
  return {
    valid: true,
    programme: {
      id: resolved.link.referral_programme_id,
      code: resolved.link.programme_code,
      publicName: resolved.link.programme_name,
      validityDays: resolved.link.validity_days,
    },
    referrer: {
      profileId: resolved.link.referrer_profile_id,
      publicDisplayName: resolved.link.referrer_public_name || resolved.link.referrer_full_name,
    },
    link: {
      id: resolved.link.id,
      status: resolved.link.status,
      expiresAt: resolved.link.expires_at,
    },
    courses: courses.results || [],
  };
}

export async function listEligibleReferralCourses(env: ReferralServiceEnv, input: { organisationId: string; referralProgrammeId: string; now?: Date | string }) {
  const repo = new ReferralRepository(env.DB);
  const nowIso = toIso(input.now);
  const courses = await repo.listEligibleReferralCourses(input.organisationId, input.referralProgrammeId, nowIso);
  return courses.results || [];
}

export async function submitReferralAndCreateEnquiry(env: ReferralServiceEnv, input: SubmitReferralInput): Promise<SubmitReferralResult> {
  const repo = new ReferralRepository(env.DB);
  const nowIso = toIso(input.now);
  const sessionPepper = input.sessionPepper || env.SESSION_PEPPER;
  const tokenPepper = input.tokenPepper || env.REFERRAL_TOKEN_PEPPER;

  const basicError = validateSubmissionInput(input);
  if (basicError) return { ok: false, code: basicError };
  const prospectName = normalizeSubmittedReferralName(input.prospectName);
  if (!prospectName) return { ok: false, code: "invalid_name" };

  const resolved = await resolveReferralLinkInternal(repo, input.organisationId, input.rawReferralToken, tokenPepper, nowIso);
  if (!resolved.ok) return { ok: false, code: resolved.code };

  const branch = await repo.findActiveBranch(input.organisationId, input.branchId);
  if (!branch) return { ok: false, code: "invalid_link" };

  const course = await repo.findEligibleCourse(input.organisationId, resolved.link.referral_programme_id, input.courseId, nowIso);
  if (!course) return { ok: false, code: "ineligible_course" };

  const normalizedMobile = normalizeIndianMobile(input.prospectMobile);
  if (!normalizedMobile) return { ok: false, code: "invalid_mobile" };
  const prospectMobileHash = await hmacHex(sessionPepper, "mobile", normalizedMobile);
  const prospectMobileLastFour = normalizedMobile.slice(-4);

  const idempotencyKeyHash = input.idempotencyKey ? await hashIdempotencyKey(input.idempotencyKey, sessionPepper) : null;
  const prospectNameHash = await hashSubmittedName(prospectName, sessionPepper);
  const idempotencyPayloadHash = idempotencyKeyHash
    ? await hashIdempotencyPayload(
        {
          linkId: resolved.link.id,
          mobileHash: prospectMobileHash,
          prospectNameHash,
          courseId: input.courseId,
          branchId: input.branchId,
          consentAccepted: input.consentAccepted,
        },
        sessionPepper,
      )
    : null;
  if (idempotencyKeyHash && idempotencyPayloadHash) {
    const existing = await repo.findExistingReferralByIdempotency(input.organisationId, idempotencyKeyHash);
    if (existing) {
      if (existing.idempotency_payload_hash !== idempotencyPayloadHash) return { ok: false, code: "idempotency_conflict" };
      if (!existing.enquiry_id) throw new ReferralServiceError("configuration_error", "Idempotent referral is missing enquiry linkage.");
      return { ok: true, referralId: existing.id, enquiryId: existing.enquiry_id, enquiryNumber: existing.enquiry_number || "", idempotent: true };
    }
  }

  const activeDuplicate = await repo.findActiveDuplicate(input.organisationId, prospectMobileHash, nowIso);
  if (activeDuplicate) return { ok: false, code: "active_duplicate" };
  const existingRecord = await repo.classifyExistingRecord(input.organisationId, prospectMobileHash, nowIso);
  if (existingRecord) return { ok: false, code: existingRecord };

  const prospectMobileCiphertext = await encryptText(sessionPepper, `referral-mobile:${resolved.link.id}:${prospectMobileHash}`, normalizedMobile);
  const prospectEmailCiphertext = input.prospectEmail ? await encryptText(sessionPepper, `referral-email:${resolved.link.id}:${prospectMobileHash}`, input.prospectEmail.trim().toLowerCase()) : null;
  const validUntil = calculateReferralValidUntil(nowIso, resolved.link.validity_days);

  try {
    const created = await repo.createReferralAndEnquiry({
      organisationId: input.organisationId,
      branchId: branch.id,
      branchCode: branch.code,
      programme: {
        id: resolved.link.referral_programme_id,
        organisation_id: resolved.link.organisation_id,
        code: resolved.link.programme_code,
        name: resolved.link.programme_name,
        validity_days: resolved.link.validity_days,
        status: resolved.link.programme_status,
        starts_at: resolved.link.programme_starts_at,
        ends_at: resolved.link.programme_ends_at,
      },
      link: resolved.link,
      courseId: input.courseId,
      prospectName,
      prospectMobileHash,
      prospectMobileLastFour,
      prospectMobileCiphertext,
      prospectEmailCiphertext,
      submittedAt: nowIso,
      validUntil,
      idempotencyKeyHash,
      idempotencyPayloadHash,
    });
    return { ok: true, ...created, idempotent: false };
  } catch (error) {
    if (idempotencyKeyHash && idempotencyPayloadHash && isUniqueConstraintError(error)) {
      const existing = await repo.findExistingReferralByIdempotency(input.organisationId, idempotencyKeyHash);
      if (existing?.idempotency_payload_hash === idempotencyPayloadHash && existing.enquiry_id) {
        return { ok: true, referralId: existing.id, enquiryId: existing.enquiry_id, enquiryNumber: existing.enquiry_number || "", idempotent: true };
      }
      if (existing) return { ok: false, code: "idempotency_conflict" };
    }
    if (isUniqueConstraintError(error)) return { ok: false, code: "active_duplicate" };
    throw error;
  }
}

async function assertOrganisationProgrammeAndReferrer(
  repo: ReferralRepository,
  organisationId: string,
  referralProgrammeId: string,
  referrerProfileId: string,
  nowIso: string,
  actor: ActorIdentity,
) {
  const organisation = await repo.findActiveOrganisation(organisationId);
  if (!organisation) throw new ReferralServiceError("invalid_organisation", "Organisation is not active.");
  const programme = await repo.findCurrentProgramme(organisationId, referralProgrammeId, nowIso);
  if (!programme) throw new ReferralServiceError("inactive_programme", "Referral programme is not active.");
  const profile = await repo.findReferrerProfileForProgramme(organisationId, referralProgrammeId, referrerProfileId);
  if (!profile || profile.active !== 1 || profile.person_status !== "active" || profile.eligible !== 1) {
    throw new ReferralServiceError("invalid_referrer", "Referrer is not eligible for this programme.");
  }
  const actorAllowed = await repo.actorCanUseReferrerProfile(actor, profile);
  if (!actorAllowed) throw new ReferralServiceError("invalid_referrer", "Actor cannot use this referrer profile.");
  return { organisation, programme, profile };
}

async function resolveReferralLinkInternal(repo: ReferralRepository, organisationId: string, rawToken: string, tokenPepper: string, nowIso: string): Promise<InternalResolution> {
  if (!validateReferralTokenFormat(rawToken)) return { ok: false, code: "invalid_link" };
  const tokenHash = await hashReferralToken(rawToken, tokenPepper);
  const link = await repo.findLinkByTokenHash(organisationId, tokenHash);
  if (!link) return { ok: false, code: "invalid_link" };
  if (link.status !== "active" || link.revoked_at || (link.expires_at && link.expires_at <= nowIso)) return { ok: false, code: "invalid_link" };
  if (link.programme_status !== "active" || (link.programme_starts_at && link.programme_starts_at > nowIso) || (link.programme_ends_at && link.programme_ends_at < nowIso)) {
    return { ok: false, code: "inactive_programme" };
  }
  if (link.referrer_active !== 1 || link.referrer_person_status !== "active" || link.referrer_eligible !== 1) return { ok: false, code: "invalid_link" };
  return { ok: true, link };
}

function issuedLinkResult(issued: boolean, rawToken: string | null, link: ReferralLinkRecord): IssueReferralLinkResult {
  return {
    issued,
    rawToken,
    link: {
      id: link.id,
      referralProgrammeId: link.referral_programme_id,
      referrerProfileId: link.referrer_profile_id,
      tokenLastFour: link.token_last_four,
      linkVersion: link.link_version,
      status: link.status,
      activatedAt: link.activated_at,
      expiresAt: link.expires_at,
    },
  };
}

function validateSubmissionInput(input: SubmitReferralInput): ReferralRejectionCode | null {
  if (input.source !== "personal_link") return "invalid_link";
  if (!input.consentAccepted) return "consent_missing";
  if (!normalizeSubmittedReferralName(input.prospectName)) return "invalid_name";
  if (!normalizeIndianMobile(input.prospectMobile)) return "invalid_mobile";
  const email = input.prospectEmail?.trim();
  if ((email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (input.prospectEmail?.length || 0) > 254) return "invalid_mobile";
  if (input.idempotencyKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) return "idempotency_conflict";
  if (input.branchId.length > 120 || input.courseId.length > 120 || input.rawReferralToken.length > 256) return "invalid_link";
  return null;
}

async function hashIdempotencyKey(idempotencyKey: string, sessionPepper: string) {
  return hmacHex(sessionPepper, "referral-idempotency-key", idempotencyKey.trim());
}

async function hashSubmittedName(prospectName: string, sessionPepper: string) {
  return hmacHex(sessionPepper, "referral-submitted-name", prospectName);
}

async function hashIdempotencyPayload(payload: Record<string, unknown>, sessionPepper: string) {
  return hmacHex(sessionPepper, "referral-idempotency-payload", JSON.stringify(payload));
}

export function normalizeSubmittedReferralName(value: string) {
  const normalized = String(value || "").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > 100 || /[\u0000-\u001F\u007F-\u009F]/u.test(normalized)) return null;
  return normalized;
}

function toIso(value?: Date | string) {
  if (!value) return new Date().toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Error && /unique constraint/i.test(error.message);
}
