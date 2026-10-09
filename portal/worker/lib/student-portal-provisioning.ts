import type { AppContext } from "./http";
import { createOpaqueId } from "./crypto";

export type StudentPortalProvisioningResult = {
  status:
    | "provisioned"
    | "already_provisioned"
    | "no_primary_mobile"
    | "stale_primary_mobile"
    | "blocked_identity"
    | "blocked_login_account"
    | "blocked_membership"
    | "blocked_student_role"
    | "portal_provisioning_failed"
    | "identity_conflict";
  globalIdentityId?: string;
  loginAccountId?: string;
  organisationMembershipId?: string;
  reason?: string;
};

export async function ensureStudentPortalMembershipForPrimaryMobile(
  c: AppContext,
  input: {
    organisationId: string;
    personId: string;
    now: string;
    expectedPrimaryMobile?: {
      contactId?: string;
      normalizedValue: string;
    };
    studentRolePolicy?: "ensure_active" | "preserve_existing_status";
  },
): Promise<StudentPortalProvisioningResult> {
  const mobile = await c.env.DB.prepare(
    `select person_contacts.id, person_contacts.normalized_value, person_contacts.last_four
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
       and person_contacts.is_primary = 1
       and (person_contact_details.status is null or person_contact_details.status = 'active')
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
     order by person_contacts.updated_at desc, person_contacts.created_at desc
     limit 1`,
  )
    .bind(input.personId, input.now)
    .first<{ id: string; normalized_value: string; last_four: string | null }>();
  if (!mobile?.normalized_value) return { status: "no_primary_mobile" };
  if (
    input.expectedPrimaryMobile
    && (
      mobile.normalized_value !== input.expectedPrimaryMobile.normalizedValue
      || (input.expectedPrimaryMobile.contactId && mobile.id !== input.expectedPrimaryMobile.contactId)
    )
  ) {
    return {
      status: "stale_primary_mobile",
      reason: "primary_mobile_changed",
    };
  }

  const rolePrecheck = await studentRoleStatus(c, input.organisationId, input.personId);
  if (rolePrecheck.status === "missing_role_config") throw new Error("Student role is not configured");
  if (input.studentRolePolicy === "preserve_existing_status" && rolePrecheck.status === "inactive") {
    return {
      status: "blocked_student_role",
      reason: "student_role_not_active",
    };
  }

  const mobileHash = mobile.normalized_value;
  const mobileLastFour = mobile.last_four || "";
  const globalIdentity = await ensureGlobalIdentity(c, mobileHash, mobileLastFour, input.now);
  if (globalIdentity.status !== "active") {
    return {
      status: "blocked_identity",
      globalIdentityId: globalIdentity.id,
      reason: "global_identity_not_active",
    };
  }
  const globalIdentityId = globalIdentity.id;
  const existingMembership = await membershipForIdentityOrganisation(c, globalIdentityId, input.organisationId);
  const account = existingMembership
    ? await loginAccountById(c, existingMembership.login_account_id)
    : await ensureLoginAccount(c, {
    organisationId: input.organisationId,
    globalIdentityId,
    mobileHash,
    mobileLastFour,
    now: input.now,
  });
  if (!account) {
    return {
      status: "identity_conflict",
      globalIdentityId,
      reason: "membership_login_account_missing",
    };
  }
  if (account.global_identity_id && account.global_identity_id !== globalIdentityId) {
    return {
      status: "identity_conflict",
      globalIdentityId,
      loginAccountId: account.id,
      reason: "login_account_identity_mismatch",
    };
  }
  if (account.status !== "active" || Number(account.login_enabled) !== 1) {
    return {
      status: "blocked_login_account",
      globalIdentityId,
      loginAccountId: account.id,
      reason: account.status !== "active" ? "login_account_not_active" : "login_disabled",
    };
  }

  const ownership = await availableAccountPersonLinks(c, account.id);
  if (ownership.some((link) => link.person_id !== input.personId)) {
    return {
      status: "identity_conflict",
      globalIdentityId,
      loginAccountId: account.id,
      reason: "different_linked_person",
    };
  }
  const existingPersonLink = await accountPersonLink(c, account.id, input.personId);
  if (existingPersonLink && existingPersonLink.access_type !== "self") {
    return {
      status: "identity_conflict",
      globalIdentityId,
      loginAccountId: account.id,
      reason: "non_self_account_person_link",
    };
  }

  const loginAccountId = account.id;
  const organisationMembershipId = existingMembership?.id || await ensureOrganisationMembership(c, {
    organisationId: input.organisationId,
    globalIdentityId,
    loginAccountId,
    now: input.now,
  });
  const membership = await membershipForIdentityOrganisation(c, globalIdentityId, input.organisationId);
  if (!membership) throw new Error("Student portal organisation membership provisioning failed");
  if (membership.login_account_id !== loginAccountId) {
    return {
      status: "identity_conflict",
      globalIdentityId,
      loginAccountId,
      organisationMembershipId: membership.id,
      reason: "membership_login_account_mismatch",
    };
  }
  if (membership.status !== "active") {
    return {
      status: "blocked_membership",
      globalIdentityId,
      loginAccountId,
      organisationMembershipId: membership.id,
      reason: "membership_not_active",
    };
  }

  await c.env.DB.prepare(
    `update login_accounts
     set global_identity_id = ?,
         organisation_membership_id = ?,
         mobile_hash = ?,
         mobile_last_four = ?,
         updated_at = ?
     where id = ?`,
  )
    .bind(globalIdentityId, organisationMembershipId, mobileHash, mobileLastFour, input.now, loginAccountId)
    .run();

  const linkCreated = await ensureLoginAccountPerson(c, loginAccountId, input.personId, input.now);
  const selfLink = await accountPersonLink(c, loginAccountId, input.personId);
  if (!selfLink || selfLink.access_type !== "self" || Number(selfLink.is_available) !== 1) {
    return {
      status: "identity_conflict",
      globalIdentityId,
      loginAccountId,
      organisationMembershipId,
      reason: selfLink && selfLink.access_type !== "self" ? "non_self_account_person_link" : "account_person_self_link_missing",
    };
  }
  const roleResult = await ensureStudentRole(c, input.organisationId, input.personId, input.now, input.studentRolePolicy || "ensure_active");
  if (!roleResult.ok) {
    return {
      status: "blocked_student_role",
      globalIdentityId,
      loginAccountId,
      organisationMembershipId,
      reason: roleResult.reason,
    };
  }

  return {
    status: linkCreated || roleResult.created || !existingMembership ? "provisioned" : "already_provisioned",
    globalIdentityId,
    loginAccountId,
    organisationMembershipId,
  };
}

async function ensureGlobalIdentity(c: AppContext, mobileHash: string, mobileLastFour: string, now: string) {
  const globalIdentityId = createOpaqueId("gident");
  await c.env.DB.prepare(
    `insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
     values (?, ?, ?, ?, 'active', ?, ?)
     on conflict(mobile_normalized) do update set
       mobile_hash = coalesce(global_identities.mobile_hash, excluded.mobile_hash),
       mobile_last_four = excluded.mobile_last_four,
       updated_at = excluded.updated_at`,
  )
    .bind(globalIdentityId, mobileHash, mobileHash, mobileLastFour, now, now)
    .run();

  const identity = await c.env.DB.prepare("select id, status from global_identities where mobile_normalized = ?")
    .bind(mobileHash)
    .first<{ id: string; status: string }>();
  if (!identity) throw new Error("Student portal global identity provisioning failed");
  return identity;
}

async function ensureLoginAccount(
  c: AppContext,
  input: {
    organisationId: string;
    globalIdentityId: string;
    mobileHash: string;
    mobileLastFour: string;
    now: string;
  },
) {
  const accountId = createOpaqueId("acct");
  await c.env.DB.prepare(
    `insert into login_accounts (
       id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized,
       mobile_hash, mobile_last_four, login_enabled, status, last_login_at, created_at, updated_at
     ) values (?, ?, ?, null, ?, ?, ?, 1, 'active', null, ?, ?)
     on conflict(organisation_id, mobile_normalized) do update set
       global_identity_id = coalesce(login_accounts.global_identity_id, excluded.global_identity_id),
       mobile_hash = excluded.mobile_hash,
       mobile_last_four = excluded.mobile_last_four,
       updated_at = excluded.updated_at`,
  )
    .bind(accountId, input.organisationId, input.globalIdentityId, input.mobileHash, input.mobileHash, input.mobileLastFour, input.now, input.now)
    .run();

  const account = await c.env.DB.prepare("select id, global_identity_id, login_enabled, status from login_accounts where organisation_id = ? and mobile_normalized = ?")
    .bind(input.organisationId, input.mobileHash)
    .first<LoginAccountRecord>();
  if (!account) throw new Error("Student portal login account provisioning failed");
  return account;
}

async function ensureOrganisationMembership(
  c: AppContext,
  input: {
    organisationId: string;
    globalIdentityId: string;
    loginAccountId: string;
    now: string;
  },
) {
  const membershipId = createOpaqueId("omem");
  await c.env.DB.prepare(
    `insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at)
     values (?, ?, ?, ?, 'active', ?, ?)
     on conflict(global_identity_id, organisation_id) do update set
       login_account_id = organisation_memberships.login_account_id,
       updated_at = excluded.updated_at`,
  )
    .bind(membershipId, input.globalIdentityId, input.organisationId, input.loginAccountId, input.now, input.now)
    .run();

  const membership = await membershipForIdentityOrganisation(c, input.globalIdentityId, input.organisationId);
  if (!membership) throw new Error("Student portal organisation membership provisioning failed");
  return membership.id;
}

type LoginAccountRecord = {
  id: string;
  global_identity_id: string | null;
  login_enabled: number;
  status: string;
};

async function loginAccountById(c: AppContext, loginAccountId: string) {
  return c.env.DB.prepare(
    `select id, global_identity_id, login_enabled, status
     from login_accounts
     where id = ?
     limit 1`,
  )
    .bind(loginAccountId)
    .first<LoginAccountRecord>();
}

async function membershipForIdentityOrganisation(c: AppContext, globalIdentityId: string, organisationId: string) {
  return c.env.DB.prepare(
    `select id, login_account_id, status
     from organisation_memberships
     where global_identity_id = ? and organisation_id = ?
     limit 1`,
  )
    .bind(globalIdentityId, organisationId)
    .first<{ id: string; login_account_id: string; status: string }>();
}

async function ensureLoginAccountPerson(c: AppContext, loginAccountId: string, personId: string, now: string) {
  const activeLinks = await c.env.DB.prepare(
    "select count(*) as count from login_account_people where login_account_id = ? and is_available = 1",
  )
    .bind(loginAccountId)
    .first<{ count: number }>();
  const isDefault = Number(activeLinks?.count || 0) === 0 ? 1 : 0;
  const result = await c.env.DB.prepare(
    `insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
     values (?, ?, 'self', ?, 1, ?)
     on conflict(login_account_id, person_id) do update set
       access_type = excluded.access_type,
       is_available = 1,
       is_default = case
         when login_account_people.is_default = 1 then 1
         when not exists (
           select 1
           from login_account_people existing
           where existing.login_account_id = excluded.login_account_id
             and existing.person_id != excluded.person_id
             and existing.is_available = 1
             and existing.is_default = 1
         ) then 1
         else login_account_people.is_default
       end
     where login_account_people.access_type = 'self'`,
  )
    .bind(loginAccountId, personId, isDefault, now)
    .run();
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0) > 0;
}

async function accountPersonLink(c: AppContext, loginAccountId: string, personId: string) {
  return c.env.DB.prepare(
    `select person_id, access_type, is_default, is_available
     from login_account_people
     where login_account_id = ?
       and person_id = ?
     limit 1`,
  )
    .bind(loginAccountId, personId)
    .first<{ person_id: string; access_type: string; is_default: number; is_available: number }>();
}

async function availableAccountPersonLinks(c: AppContext, loginAccountId: string) {
  const rows = await c.env.DB.prepare(
    `select person_id, access_type, is_default
     from login_account_people
     where login_account_id = ?
       and is_available = 1`,
  )
    .bind(loginAccountId)
    .all<{ person_id: string; access_type: string; is_default: number }>();
  return rows.results || [];
}

async function studentRoleStatus(c: AppContext, organisationId: string, personId: string) {
  const role = await c.env.DB.prepare(
    `select id
     from roles
     where organisation_id = ?
       and code = 'student'
     limit 1`,
  )
    .bind(organisationId)
    .first<{ id: string }>();
  if (!role) return { status: "missing_role_config" as const };
  const existing = await c.env.DB.prepare(
    `select status
     from person_roles
     where person_id = ?
       and role_id = ?
       and branch_key = ''
     limit 1`,
  )
    .bind(personId, role.id)
    .first<{ status: string }>();
  if (!existing) return { status: "missing" as const, roleId: role.id };
  return { status: existing.status === "active" ? "active" as const : "inactive" as const, roleId: role.id, roleStatus: existing.status };
}

async function ensureStudentRole(
  c: AppContext,
  organisationId: string,
  personId: string,
  now: string,
  policy: "ensure_active" | "preserve_existing_status",
) {
  const roleState = await studentRoleStatus(c, organisationId, personId);
  if (roleState.status === "missing_role_config") throw new Error("Student role is not configured");
  if (roleState.status === "active") return { ok: true as const, created: false };
  if (roleState.status === "inactive" && policy === "preserve_existing_status") {
    return { ok: false as const, reason: "student_role_not_active" };
  }

  const result = await c.env.DB.prepare(
    `insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at)
     values (?, ?, null, '', 'active', ?)
     on conflict(person_id, role_id, branch_key) do update set
       status = 'active'`,
  )
    .bind(personId, roleState.roleId, now)
    .run();
  return { ok: true as const, created: Number(result.meta?.changes ?? result.meta?.rows_written ?? 0) > 0 };
}
