import type { AppContext } from "./http";
import { createOpaqueId, createSessionToken, daysFromNow, decryptText, encryptText, hmacHex, secondsFromNow } from "./crypto";

export const ORG_ID = "org_samyak";
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_EXPIRY_SECONDS = 10 * 60;

const PRODUCTION_SESSION_COOKIE = "__Host-samyak_session";
const LOCAL_DEVELOPMENT_SESSION_COOKIE = "samyak_session";
const PERSON_ROLE_CODES = new Set(["student", "alumni"]);

export type ProfileChoice = {
  personId: string;
  publicName: string;
  accessType: string;
  roles: string[];
  effectiveRoles?: string[];
};

export type SessionView = {
  authenticated: boolean;
  activeProfile: ProfileChoice | null;
  profiles: ProfileChoice[];
  mobileLastFour?: string;
  accountRoles?: string[];
};

export type AuthenticatedSession = {
  record: SessionRecord;
  tokenHash: string;
};

export type SessionResultCode =
  | "SESSION_COOKIE_MISSING"
  | "SESSION_TOKEN_NOT_FOUND"
  | "SESSION_REVOKED"
  | "SESSION_ABSOLUTE_EXPIRED"
  | "SESSION_INACTIVE_EXPIRED"
  | "SESSION_PROFILE_CLEARED"
  | "SESSION_VALID";

export type SessionValidationResult = {
  session: AuthenticatedSession | null;
  resultCode: SessionResultCode;
  shouldClearCookie: boolean;
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

type SessionRecord = {
  id: string;
  login_account_id: string;
  active_person_id: string | null;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

export type ChallengeRecord = {
  id: string;
  mobile_hash: string;
  mobile_last_four: string | null;
  mobile_ciphertext: string | null;
  provider: string;
  status: string;
  verification_attempts: number;
  resend_count: number;
  last_sent_at: string | null;
  requested_at: string;
  expires_at: string;
};

type PreviousProfileLink = {
  person_id: string;
  is_available: number;
};

type D1RunResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

export type PortalProfile = {
  personId?: string;
  externalReferrerId: string;
  fullName: string;
  publicName: string;
  referrerType: string;
  courseStudied: string;
  memberSince: string;
  referralToken: string;
  personalLink: string;
  active: boolean;
};

export type PortalLookup = {
  success: true;
  eligible: boolean;
  profiles: PortalProfile[];
};

export type PortalDashboard = {
  success: true;
  profile: Omit<PortalProfile, "personId" | "referralToken">;
  linkStatus: {
    hasActiveLink: boolean;
    lastFour: string | null;
    activatedAt: string | null;
    expiresAt: string | null;
    canGenerate: boolean;
    canRotate: boolean;
    message: string;
  };
  summary: {
    totalReferrals: number;
    successfulAdmissions: number;
    cashRewardsEarned: number;
    courseCreditEarned: number;
  };
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  referrals: Array<{
    referralId: string;
    prospectPublicName: string;
    courseInterested: string;
    submissionDate: string;
    publicStatus: string;
    rewardStatus: string;
    rewardChoice: string;
    cashReward: number;
    courseCredit: number;
    approvedRewardAmount: number;
    rewardPaymentDate: string;
  }>;
};

export type StudentHome = {
  success: true;
  identity: {
    personId: string;
    fullName: string;
    publicName: string;
    studentId: string;
    studentStatus: string;
    lifecycleStatus: "CURRENT" | "ALUMNI";
    studentSince: string;
    branchName: string;
  };
  courseHistory: Array<{
    enrolmentId: string;
    enrolmentNumber: string;
    courseId: string;
    courseCode: string;
    courseName: string;
    durationLabel: string;
    admissionDate: string;
    joiningDate: string;
    completionDate: string | null;
    status: string;
  }>;
  skillCircle: {
    programmeName: string;
    eligible: boolean;
    hasActiveReferralLink: boolean;
    referralDashboardPath: "/app/referrals";
    message: string;
  };
};

export async function mobileHash(c: AppContext, mobile: string) {
  return hmacHex(sessionPepper(c), "mobile", mobile);
}

export async function requestFingerprint(c: AppContext) {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const userAgent = c.req.header("user-agent") || "unknown";
  return {
    ipHash: await hmacHex(sessionPepper(c), "ip", ip),
    userAgentHash: await hmacHex(sessionPepper(c), "ua", userAgent),
  };
}

export async function checkOtpRequestLimits(c: AppContext, hash: string, ipHash: string, now = new Date()) {
  const oneMinute = new Date(now.getTime() - 60_000).toISOString();
  const fifteenMinutes = new Date(now.getTime() - 15 * 60_000).toISOString();
  const oneDay = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const recentMobile = await countRows(c, "select count(*) as count from otp_challenges where mobile_hash = ? and requested_at >= ?", hash, oneMinute);
  const mobile15 = await countRows(c, "select count(*) as count from otp_challenges where mobile_hash = ? and requested_at >= ?", hash, fifteenMinutes);
  const mobile24 = await countRows(c, "select count(*) as count from otp_challenges where mobile_hash = ? and requested_at >= ?", hash, oneDay);
  const ip15 = await countRows(c, "select count(*) as count from otp_challenges where ip_hash = ? and requested_at >= ?", ipHash, fifteenMinutes);
  const ip24 = await countRows(c, "select count(*) as count from otp_challenges where ip_hash = ? and requested_at >= ?", ipHash, oneDay);
  return recentMobile < 1 && mobile15 < 3 && mobile24 < 8 && ip15 < 10 && ip24 < 30;
}

export async function createPendingChallenge({
  c,
  hash,
  mobileLastFour,
  ipHash,
}: {
  c: AppContext;
  hash: string;
  mobileLastFour: string;
  ipHash: string;
}) {
  const id = createOpaqueId("otp");
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `insert into otp_challenges (
      id, organisation_id, mobile_hash, mobile_last_four, mobile_ciphertext, provider,
      purpose, status, verification_attempts, resend_count, last_sent_at, requested_at, expires_at, ip_hash
    ) values (?, ?, ?, ?, null, 'none', 'login', 'requested', 0, 0, null, ?, ?, ?)`,
  )
    .bind(id, ORG_ID, hash, mobileLastFour, now, secondsFromNow(OTP_EXPIRY_SECONDS), ipHash)
    .run();
  return id;
}

export async function markRequestedChallengeSent({
  c,
  challengeId,
  mobile,
  provider,
  providerRequestId,
}: {
  c: AppContext;
  challengeId: string;
  mobile: string;
  provider: string;
  providerRequestId?: string;
}) {
  const encryptedMobile = await encryptText(sessionPepper(c), "challenge-mobile", mobile);
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `update otp_challenges
     set status = 'sent', provider = ?, provider_request_id = ?, mobile_ciphertext = ?, last_sent_at = ?
     where id = ? and status = 'requested'`,
  )
    .bind(provider, providerRequestId || null, encryptedMobile, now, challengeId)
    .run();
  return changed(result);
}

export async function markRequestedChallengeBlocked(c: AppContext, challengeId: string) {
  const result = await c.env.DB.prepare("update otp_challenges set status = 'blocked', provider = 'none' where id = ? and status = 'requested'")
    .bind(challengeId)
    .run();
  return changed(result);
}

export async function markChallengeFailed(c: AppContext, challengeId: string) {
  const result = await c.env.DB.prepare("update otp_challenges set status = 'failed' where id = ? and status in ('requested', 'sent')")
    .bind(challengeId)
    .run();
  return changed(result);
}

export async function getChallenge(c: AppContext, id: string) {
  return c.env.DB.prepare("select * from otp_challenges where id = ?").bind(id).first<ChallengeRecord>();
}

export async function incrementChallengeAttemptsIfAllowed(c: AppContext, id: string, now = new Date()) {
  const result = await c.env.DB.prepare(
    `update otp_challenges
     set verification_attempts = verification_attempts + 1
     where id = ?
       and status in ('sent', 'blocked')
       and verification_attempts < ?
       and expires_at > ?`,
  )
    .bind(id, OTP_MAX_ATTEMPTS, now.toISOString())
    .run();
  return changed(result);
}

export async function updateChallengeResent(c: AppContext, id: string, providerRequestId?: string, now = new Date()) {
  const cooldownBefore = new Date(now.getTime() - 60_000).toISOString();
  const result = await c.env.DB.prepare(
    `update otp_challenges
     set resend_count = resend_count + 1,
         last_sent_at = ?,
         provider_request_id = coalesce(?, provider_request_id)
     where id = ?
       and status = 'sent'
       and resend_count < 2
       and expires_at > ?
       and (last_sent_at is null or last_sent_at <= ?)`,
  )
    .bind(now.toISOString(), providerRequestId || null, id, now.toISOString(), cooldownBefore)
    .run();
  return changed(result);
}

export async function markChallengeVerified(c: AppContext, id: string, now = new Date()) {
  const result = await c.env.DB.prepare(
    "update otp_challenges set status = 'verified', verified_at = ? where id = ? and status = 'sent' and verified_at is null and expires_at > ?",
  )
    .bind(now.toISOString(), id, now.toISOString())
    .run();
  return changed(result);
}

export async function decryptChallengeMobile(c: AppContext, challenge: ChallengeRecord) {
  if (!challenge.mobile_ciphertext) return null;
  return decryptText(sessionPepper(c), "challenge-mobile", challenge.mobile_ciphertext);
}

export async function runDummyOtpComparison(c: AppContext, otp: string) {
  const submitted = await hmacHex(sessionPepper(c), "dummy-otp", otp);
  const expected = await hmacHex(sessionPepper(c), "dummy-otp", "000000");
  return constantTimeEqual(submitted, expected);
}

export async function bootstrapAccount(c: AppContext, mobile: string, lookup: PortalLookup) {
  const now = new Date().toISOString();
  const accountHash = await mobileHash(c, mobile);
  const accountId = createOpaqueId("acct");
  await c.env.DB.prepare(
    `insert into login_accounts (
      id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status,
      last_login_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
    on conflict(organisation_id, mobile_normalized) do update set
      mobile_hash = excluded.mobile_hash,
      mobile_last_four = excluded.mobile_last_four,
      last_login_at = excluded.last_login_at,
      updated_at = excluded.updated_at`,
  )
    .bind(accountId, ORG_ID, accountHash, accountHash, mobile.slice(-4), now, now, now)
    .run();
  const account = await c.env.DB.prepare("select id from login_accounts where organisation_id = ? and mobile_normalized = ?")
    .bind(ORG_ID, accountHash)
    .first<{ id: string }>();
  if (!account) throw new Error("Account bootstrap failed");

  const previousLinks = await c.env.DB.prepare(
    `select person_id, is_available
     from login_account_people
     where login_account_id = ?`,
  )
    .bind(account.id)
    .all<PreviousProfileLink>();
  const previousByPersonId = new Map((previousLinks.results || []).map((link) => [link.person_id, link]));
  const returnedPersonIds = new Set<string>();

  await c.env.DB.prepare(
    `delete from login_account_roles
     where login_account_id = ?
       and role_id in (select id from roles where organisation_id = ? and code in ('student', 'alumni'))`,
  )
    .bind(account.id, ORG_ID)
    .run();

  for (const profile of lookup.profiles) {
    if (!profile.personId) continue;
    const personId = profile.personId;
    returnedPersonIds.add(personId);

    await c.env.DB.prepare(
      `insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
       values (?, ?, 'self', ?, 1, ?)
       on conflict(login_account_id, person_id) do update set access_type = excluded.access_type, is_default = excluded.is_default, is_available = 1`,
    )
      .bind(account.id, personId, lookup.profiles.length === 1 ? 1 : 0, now)
      .run();

    const previous = previousByPersonId.get(personId);
    if (previous && previous.is_available === 0) {
      await recordProfileAudit(c, account.id, personId, "profile_activated", personId);
    }
  }
  if (returnedPersonIds.size === 0) throw new Error("Account bootstrap requires existing linked people");

  for (const previous of previousLinks.results || []) {
    if (returnedPersonIds.has(previous.person_id)) continue;
    await c.env.DB.prepare("update login_account_people set is_available = 0 where login_account_id = ? and person_id = ?")
      .bind(account.id, previous.person_id)
      .run();
    await c.env.DB.prepare("update user_sessions set active_person_id = null where login_account_id = ? and active_person_id = ?")
      .bind(account.id, previous.person_id)
      .run();
    await recordProfileAudit(c, account.id, previous.person_id, "profile_unlinked", previous.person_id);
  }

  for (const previous of previousLinks.results || []) {
    if (returnedPersonIds.has(previous.person_id)) continue;
    await c.env.DB.prepare("update user_sessions set active_person_id = null where login_account_id = ? and active_person_id = ?")
      .bind(account.id, previous.person_id)
      .run();
  }

  return account.id;
}

export async function createSession(c: AppContext, loginAccountId: string, activePersonId: string | null) {
  const token = createSessionToken();
  const tokenHash = await hmacHex(sessionPepper(c), "session", token);
  const now = new Date().toISOString();
  const fingerprint = await requestFingerprint(c);
  await c.env.DB.prepare(
    `insert into user_sessions (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at, ip_hash, user_agent_hash)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(createOpaqueId("sess"), loginAccountId, activePersonId, tokenHash, now, daysFromNow(30), now, fingerprint.ipHash, fingerprint.userAgentHash)
    .run();
  return token;
}

export function buildSessionCookie(c: AppContext, token: string) {
  const parts = [`${sessionCookieName(c)}=${token}`, "Path=/"];
  if (shouldUseSecureSessionCookie(c)) parts.push("Secure");
  parts.push("HttpOnly", "SameSite=Lax", "Max-Age=2592000");
  return parts.join("; ");
}

export function clearSessionCookie(c: AppContext) {
  const parts = [`${sessionCookieName(c)}=`, "Path=/"];
  if (shouldUseSecureSessionCookie(c)) parts.push("Secure");
  parts.push("HttpOnly", "SameSite=Lax", "Max-Age=0");
  return parts.join("; ");
}

export function hasSessionCookie(c: AppContext) {
  return Boolean(getCookie(c.req.header("cookie") || "", sessionCookieName(c)));
}

export async function getSessionFromRequest(c: AppContext): Promise<AuthenticatedSession | null> {
  return (await getSessionValidationResult(c)).session;
}

export async function getSessionValidationResult(c: AppContext): Promise<SessionValidationResult> {
  const token = getCookie(c.req.header("cookie") || "", sessionCookieName(c));
  if (!token) {
    await recordSessionResult(c, "SESSION_COOKIE_MISSING");
    return { session: null, resultCode: "SESSION_COOKIE_MISSING", shouldClearCookie: false };
  }
  const tokenHash = await hmacHex(sessionPepper(c), "session", token);
  const record = await c.env.DB.prepare("select * from user_sessions where token_hash = ?").bind(tokenHash).first<SessionRecord>();
  if (!record) {
    await recordSessionResult(c, "SESSION_TOKEN_NOT_FOUND");
    return { session: null, resultCode: "SESSION_TOKEN_NOT_FOUND", shouldClearCookie: true };
  }
  if (record.revoked_at) {
    await recordSessionResult(c, "SESSION_REVOKED", record.login_account_id);
    return { session: null, resultCode: "SESSION_REVOKED", shouldClearCookie: true };
  }
  const now = Date.now();
  if (Date.parse(record.expires_at) <= now) {
    await recordSessionResult(c, "SESSION_ABSOLUTE_EXPIRED", record.login_account_id);
    return { session: null, resultCode: "SESSION_ABSOLUTE_EXPIRED", shouldClearCookie: true };
  }
  if (Date.parse(record.last_seen_at) <= now - 7 * 24 * 60 * 60_000) {
    await recordSessionResult(c, "SESSION_INACTIVE_EXPIRED", record.login_account_id);
    return { session: null, resultCode: "SESSION_INACTIVE_EXPIRED", shouldClearCookie: true };
  }
  let currentRecord = record;
  if (record.active_person_id && !(await isLinkedProfileAvailable(c, record.login_account_id, record.active_person_id))) {
    await c.env.DB.prepare("update user_sessions set active_person_id = null where id = ?").bind(record.id).run();
    currentRecord = { ...record, active_person_id: null };
    await recordSessionResult(c, "SESSION_PROFILE_CLEARED", record.login_account_id);
  }
  if (Date.parse(record.last_seen_at) <= now - 6 * 60 * 60_000) {
    const lastSeenAt = new Date().toISOString();
    await c.env.DB.prepare("update user_sessions set last_seen_at = ? where id = ?").bind(lastSeenAt, record.id).run();
    currentRecord = { ...currentRecord, last_seen_at: lastSeenAt };
  }
  await recordSessionResult(c, "SESSION_VALID", record.login_account_id);
  return { session: { record: currentRecord, tokenHash }, resultCode: "SESSION_VALID", shouldClearCookie: false };
}

export function sessionCookieName(c: AppContext) {
  if (isLocalDevelopmentRequest(c)) return LOCAL_DEVELOPMENT_SESSION_COOKIE;
  return PRODUCTION_SESSION_COOKIE;
}

export async function sessionView(c: AppContext, loginAccountId: string, activePersonId: string | null): Promise<SessionView> {
  const account = await c.env.DB.prepare("select mobile_last_four from login_accounts where id = ?")
    .bind(loginAccountId)
    .first<{ mobile_last_four: string | null }>();
  const rows = await c.env.DB.prepare(
    `select people.id as person_id, people.public_name as public_name, login_account_people.access_type as access_type, roles.code as role_code
     from login_account_people
     join people on people.id = login_account_people.person_id
     join referrer_profiles on referrer_profiles.person_id = people.id and referrer_profiles.active = 1
     left join person_roles on person_roles.person_id = people.id
     left join roles on roles.id = person_roles.role_id
     where login_account_people.login_account_id = ?
       and login_account_people.is_available = 1
       and people.status = 'active'`,
  )
    .bind(loginAccountId)
    .all<{ person_id: string; public_name: string | null; access_type: string; role_code: string | null }>();

  const byPerson = new Map<string, ProfileChoice>();
  for (const row of rows.results || []) {
    const existing = byPerson.get(row.person_id);
    if (existing) {
      if (row.role_code && !existing.roles.includes(row.role_code)) existing.roles.push(row.role_code);
    } else {
      byPerson.set(row.person_id, {
        personId: row.person_id,
        publicName: row.public_name || "Student",
        accessType: row.access_type,
        roles: row.role_code ? [row.role_code] : [],
      });
    }
  }
  const profiles = Array.from(byPerson.values());
  const accountRoles = await getAccountRoles(c, loginAccountId);
  const effectiveRoles = activePersonId ? await getEffectiveRolesForActiveProfile(c, loginAccountId, activePersonId) : accountRoles;
  const activeProfile = profiles.find((profile) => profile.personId === activePersonId) || null;
  return {
    authenticated: true,
    activeProfile: activeProfile ? { ...activeProfile, effectiveRoles } : null,
    profiles,
    mobileLastFour: account?.mobile_last_four || undefined,
    accountRoles,
  };
}

export async function getAccountRoles(c: AppContext, loginAccountId: string) {
  const rows = await c.env.DB.prepare(
    `select distinct roles.code as code
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.code not in ('student', 'alumni')
     order by roles.code`,
  )
    .bind(loginAccountId)
    .all<{ code: string }>();
  return (rows.results || []).map((row) => row.code);
}

export async function getPersonRoles(c: AppContext, personId: string) {
  const rows = await c.env.DB.prepare(
    `select distinct roles.code as code
     from person_roles
     join roles on roles.id = person_roles.role_id
     where person_roles.person_id = ?
     order by roles.code`,
  )
    .bind(personId)
    .all<{ code: string }>();
  return (rows.results || []).map((row) => row.code);
}

// Effective roles are the union of account-level staff roles and the selected profile's person roles.
export async function getEffectiveRolesForActiveProfile(c: AppContext, loginAccountId: string, activePersonId: string | null) {
  const accountRoles = await getAccountRoles(c, loginAccountId);
  if (!activePersonId) return accountRoles;
  const personRoles = await getPersonRoles(c, activePersonId);
  return Array.from(new Set([...accountRoles, ...personRoles]));
}

export async function requireAuthenticatedProfile(c: AppContext) {
  const session = await getSessionFromRequest(c);
  if (!session) return null;
  const view = await sessionView(c, session.record.login_account_id, session.record.active_person_id);
  if (!view.activeProfile) return null;
  return { session, view, activeProfile: view.activeProfile };
}

export async function requireActiveProfileRole(c: AppContext, allowedRoles: string[]) {
  const authenticated = await requireAuthenticatedProfile(c);
  if (!authenticated) return null;
  const effectiveRoles = authenticated.activeProfile.effectiveRoles || [];
  if (!allowedRoles.some((role) => effectiveRoles.includes(role))) return null;
  return authenticated;
}

export async function selectLinkedProfile(c: AppContext, sessionId: string, loginAccountId: string, personId: string) {
  const linked = await isLinkedProfileAvailable(c, loginAccountId, personId);
  if (!linked) return false;
  await c.env.DB.prepare("update user_sessions set active_person_id = ?, last_seen_at = ? where id = ?")
    .bind(personId, new Date().toISOString(), sessionId)
    .run();
  return true;
}

export async function revokeSession(c: AppContext, tokenHash: string) {
  await c.env.DB.prepare("update user_sessions set revoked_at = ? where token_hash = ? and revoked_at is null")
    .bind(new Date().toISOString(), tokenHash)
    .run();
}

export async function activeReferrerForPerson(c: AppContext, personId: string) {
  return c.env.DB.prepare("select * from referrer_profiles where person_id = ? and active = 1")
    .bind(personId)
    .first<{ id: string; external_referrer_id: string; personal_link: string; active: number; created_at: string }>();
}

export async function fetchDashboardForActiveProfile(c: AppContext, personId: string, pagination: { limit?: number; offset?: number } = {}): Promise<PortalDashboard> {
  const referrer = await activeReferrerForPerson(c, personId);
  if (!referrer) throw new Error("No active referrer profile");
  const profile = await profileForPerson(c, personId);
  if (!profile) throw new Error("No active profile");
  const limit = pagination.limit || 25;
  const offset = pagination.offset || 0;
  const activeLink = await activeReferralLinkForProfile(c, referrer.id);
  const summary = await c.env.DB.prepare(
    `select
       count(*) as total_referrals,
       sum(case when status = 'converted' then 1 else 0 end) as successful_admissions,
       coalesce(sum(referral_reward_snapshots.cash_reward_paise), 0) as cash_reward_paise,
       coalesce(sum(referral_reward_snapshots.course_credit_paise), 0) as course_credit_paise
     from referrals
     left join referral_reward_snapshots on referral_reward_snapshots.referral_id = referrals.id
     where referrals.referrer_profile_id = ?`,
  )
    .bind(referrer.id)
    .first<{
      total_referrals: number;
      successful_admissions: number;
      cash_reward_paise: number;
      course_credit_paise: number;
    }>();
  const referrals = await c.env.DB.prepare(
    `select
       referrals.id as referral_id,
       referrals.prospect_name,
       courses.name as course_name,
       referrals.submitted_at,
       referrals.status,
       coalesce(referral_reward_snapshots.cash_reward_paise, 0) as cash_reward_paise,
       coalesce(referral_reward_snapshots.course_credit_paise, 0) as course_credit_paise
     from referrals
     left join courses on courses.id = referrals.course_interest_id
     left join referral_reward_snapshots on referral_reward_snapshots.referral_id = referrals.id
     where referrals.referrer_profile_id = ?
     order by referrals.submitted_at desc, referrals.id desc
     limit ? offset ?`,
  )
    .bind(referrer.id, limit + 1, offset)
    .all<{
      referral_id: string;
      prospect_name: string;
      course_name: string | null;
      submitted_at: string;
      status: string;
      cash_reward_paise: number;
      course_credit_paise: number;
    }>();
  const items = (referrals.results || []).slice(0, limit).map((row) => {
    const cashReward = Math.round(Number(row.cash_reward_paise || 0) / 100);
    const courseCredit = Math.round(Number(row.course_credit_paise || 0) / 100);
    const hasRewardSnapshot = cashReward > 0 || courseCredit > 0;
    return {
      referralId: row.referral_id,
      prospectPublicName: publicProspectName(row.prospect_name),
      courseInterested: row.course_name || "",
      submissionDate: row.submitted_at.slice(0, 10),
      publicStatus: publicReferralStatus(row.status),
      rewardStatus: hasRewardSnapshot ? "Calculated" : "Pending",
      rewardChoice: hasRewardSnapshot ? "Available" : "Pending",
      cashReward,
      courseCredit,
      approvedRewardAmount: hasRewardSnapshot ? cashReward : 0,
      rewardPaymentDate: "",
    };
  });
  return {
    success: true,
    profile: {
      externalReferrerId: profile.externalReferrerId,
      fullName: profile.fullName,
      publicName: profile.publicName,
      referrerType: profile.referrerType,
      courseStudied: profile.courseStudied,
      memberSince: profile.memberSince,
      personalLink: "",
      active: Boolean(referrer.active),
    },
    linkStatus: activeLink
      ? {
          hasActiveLink: true,
          lastFour: activeLink.token_last_four,
          activatedAt: activeLink.activated_at,
          expiresAt: activeLink.expires_at,
          canGenerate: false,
          canRotate: true,
          message: "Your active referral link cannot be displayed again. Rotate it to create a new link.",
        }
      : {
          hasActiveLink: false,
          lastFour: null,
          activatedAt: null,
          expiresAt: null,
          canGenerate: Boolean(referrer.active),
          canRotate: false,
          message: "Generate a referral link to share with friends.",
        },
    summary: {
      totalReferrals: Number(summary?.total_referrals || 0),
      successfulAdmissions: Number(summary?.successful_admissions || 0),
      cashRewardsEarned: Math.round(Number(summary?.cash_reward_paise || 0) / 100),
      courseCreditEarned: Math.round(Number(summary?.course_credit_paise || 0) / 100),
    },
    pagination: {
      limit,
      offset,
      hasMore: (referrals.results || []).length > limit,
    },
    referrals: items,
  };
}

export async function fetchStudentHomeForActiveProfile(c: AppContext, personId: string): Promise<StudentHome> {
  const student = await c.env.DB.prepare(
    `select
       people.full_name,
       people.public_name,
       students.id as student_id,
       students.student_number,
       students.student_since,
       students.current_status,
       branches.name as branch_name,
       referrer_profiles.id as referrer_profile_id
     from students
     join people on people.id = students.person_id
       and people.organisation_id = students.organisation_id
     left join branches on branches.id = students.home_branch_id
     left join referrer_profiles on referrer_profiles.person_id = people.id
       and referrer_profiles.organisation_id = people.organisation_id
       and referrer_profiles.active = 1
     where students.organisation_id = ?
       and students.person_id = ?
       and students.portal_status != 'disabled'
       and people.status = 'active'
     limit 1`,
  )
    .bind(ORG_ID, personId)
    .first<{
      full_name: string;
      public_name: string | null;
      student_id: string;
      student_number: string;
      student_since: string;
      current_status: string;
      branch_name: string | null;
      referrer_profile_id: string | null;
    }>();
  if (!student) throw new Error("Student profile unavailable");

  const courseRows = await c.env.DB.prepare(
    `select
       enrolments.id as enrolment_id,
       enrolments.enrolment_number,
       enrolments.admission_date,
       enrolments.joining_date,
       enrolments.actual_completion_date,
       enrolments.status,
       courses.id as course_id,
       courses.code as course_code,
       courses.name as course_name,
       courses.duration_label
     from enrolments
     join students on students.id = enrolments.student_id
     join courses on courses.id = enrolments.course_id
     where students.organisation_id = ?
       and students.person_id = ?
     order by enrolments.admission_date desc, enrolments.id desc`,
  )
    .bind(ORG_ID, personId)
    .all<{
      enrolment_id: string;
      enrolment_number: string;
      admission_date: string;
      joining_date: string;
      actual_completion_date: string | null;
      status: string;
      course_id: string;
      course_code: string;
      course_name: string;
      duration_label: string | null;
    }>();

  const activeLink = student.referrer_profile_id ? await activeReferralLinkForProfile(c, student.referrer_profile_id) : null;
  return {
    success: true,
    identity: {
      personId,
      fullName: student.full_name,
      publicName: student.public_name || student.full_name,
      studentId: student.student_number,
      studentStatus: student.current_status,
      lifecycleStatus: studentLifecycleStatus(student.current_status),
      studentSince: student.student_since,
      branchName: student.branch_name || "",
    },
    courseHistory: (courseRows.results || []).map((row) => ({
      enrolmentId: row.enrolment_id,
      enrolmentNumber: row.enrolment_number,
      courseId: row.course_id,
      courseCode: row.course_code,
      courseName: row.course_name,
      durationLabel: row.duration_label || "",
      admissionDate: row.admission_date,
      joiningDate: row.joining_date,
      completionDate: row.actual_completion_date,
      status: row.status,
    })),
    skillCircle: {
      programmeName: "Samyak Skill Circle",
      eligible: Boolean(student.referrer_profile_id),
      hasActiveReferralLink: Boolean(activeLink),
      referralDashboardPath: "/app/referrals",
      message: activeLink
        ? "Your referral dashboard is ready."
        : "Create or manage your referral link from My Referrals.",
    },
  };
}

async function activeReferralLinkForProfile(c: AppContext, referrerProfileId: string) {
  const now = new Date().toISOString();
  return c.env.DB.prepare(
    `select id, token_last_four, activated_at, expires_at
     from referral_links
     where organisation_id = ?
       and referrer_profile_id = ?
       and status = 'active'
       and revoked_at is null
       and (expires_at is null or expires_at > ?)
     order by activated_at desc, id desc
     limit 1`,
  )
    .bind(ORG_ID, referrerProfileId, now)
    .first<{ id: string; token_last_four: string | null; activated_at: string | null; expires_at: string | null }>();
}

export async function lookupPortalProfilesByMobile(c: AppContext, mobile: string): Promise<PortalLookup> {
  const hash = await mobileHash(c, mobile);
  const now = new Date().toISOString();
  const rows = await c.env.DB.prepare(
    `select
       people.id as person_id,
       people.full_name,
       people.public_name,
       students.student_number,
       students.current_status,
       referrer_profiles.external_referrer_id,
       referrer_profiles.referral_token,
       referrer_profiles.personal_link,
       referrer_profiles.active,
       referrer_profiles.created_at,
       roles.code as role_code,
       (
         select courses.name
         from students
         join enrolments on enrolments.student_id = students.id
         join courses on courses.id = enrolments.course_id
         where students.person_id = people.id
         order by enrolments.admission_date desc
         limit 1
       ) as course_studied
     from person_contacts
     join people on people.id = person_contacts.person_id
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     join students on students.person_id = people.id
       and students.organisation_id = people.organisation_id
       and students.portal_status != 'disabled'
     join referrer_profiles on referrer_profiles.person_id = people.id
       and referrer_profiles.organisation_id = people.organisation_id
     join person_roles on person_roles.person_id = people.id
     join roles on roles.id = person_roles.role_id
       and roles.organisation_id = people.organisation_id
     join referral_programmes on referral_programmes.organisation_id = people.organisation_id
       and referral_programmes.code = 'samyak_skill_circle'
       and referral_programmes.status = 'active'
     join referral_programme_referrer_types on referral_programme_referrer_types.referral_programme_id = referral_programmes.id
       and referral_programme_referrer_types.referrer_type = roles.code
     where person_contacts.contact_type = 'mobile'
       and person_contacts.normalized_value = ?
       and people.organisation_id = ?
       and people.status = 'active'
       and referrer_profiles.active = 1
       and (person_contact_details.status is null or person_contact_details.status = 'active')
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
     order by people.full_name`,
  )
    .bind(hash, ORG_ID, now)
    .all<{
      person_id: string;
      full_name: string;
      public_name: string | null;
      student_number: string;
      current_status: string;
      external_referrer_id: string;
      referral_token: string;
      personal_link: string;
      active: number;
      created_at: string;
      role_code: string;
      course_studied: string | null;
    }>();
  const byPerson = new Map<string, PortalProfile>();
  for (const row of rows.results || []) {
    const profile = {
      personId: row.person_id,
      externalReferrerId: row.external_referrer_id,
      fullName: row.full_name,
      publicName: row.public_name || row.full_name,
      referrerType: row.role_code === "alumni" ? "Alumni" : "Student",
      courseStudied: row.course_studied || "",
      memberSince: row.created_at.slice(0, 10),
      referralToken: row.referral_token || "",
      personalLink: row.personal_link || "",
      active: row.active === 1,
    };
    const existing = byPerson.get(row.person_id);
    if (!existing || (existing.referrerType === "Alumni" && profile.referrerType === "Student")) byPerson.set(row.person_id, profile);
  }
  const profiles = Array.from(byPerson.values());
  return { success: true, eligible: profiles.length > 0, profiles };
}

function studentLifecycleStatus(status: string): "CURRENT" | "ALUMNI" {
  return ["active", "on_hold", "suspended"].includes(status) ? "CURRENT" : "ALUMNI";
}

async function profileForPerson(c: AppContext, personId: string) {
  const row = await c.env.DB.prepare(
    `select
       people.id as person_id,
       people.full_name,
       people.public_name,
       referrer_profiles.external_referrer_id,
       referrer_profiles.referral_token,
       referrer_profiles.personal_link,
       referrer_profiles.active,
       referrer_profiles.created_at,
       roles.code as role_code,
       (
         select courses.name
         from students
         join enrolments on enrolments.student_id = students.id
         join courses on courses.id = enrolments.course_id
         where students.person_id = people.id
         order by enrolments.admission_date desc
         limit 1
       ) as course_studied
     from people
     join referrer_profiles on referrer_profiles.person_id = people.id
       and referrer_profiles.organisation_id = people.organisation_id
     left join person_roles on person_roles.person_id = people.id
     left join roles on roles.id = person_roles.role_id
       and roles.organisation_id = people.organisation_id
       and roles.code in ('student', 'alumni')
     where people.id = ?
       and people.organisation_id = ?
       and people.status = 'active'
       and referrer_profiles.active = 1
     order by case roles.code when 'student' then 1 when 'alumni' then 2 else 3 end
     limit 1`,
  )
    .bind(personId, ORG_ID)
    .first<{
      person_id: string;
      full_name: string;
      public_name: string | null;
      external_referrer_id: string;
      referral_token: string;
      personal_link: string;
      active: number;
      created_at: string;
      role_code: string | null;
      course_studied: string | null;
    }>();
  if (!row) return null;
  return {
    personId: row.person_id,
    externalReferrerId: row.external_referrer_id,
    fullName: row.full_name,
    publicName: row.public_name || row.full_name,
    referrerType: row.role_code === "alumni" ? "Alumni" : "Student",
    courseStudied: row.course_studied || "",
    memberSince: row.created_at.slice(0, 10),
    referralToken: row.referral_token || "",
    personalLink: row.personal_link || "",
    active: row.active === 1,
  };
}

function publicReferralStatus(status: string) {
  const labels: Record<string, string> = {
    submitted: "Submitted",
    accepted: "Accepted",
    active: "In counselling",
    converted: "Converted",
    rejected: "Not eligible",
    expired: "Expired",
    cancelled: "Cancelled",
    closed: "Closed",
  };
  return labels[status] || "Submitted";
}

function publicProspectName(value: string | null) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "Friend";
  const parts = normalized.split(" ");
  if (parts.length === 1) return parts[0].slice(0, 40);
  return `${parts[0].slice(0, 30)} ${parts[parts.length - 1].slice(0, 1).toUpperCase()}.`;
}

export async function recordAuthEvent(
  c: AppContext,
  eventType: string,
  resultCode: string,
  details?: { loginAccountId?: string | null; mobileHash?: string | null; mobileLastFour?: string | null; ipHash?: string | null },
) {
  await c.env.DB.prepare(
    `insert into auth_events (id, organisation_id, login_account_id, event_type, result_code, mobile_hash, mobile_last_four, ip_hash, user_agent_hash, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)`,
  )
    .bind(
      createOpaqueId("evt"),
      ORG_ID,
      details?.loginAccountId || null,
      eventType,
      resultCode,
      details?.mobileHash || null,
      details?.mobileLastFour || null,
      details?.ipHash || null,
      (await requestFingerprint(c)).userAgentHash,
      new Date().toISOString(),
    )
    .run();
}

async function recordSessionResult(c: AppContext, resultCode: SessionResultCode, loginAccountId?: string | null) {
  if (resultCode === "SESSION_VALID" && !shouldSampleValidSession()) return;
  await recordAuthEvent(c, "session_check", resultCode, { loginAccountId });
}

export async function recordAuditLog(c: AppContext, loginAccountId: string, personId: string | null, action: string) {
  await c.env.DB.prepare(
    `insert into audit_logs (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, created_at)
     values (?, ?, ?, ?, ?, 'session', ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, loginAccountId, personId, action, loginAccountId, new Date().toISOString())
    .run();
}

async function recordProfileAudit(c: AppContext, loginAccountId: string, personId: string, action: string, entityId: string) {
  await c.env.DB.prepare(
    `insert into audit_logs (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, created_at)
     values (?, ?, ?, ?, ?, 'referrer_profile', ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, loginAccountId, personId, action, entityId, new Date().toISOString())
    .run();
}

async function isLinkedProfileAvailable(c: AppContext, loginAccountId: string, personId: string) {
  const linked = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_people
     join people on people.id = login_account_people.person_id
     join referrer_profiles on referrer_profiles.person_id = people.id and referrer_profiles.active = 1
     where login_account_people.login_account_id = ?
       and login_account_people.person_id = ?
       and login_account_people.is_available = 1
       and people.status = 'active'`,
  )
    .bind(loginAccountId, personId)
    .first<{ ok: number }>();
  return Boolean(linked);
}

async function countRows(c: AppContext, sql: string, ...values: unknown[]) {
  const row = await c.env.DB.prepare(sql).bind(...values).first<{ count: number }>();
  return Number(row?.count || 0);
}

function changed(result: D1RunResult) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 1) > 0;
}

function constantTimeEqual(left: string, right: string) {
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function sessionPepper(c: AppContext) {
  const pepper = c.env.SESSION_PEPPER;
  if (typeof pepper !== "string" || pepper.trim().length === 0) {
    throw new AuthConfigurationError("SESSION_PEPPER is not configured.");
  }
  return pepper;
}

function shouldSampleValidSession() {
  const sample = new Uint8Array(1);
  crypto.getRandomValues(sample);
  return sample[0] === 0;
}

function shouldUseSecureSessionCookie(c: AppContext) {
  return !isLocalDevelopmentRequest(c);
}

function isLocalDevelopmentRequest(c: AppContext) {
  const hostname = new URL(c.req.url).hostname;
  return c.env.ENVIRONMENT === "development" && (hostname === "localhost" || hostname === "127.0.0.1");
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)}`;
}

function getCookie(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
