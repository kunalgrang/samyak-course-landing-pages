import type { AppContext } from "./http";
import { createOpaqueId } from "./crypto";
import { trustedOrganisationId } from "./tenant-context";

export type MembershipStatus = "active" | "suspended" | "revoked";
export type GlobalIdentityStatus = "active" | "suspended" | "disabled";

export type OrganisationMembershipContext = {
  globalIdentityId: string;
  globalIdentityStatus: GlobalIdentityStatus;
  organisationMembershipId: string;
  organisationId: string;
  membershipStatus: MembershipStatus;
  loginAccountId: string;
};

export class MembershipAccessError extends Error {
  constructor(message = "Organisation membership is not active") {
    super(message);
    this.name = "MembershipAccessError";
  }
}

type LoginAccountMembershipRow = {
  id: string;
  organisation_id: string;
  mobile_normalized: string;
  mobile_hash: string | null;
  mobile_last_four: string;
  login_enabled: number;
  status: string;
  global_identity_id: string | null;
  organisation_membership_id: string | null;
  created_at: string;
  updated_at: string;
};

type MembershipRow = {
  organisation_membership_id: string;
  organisation_id: string;
  membership_status: MembershipStatus;
  login_account_id: string;
  global_identity_id: string;
  global_identity_status: GlobalIdentityStatus;
};

type SessionMembershipRecord = {
  id: string;
  login_account_id: string;
  organisation_membership_id?: string | null;
};

export function loginAccountStatusToMembershipStatus(account: Pick<LoginAccountMembershipRow, "login_enabled" | "status">): MembershipStatus {
  if (account.login_enabled === 1 && account.status === "active") return "active";
  if (account.status === "disabled") return "revoked";
  return "suspended";
}

export async function ensureOrganisationMembershipForLoginAccount(c: AppContext, loginAccountId: string): Promise<OrganisationMembershipContext | null> {
  const account = await c.env.DB.prepare(
    `select id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status,
            global_identity_id, organisation_membership_id, created_at, updated_at
     from login_accounts
     where id = ?`,
  )
    .bind(loginAccountId)
    .first<LoginAccountMembershipRow>();
  if (!account) return null;

  const now = new Date().toISOString();
  const globalIdentityId = account.global_identity_id || createOpaqueId("gident");
  await c.env.DB.prepare(
    `insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
     values (?, ?, ?, ?, 'active', ?, ?)
     on conflict(mobile_normalized) do update set
       mobile_hash = coalesce(global_identities.mobile_hash, excluded.mobile_hash),
       mobile_last_four = excluded.mobile_last_four,
       updated_at = excluded.updated_at`,
  )
    .bind(globalIdentityId, account.mobile_normalized, account.mobile_hash || account.mobile_normalized, account.mobile_last_four, account.created_at || now, now)
    .run();

  const identity = await c.env.DB.prepare("select id from global_identities where mobile_normalized = ?")
    .bind(account.mobile_normalized)
    .first<{ id: string }>();
  if (!identity) throw new Error("Global identity bootstrap failed");

  const membershipId = account.organisation_membership_id || createOpaqueId("omem");
  await c.env.DB.prepare(
    `insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(login_account_id) do nothing`,
  )
    .bind(membershipId, identity.id, account.organisation_id, account.id, loginAccountStatusToMembershipStatus(account), account.created_at || now, now)
    .run();

  const context = await loadMembershipByLoginAccount(c, loginAccountId);
  if (!context) throw new Error("Organisation membership bootstrap failed");

  await c.env.DB.prepare(
    `update login_accounts
     set global_identity_id = ?, organisation_membership_id = ?, updated_at = ?
     where id = ?`,
  )
    .bind(context.globalIdentityId, context.organisationMembershipId, now, loginAccountId)
    .run();

  return context;
}

export async function requireActiveOrganisationMembershipForLoginAccount(c: AppContext, loginAccountId: string) {
  const context = await ensureOrganisationMembershipForLoginAccount(c, loginAccountId);
  if (!isActiveTrustedMembership(c, context)) return null;
  return context;
}

export async function validateSessionOrganisationMembership(c: AppContext, record: SessionMembershipRecord) {
  let context = record.organisation_membership_id
    ? await loadMembershipById(c, record.organisation_membership_id)
    : await ensureOrganisationMembershipForLoginAccount(c, record.login_account_id);
  if (!context) return null;
  if (context.loginAccountId !== record.login_account_id) return null;
  if (!record.organisation_membership_id) {
    await c.env.DB.prepare("update user_sessions set organisation_membership_id = ? where id = ?")
      .bind(context.organisationMembershipId, record.id)
      .run();
    context = { ...context };
  }
  if (!isActiveTrustedMembership(c, context)) return null;
  return context;
}

function isActiveTrustedMembership(c: AppContext, context: OrganisationMembershipContext | null) {
  return Boolean(
    context &&
      context.globalIdentityStatus === "active" &&
      context.membershipStatus === "active" &&
      context.organisationId === trustedOrganisationId(c),
  );
}

async function loadMembershipByLoginAccount(c: AppContext, loginAccountId: string) {
  return loadMembership(c, "organisation_memberships.login_account_id = ?", loginAccountId);
}

async function loadMembershipById(c: AppContext, membershipId: string) {
  return loadMembership(c, "organisation_memberships.id = ?", membershipId);
}

async function loadMembership(c: AppContext, whereSql: string, value: string): Promise<OrganisationMembershipContext | null> {
  const row = await c.env.DB.prepare(
    `select
       organisation_memberships.id as organisation_membership_id,
       organisation_memberships.organisation_id,
       organisation_memberships.status as membership_status,
       organisation_memberships.login_account_id,
       global_identities.id as global_identity_id,
       global_identities.status as global_identity_status
     from organisation_memberships
     join global_identities on global_identities.id = organisation_memberships.global_identity_id
     where ${whereSql}
     limit 1`,
  )
    .bind(value)
    .first<MembershipRow>();
  if (!row) return null;
  return {
    globalIdentityId: row.global_identity_id,
    globalIdentityStatus: row.global_identity_status,
    organisationMembershipId: row.organisation_membership_id,
    organisationId: row.organisation_id,
    membershipStatus: row.membership_status,
    loginAccountId: row.login_account_id,
  };
}
