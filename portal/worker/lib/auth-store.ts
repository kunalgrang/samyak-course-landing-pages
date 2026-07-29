import type { AppContext } from "./http";
import { createOpaqueId, createSessionToken, daysFromNow, decryptText, encryptText, hmacHex, secondsFromNow } from "./crypto";
import type { PortalLookup, PortalDashboard } from "./apps-script";
import { callPortalDashboard } from "./apps-script";

export const ORG_ID = "org_samyak";
export const SESSION_COOKIE = "__Host-samyak_session";
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_EXPIRY_SECONDS = 10 * 60;

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
  external_referrer_id: string | null;
  referrer_active: number | null;
};

type D1RunResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

export async function mobileHash(c: AppContext, mobile: string) {
  return hmacHex(c.env.SESSION_PEPPER, "mobile", mobile);
}

export async function requestFingerprint(c: AppContext) {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const userAgent = c.req.header("user-agent") || "unknown";
  return {
    ipHash: await hmacHex(c.env.SESSION_PEPPER, "ip", ip),
    userAgentHash: await hmacHex(c.env.SESSION_PEPPER, "ua", userAgent),
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
  const encryptedMobile = await encryptText(c.env.SESSION_PEPPER, "challenge-mobile", mobile);
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
  return decryptText(c.env.SESSION_PEPPER, "challenge-mobile", challenge.mobile_ciphertext);
}

export async function runDummyOtpComparison(c: AppContext, otp: string) {
  const submitted = await hmacHex(c.env.SESSION_PEPPER, "dummy-otp", otp);
  const expected = await hmacHex(c.env.SESSION_PEPPER, "dummy-otp", "000000");
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
    `select login_account_people.person_id, referrer_profiles.external_referrer_id, referrer_profiles.active as referrer_active
     from login_account_people
     left join referrer_profiles on referrer_profiles.person_id = login_account_people.person_id
     where login_account_people.login_account_id = ?`,
  )
    .bind(account.id)
    .all<PreviousProfileLink>();
  const previousByExternalId = new Map((previousLinks.results || []).map((link) => [link.external_referrer_id, link]));
  const returnedExternalIds = new Set(lookup.profiles.map((profile) => profile.externalReferrerId));
  const returnedPersonIds = new Set<string>();

  await c.env.DB.prepare(
    `delete from login_account_roles
     where login_account_id = ?
       and role_id in (select id from roles where organisation_id = ? and code in ('student', 'alumni'))`,
  )
    .bind(account.id, ORG_ID)
    .run();

  for (const profile of lookup.profiles) {
    const personId = stableId("person", profile.externalReferrerId);
    const referrerId = stableId("ref", profile.externalReferrerId);
    const roleCode = profile.referrerType.toLowerCase().includes("alumni") ? "alumni" : "student";
    returnedPersonIds.add(personId);

    await c.env.DB.prepare(
      `insert into people (id, organisation_id, full_name, public_name, status, created_at, updated_at)
       values (?, ?, ?, ?, 'active', ?, ?)
       on conflict(id) do update set full_name = excluded.full_name, public_name = excluded.public_name, status = 'active', updated_at = excluded.updated_at`,
    )
      .bind(personId, ORG_ID, profile.fullName, profile.publicName, now, now)
      .run();
    await c.env.DB.prepare(
      `insert into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, verified_at, created_at, updated_at)
       values (?, ?, 'mobile', ?, ?, ?, 1, 1, ?, ?, ?)
       on conflict(person_id, contact_type, normalized_value) do update set is_verified = 1, verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
    )
      .bind(stableId("contact", `${profile.externalReferrerId}-mobile`), personId, accountHash, null, mobile.slice(-4), now, now, now)
      .run();
    await c.env.DB.prepare(
      `insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, last_synced_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       on conflict(organisation_id, external_referrer_id) do update set person_id = excluded.person_id, referral_token = excluded.referral_token, personal_link = excluded.personal_link, active = 1, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
    )
      .bind(referrerId, ORG_ID, personId, profile.externalReferrerId, profile.referralToken, profile.personalLink, now, now, now)
      .run();
    await c.env.DB.prepare(
      `insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
       values (?, ?, 'self', ?, 1, ?)
       on conflict(login_account_id, person_id) do update set access_type = excluded.access_type, is_default = excluded.is_default, is_available = 1`,
    )
      .bind(account.id, personId, lookup.profiles.length === 1 ? 1 : 0, now)
      .run();
    await c.env.DB.prepare(
      `insert into person_roles (person_id, role_id, branch_id, branch_key, created_at)
       select ?, roles.id, null, '', ? from roles where roles.organisation_id = ? and roles.code = ?
       on conflict(person_id, role_id, branch_key) do nothing`,
    )
      .bind(personId, now, ORG_ID, roleCode)
      .run();

    const previous = previousByExternalId.get(profile.externalReferrerId);
    if (previous && previous.referrer_active === 0) {
      await recordProfileAudit(c, account.id, personId, "profile_activated", referrerId);
    }
  }

  for (const previous of previousLinks.results || []) {
    if (!previous.external_referrer_id || returnedExternalIds.has(previous.external_referrer_id)) continue;
    await c.env.DB.prepare("update login_account_people set is_available = 0 where login_account_id = ? and person_id = ?")
      .bind(account.id, previous.person_id)
      .run();
    await c.env.DB.prepare("update referrer_profiles set active = 0, last_synced_at = ?, updated_at = ? where person_id = ? and active = 1")
      .bind(now, now, previous.person_id)
      .run();
    await c.env.DB.prepare("update user_sessions set active_person_id = null where login_account_id = ? and active_person_id = ?")
      .bind(account.id, previous.person_id)
      .run();
    await recordProfileAudit(c, account.id, previous.person_id, "profile_deactivated", previous.external_referrer_id);
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
  const tokenHash = await hmacHex(c.env.SESSION_PEPPER, "session", token);
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
  const parts = [`${SESSION_COOKIE}=${token}`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"];
  const hostname = new URL(c.req.url).hostname;
  if (c.env.ENVIRONMENT === "production" || (hostname !== "localhost" && hostname !== "127.0.0.1")) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(c: AppContext) {
  const hostname = new URL(c.req.url).hostname;
  const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (c.env.ENVIRONMENT === "production" || (hostname !== "localhost" && hostname !== "127.0.0.1")) parts.push("Secure");
  return parts.join("; ");
}

export function hasSessionCookie(c: AppContext) {
  return Boolean(getCookie(c.req.header("cookie") || "", SESSION_COOKIE));
}

export async function getSessionFromRequest(c: AppContext): Promise<AuthenticatedSession | null> {
  const token = getCookie(c.req.header("cookie") || "", SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hmacHex(c.env.SESSION_PEPPER, "session", token);
  const record = await c.env.DB.prepare("select * from user_sessions where token_hash = ?").bind(tokenHash).first<SessionRecord>();
  if (!record || record.revoked_at) return null;
  const now = Date.now();
  if (Date.parse(record.expires_at) <= now) return null;
  if (Date.parse(record.last_seen_at) <= now - 7 * 24 * 60 * 60_000) return null;
  if (record.active_person_id && !(await isLinkedProfileAvailable(c, record.login_account_id, record.active_person_id))) {
    await c.env.DB.prepare("update user_sessions set active_person_id = null where id = ?").bind(record.id).run();
    return null;
  }
  if (Date.parse(record.last_seen_at) <= now - 6 * 60 * 60_000) {
    await c.env.DB.prepare("update user_sessions set last_seen_at = ? where id = ?").bind(new Date().toISOString(), record.id).run();
  }
  return { record, tokenHash };
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
  return c.env.DB.prepare("select external_referrer_id from referrer_profiles where person_id = ? and active = 1")
    .bind(personId)
    .first<{ external_referrer_id: string }>();
}

export async function fetchDashboardForActiveProfile(c: AppContext, personId: string): Promise<PortalDashboard> {
  const referrer = await activeReferrerForPerson(c, personId);
  if (!referrer) throw new Error("No active referrer profile");
  return callPortalDashboard(c.env, referrer.external_referrer_id);
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
