import type { AppContext } from "./http";
import { createOpaqueId } from "./crypto";

export type HistoricalStudentAuthRepairResultStatus = "repaired" | "no_op" | "blocked" | "not_found" | "failed";

export type HistoricalStudentAuthRepairResult = {
  studentId: string;
  personId?: string;
  result: HistoricalStudentAuthRepairResultStatus;
  elementsCreated: string[];
  elementsReused: string[];
  elementsUnchanged: string[];
  reason?: string;
};

type CandidateRow = {
  student_id: string;
  person_id: string;
  organisation_id: string;
  mobile_normalized: string;
  mobile_last_four: string | null;
};

type IdentityRow = {
  id: string;
  status: string;
};

type AccountRow = {
  id: string;
  organisation_id: string;
  global_identity_id: string | null;
  organisation_membership_id: string | null;
  login_enabled: number;
  status: string;
  mobile_hash: string | null;
  mobile_last_four: string | null;
};

type MembershipRow = {
  id: string;
  global_identity_id: string;
  organisation_id: string;
  login_account_id: string;
  status: string;
};

type AccountPersonLinkRow = {
  person_id: string;
  access_type: string;
  is_available: number;
};

type PersonRoleRow = {
  role_id: string;
  status: string;
};

type CandidateState = {
  candidate: CandidateRow;
  identity: IdentityRow | null;
  account: AccountRow | null;
  membership: MembershipRow | null;
  links: AccountPersonLinkRow[];
  studentRoleId: string | null;
  studentRole: PersonRoleRow | null;
};

const REPAIRABLE_STUDENT_STATUSES = ["active", "completed", "alumni", "on_hold", "suspended"];

export async function repairHistoricalStudentAuthCandidate(
  c: AppContext,
  input: {
    organisationId: string;
    studentId: string;
    now: string;
    dryRun?: boolean;
  },
): Promise<HistoricalStudentAuthRepairResult> {
  const before = await loadCandidateState(c, input.organisationId, input.studentId, input.now);
  if (!before) {
    return emptyResult(input.studentId, "not_found", "student_not_found_or_not_eligible");
  }

  const safetyBlock = unsafeReason(before);
  if (safetyBlock) {
    return {
      studentId: before.candidate.student_id,
      personId: before.candidate.person_id,
      result: "blocked",
      elementsCreated: [],
      elementsReused: reusedElements(before),
      elementsUnchanged: unchangedElements(before),
      reason: safetyBlock,
    };
  }

  const missing = missingElements(before);
  if (missing.length === 0) {
    return {
      studentId: before.candidate.student_id,
      personId: before.candidate.person_id,
      result: "no_op",
      elementsCreated: [],
      elementsReused: reusedElements(before),
      elementsUnchanged: requiredElements(),
    };
  }

  if (!before.studentRoleId) {
    return {
      studentId: before.candidate.student_id,
      personId: before.candidate.person_id,
      result: "blocked",
      elementsCreated: [],
      elementsReused: reusedElements(before),
      elementsUnchanged: unchangedElements(before),
      reason: "student_role_not_configured",
    };
  }

  if (input.dryRun) {
    return {
      studentId: before.candidate.student_id,
      personId: before.candidate.person_id,
      result: "repaired",
      elementsCreated: missing,
      elementsReused: reusedElements(before),
      elementsUnchanged: unchangedElements(before),
      reason: "dry_run",
    };
  }

  const planned = planRepair(c, before, input.now);
  if (planned.statements.length) {
    const batchFailureResult = await runRepairBatch(c, input, before, planned);
    if (batchFailureResult) return batchFailureResult;
  }

  const after = await loadCandidateState(c, input.organisationId, input.studentId, input.now);
  if (!after) {
    return emptyResult(input.studentId, "blocked", "candidate_disappeared_after_repair");
  }
  const postRepairBlock = unsafeReason(after);
  if (postRepairBlock || missingElements(after).length > 0) {
    return {
      studentId: after.candidate.student_id,
      personId: after.candidate.person_id,
      result: "blocked",
      elementsCreated: planned.createdElements,
      elementsReused: reusedElements(before),
      elementsUnchanged: unchangedElements(before),
      reason: postRepairBlock || "repair_did_not_establish_required_elements",
    };
  }

  return {
    studentId: before.candidate.student_id,
    personId: before.candidate.person_id,
    result: "repaired",
    elementsCreated: planned.createdElements,
    elementsReused: reusedElements(before),
    elementsUnchanged: unchangedElements(before),
  };
}

async function runRepairBatch(
  c: AppContext,
  input: {
    organisationId: string;
    studentId: string;
    now: string;
  },
  before: CandidateState,
  planned: { statements: D1PreparedStatement[]; createdElements: string[] },
): Promise<HistoricalStudentAuthRepairResult | null> {
  try {
    const results = await c.env.DB.batch(planned.statements) as Array<{ meta?: { changes?: number; rows_written?: number } }>;
    const changedRows = results.reduce((total, result) => total + Number(result.meta?.changes ?? result.meta?.rows_written ?? 0), 0);
    if (planned.createdElements.length > 0 && changedRows === 0) {
      const after = await loadCandidateState(c, input.organisationId, input.studentId, input.now);
      if (after && unsafeReason(after) === null && missingElements(after).length === 0) {
        return {
          studentId: after.candidate.student_id,
          personId: after.candidate.person_id,
          result: "no_op",
          elementsCreated: [],
          elementsReused: reusedElements(after),
          elementsUnchanged: requiredElements(),
          reason: "concurrent_repair_completed",
        };
      }
    }
    return null;
  } catch {
    const after = await loadCandidateState(c, input.organisationId, input.studentId, input.now).catch(() => null);
    if (!after) {
      return {
        studentId: before.candidate.student_id,
        personId: before.candidate.person_id,
        result: "failed",
        elementsCreated: [],
        elementsReused: reusedElements(before),
        elementsUnchanged: unchangedElements(before),
        reason: "repair_batch_failed",
      };
    }

    const safetyBlock = unsafeReason(after);
    if (safetyBlock) {
      return {
        studentId: after.candidate.student_id,
        personId: after.candidate.person_id,
        result: "blocked",
        elementsCreated: [],
        elementsReused: reusedElements(before),
        elementsUnchanged: unchangedElements(before),
        reason: safetyBlock,
      };
    }

    if (missingElements(after).length === 0) {
      return {
        studentId: after.candidate.student_id,
        personId: after.candidate.person_id,
        result: "no_op",
        elementsCreated: [],
        elementsReused: reusedElements(after),
        elementsUnchanged: requiredElements(),
        reason: "concurrent_repair_completed",
      };
    }

    return {
      studentId: after.candidate.student_id,
      personId: after.candidate.person_id,
      result: "failed",
      elementsCreated: [],
      elementsReused: reusedElements(after),
      elementsUnchanged: unchangedElements(after),
      reason: "repair_batch_failed",
    };
  }
}

async function loadCandidateState(c: AppContext, organisationId: string, studentId: string, now: string): Promise<CandidateState | null> {
  const candidate = await c.env.DB.prepare(
    `select
       students.id as student_id,
       students.person_id,
       students.organisation_id,
       person_contacts.normalized_value as mobile_normalized,
       person_contacts.last_four as mobile_last_four
     from students
     join people on people.id = students.person_id
       and people.organisation_id = students.organisation_id
       and people.status = 'active'
     join person_contacts on person_contacts.person_id = students.person_id
       and person_contacts.contact_type = 'mobile'
       and person_contacts.is_primary = 1
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where students.id = ?
       and students.organisation_id = ?
       and students.current_status in (${REPAIRABLE_STUDENT_STATUSES.map(() => "?").join(", ")})
       and (person_contact_details.status is null or person_contact_details.status = 'active')
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
     order by person_contacts.updated_at desc, person_contacts.created_at desc
     limit 1`,
  )
    .bind(studentId, organisationId, ...REPAIRABLE_STUDENT_STATUSES, now)
    .first<CandidateRow>();
  if (!candidate) return null;

  const identity = await c.env.DB.prepare(
    "select id, status from global_identities where mobile_normalized = ? limit 1",
  )
    .bind(candidate.mobile_normalized)
    .first<IdentityRow>();

  const membership = identity
    ? await c.env.DB.prepare(
      `select id, global_identity_id, organisation_id, login_account_id, status
       from organisation_memberships
       where global_identity_id = ? and organisation_id = ?
       limit 1`,
    )
      .bind(identity.id, organisationId)
      .first<MembershipRow>()
    : null;

  const accountByMembership = membership
    ? await c.env.DB.prepare(
      `select id, organisation_id, global_identity_id, organisation_membership_id, login_enabled, status, mobile_hash, mobile_last_four
       from login_accounts
       where id = ?
       limit 1`,
    )
      .bind(membership.login_account_id)
      .first<AccountRow>()
    : null;

  const accountByMobile = await c.env.DB.prepare(
    `select id, organisation_id, global_identity_id, organisation_membership_id, login_enabled, status, mobile_hash, mobile_last_four
     from login_accounts
     where organisation_id = ? and mobile_normalized = ?
     limit 1`,
  )
    .bind(organisationId, candidate.mobile_normalized)
    .first<AccountRow>();

  const account = accountByMembership || accountByMobile || null;
  const links = account
    ? (await c.env.DB.prepare(
      `select person_id, access_type, is_available
       from login_account_people
       where login_account_id = ?`,
    )
      .bind(account.id)
      .all<AccountPersonLinkRow>()).results || []
    : [];

  const studentRole = await c.env.DB.prepare(
    `select id
     from roles
     where organisation_id = ? and code = 'student'
     limit 1`,
  )
    .bind(organisationId)
    .first<{ id: string }>();
  const personRole = studentRole
    ? await c.env.DB.prepare(
      `select role_id, status
       from person_roles
       where person_id = ? and role_id = ? and branch_key = ''
       limit 1`,
    )
      .bind(candidate.person_id, studentRole.id)
      .first<PersonRoleRow>()
    : null;

  return {
    candidate,
    identity,
    account,
    membership,
    links,
    studentRoleId: studentRole?.id || null,
    studentRole: personRole,
  };
}

function unsafeReason(state: CandidateState) {
  if (state.identity && state.identity.status !== "active") return "global_identity_not_active";
  if (state.account && state.account.organisation_id !== state.candidate.organisation_id) return "login_account_organisation_mismatch";
  if (state.account?.global_identity_id && state.identity && state.account.global_identity_id !== state.identity.id) return "login_account_identity_mismatch";
  if (state.account?.status === "disabled") return "login_account_disabled";
  if (state.account && state.account.status !== "active") return "login_account_not_active";
  if (state.account && Number(state.account.login_enabled) !== 1) return "login_disabled";
  if (state.membership?.status === "revoked") return "membership_revoked";
  if (state.membership?.status === "suspended") return "membership_suspended";
  if (state.membership && state.account && state.membership.login_account_id !== state.account.id) return "membership_login_account_mismatch";
  if (state.account?.organisation_membership_id && state.membership && state.account.organisation_membership_id !== state.membership.id) return "account_membership_mismatch";
  if (state.membership && !state.account) return "membership_login_account_missing";
  if (state.links.some((link) => link.is_available === 1 && link.person_id !== state.candidate.person_id)) return "different_linked_person";
  if (state.links.some((link) => link.person_id === state.candidate.person_id && link.access_type !== "self")) return "non_self_account_person_link";
  if (state.studentRole && state.studentRole.status !== "active") return "student_role_not_active";
  return null;
}

function missingElements(state: CandidateState) {
  const missing: string[] = [];
  if (!state.identity) missing.push("global_identity");
  if (!state.account) missing.push("login_account");
  if (!state.membership) missing.push("organisation_membership");
  if (!state.links.some((link) => link.person_id === state.candidate.person_id && link.access_type === "self" && link.is_available === 1)) missing.push("self_link");
  if (!state.studentRole || state.studentRole.status !== "active") missing.push("student_role");
  return missing;
}

function planRepair(c: AppContext, state: CandidateState, now: string) {
  const statements: D1PreparedStatement[] = [];
  const createdElements: string[] = [];
  const identityId = state.identity?.id || createOpaqueId("gident");
  const accountId = state.account?.id || createOpaqueId("acct");
  const membershipId = state.membership?.id || createOpaqueId("omem");
  const mobileHash = state.candidate.mobile_normalized;
  const mobileLastFour = state.candidate.mobile_last_four || "";

  if (!state.identity) {
    createdElements.push("global_identity");
    statements.push(c.env.DB.prepare(
      `insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
       values (?, ?, ?, ?, 'active', ?, ?)
       on conflict(mobile_normalized) do nothing`,
    ).bind(identityId, mobileHash, mobileHash, mobileLastFour, now, now));
  }

  if (!state.account) {
    createdElements.push("login_account");
    statements.push(c.env.DB.prepare(
      `insert into login_accounts (
         id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized,
         mobile_hash, mobile_last_four, login_enabled, status, last_login_at, created_at, updated_at
       ) values (?, ?, ?, null, ?, ?, ?, 1, 'active', null, ?, ?)
       on conflict(organisation_id, mobile_normalized) do nothing`,
    ).bind(accountId, state.candidate.organisation_id, identityId, mobileHash, mobileHash, mobileLastFour, now, now));
  }

  statements.push(writeConflictGuard(c, state, accountId, identityId, state.membership?.id || membershipId, now));

  if (!state.membership) {
    createdElements.push("organisation_membership");
    statements.push(c.env.DB.prepare(
      `insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at)
       select ?, ?, ?, ?, 'active', ?, ?
       where exists (
         select 1
         from login_accounts repair_account
         where repair_account.id = ?
           and repair_account.organisation_id = ?
           and repair_account.status = 'active'
           and repair_account.login_enabled = 1
           and (repair_account.global_identity_id is null or repair_account.global_identity_id = ?)
           and (repair_account.organisation_membership_id is null or repair_account.organisation_membership_id = ?)
       )
       on conflict(global_identity_id, organisation_id) do nothing`,
    ).bind(
      membershipId,
      identityId,
      state.candidate.organisation_id,
      accountId,
      now,
      now,
      accountId,
      state.candidate.organisation_id,
      identityId,
      membershipId,
    ));
  }

  if (!state.account || state.account.global_identity_id !== identityId || state.account.organisation_membership_id !== membershipId) {
    statements.push(c.env.DB.prepare(
      `update login_accounts
       set global_identity_id = ?,
           organisation_membership_id = ?,
           mobile_hash = coalesce(mobile_hash, ?),
           mobile_last_four = coalesce(mobile_last_four, ?),
           updated_at = ?
       where id = ?
         and status = 'active'
         and login_enabled = 1
         and (global_identity_id is null or global_identity_id = ?)
         and (organisation_membership_id is null or organisation_membership_id = ?)
         and not exists (
           select 1
           from login_account_people other_link
           where other_link.login_account_id = login_accounts.id
             and other_link.is_available = 1
             and other_link.person_id != ?
         )
         and not exists (
           select 1
           from login_account_people same_person_link
           where same_person_link.login_account_id = login_accounts.id
             and same_person_link.person_id = ?
             and same_person_link.access_type != 'self'
         )`,
    ).bind(identityId, membershipId, mobileHash, mobileLastFour, now, accountId, identityId, membershipId, state.candidate.person_id, state.candidate.person_id));
  }

  if (!state.links.some((link) => link.person_id === state.candidate.person_id && link.access_type === "self" && link.is_available === 1)) {
    createdElements.push("self_link");
    statements.push(c.env.DB.prepare(
      `insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
       select ?, ?, 'self', ?, 1, ?
       where exists (
         select 1
         from login_accounts repair_account
         where repair_account.id = ?
           and repair_account.organisation_id = ?
           and repair_account.status = 'active'
           and repair_account.login_enabled = 1
           and (repair_account.global_identity_id is null or repair_account.global_identity_id = ?)
           and (repair_account.organisation_membership_id is null or repair_account.organisation_membership_id = ?)
       )
       and not exists (
         select 1
         from login_account_people other_link
         where other_link.login_account_id = ?
           and other_link.is_available = 1
           and other_link.person_id != ?
       )
       and not exists (
         select 1
         from login_account_people same_person_link
         where same_person_link.login_account_id = ?
           and same_person_link.person_id = ?
           and same_person_link.access_type != 'self'
       )
       on conflict(login_account_id, person_id) do update set
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
    ).bind(
      accountId,
      state.candidate.person_id,
      state.links.some((link) => link.is_available === 1) ? 0 : 1,
      now,
      accountId,
      state.candidate.organisation_id,
      identityId,
      membershipId,
      accountId,
      state.candidate.person_id,
      accountId,
      state.candidate.person_id,
    ));
  }

  if (!state.studentRole && state.studentRoleId) {
    createdElements.push("student_role");
    statements.push(c.env.DB.prepare(
      `insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at)
       select ?, ?, null, '', 'active', ?
       where exists (
         select 1
         from login_account_people
         where login_account_id = ?
           and person_id = ?
           and access_type = 'self'
           and is_available = 1
       )
       on conflict(person_id, role_id, branch_key) do nothing`,
    ).bind(state.candidate.person_id, state.studentRoleId, now, accountId, state.candidate.person_id));
  }

  return { statements, createdElements };
}

function writeConflictGuard(
  c: AppContext,
  state: CandidateState,
  accountId: string,
  identityId: string,
  membershipId: string,
  now: string,
) {
  return c.env.DB.prepare(
    `insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
     select null, null, 'self', 0, 0, ?
     where exists (
       select 1
       from login_accounts repair_account
       where repair_account.id = ?
         and (
           repair_account.organisation_id != ?
           or repair_account.status != 'active'
           or repair_account.login_enabled != 1
           or (repair_account.global_identity_id is not null and repair_account.global_identity_id != ?)
           or (repair_account.organisation_membership_id is not null and repair_account.organisation_membership_id != ?)
           or exists (
             select 1
             from login_account_people other_link
             where other_link.login_account_id = repair_account.id
               and other_link.is_available = 1
               and other_link.person_id != ?
           )
           or exists (
             select 1
             from login_account_people same_person_link
             where same_person_link.login_account_id = repair_account.id
               and same_person_link.person_id = ?
               and same_person_link.access_type != 'self'
           )
         )
     )`,
  ).bind(now, accountId, state.candidate.organisation_id, identityId, membershipId, state.candidate.person_id, state.candidate.person_id);
}

function reusedElements(state: CandidateState) {
  const reused: string[] = [];
  if (state.identity) reused.push("global_identity");
  if (state.account) reused.push("login_account");
  if (state.membership) reused.push("organisation_membership");
  if (state.links.some((link) => link.person_id === state.candidate.person_id && link.access_type === "self" && link.is_available === 1)) reused.push("self_link");
  if (state.studentRole?.status === "active") reused.push("student_role");
  return reused;
}

function unchangedElements(state: CandidateState) {
  return reusedElements(state);
}

function requiredElements() {
  return ["global_identity", "login_account", "organisation_membership", "self_link", "student_role"];
}

function emptyResult(studentId: string, result: HistoricalStudentAuthRepairResultStatus, reason: string): HistoricalStudentAuthRepairResult {
  return {
    studentId,
    result,
    elementsCreated: [],
    elementsReused: [],
    elementsUnchanged: [],
    reason,
  };
}
