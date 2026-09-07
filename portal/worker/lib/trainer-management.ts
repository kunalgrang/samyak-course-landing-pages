import { ORG_ID, mobileHash } from "./auth-store";
import { createOpaqueId, decryptText, encryptText } from "./crypto";
import type { AppContext } from "./http";
import { maskMobile, normalizeIndianMobile } from "./mobile";
import type { StaffContext } from "./staff-auth";

export const TRAINER_MANAGEMENT_ROLES = ["owner", "system_admin", "admin"] as const;
const TRAINER_ROLE_CODE = "trainer";
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

type FieldErrors = Record<string, string[]>;

export type TrainerInput = {
  fullName: string;
  mobile: string;
  email?: string;
  branchId: string;
  status?: "active" | "inactive";
  existingPersonId?: string;
  createSeparatePerson?: boolean;
};

export type TrainerUpdateInput = {
  fullName: string;
  email?: string;
};

export type TrainerCandidate = {
  personId: string;
  displayName: string;
  branchId: string | null;
  branchName: string;
  personStatus: string;
  roles: string[];
  studentNumber: string | null;
  trainerStatus: string | null;
  mobileDisplay: string;
};

type TrainerRow = {
  person_id: string;
  display_name: string;
  branch_id: string | null;
  branch_name: string | null;
  person_status: string;
  trainer_status: string;
  mobile_last_four: string | null;
  email_contact_id: string | null;
  email_ciphertext: string | null;
  active_batch_count: number;
  teaching_batch_count: number;
  completed_batch_count: number;
};

type BatchRow = {
  id: string;
  name: string;
  status: string;
  branch_name: string | null;
  days_of_week_json: string;
  start_time: string;
  end_time: string;
  active_students: number;
  course_pairs: string | null;
};

export async function listManagedTrainers(c: AppContext, staff: StaffContext, query: { q?: string; status?: string; branchId?: string; limit?: number; offset?: number }) {
  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Math.trunc(Number(query.offset || 0)));
  const bindings: unknown[] = [ORG_ID, TRAINER_ROLE_CODE];
  let where = "people.organisation_id = ? and roles.code = ?";
  if (query.status && query.status !== "all") {
    where += " and coalesce(person_roles.status, 'active') = ?";
    bindings.push(query.status);
  }
  if (query.branchId) {
    if (!(await hasTrainerManagementBranchAccess(c, staff, query.branchId))) {
      return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this branch." };
    }
    where += " and coalesce(person_roles.branch_id, people.home_branch_id) = ?";
    bindings.push(query.branchId);
  } else {
    where += branchScopeSql(staff, "coalesce(person_roles.branch_id, people.home_branch_id)", bindings);
  }
  const normalizedSearchMobile = query.q ? normalizeIndianMobile(query.q) : null;
  const searchMobileHash = normalizedSearchMobile ? await mobileHash(c, normalizedSearchMobile) : null;
  if (query.q?.trim()) {
    const search = `%${query.q.trim()}%`;
    where += ` and (
      people.full_name like ?
      or people.public_name like ?
      or branches.name like ?
      or email_contact.display_value like ?
      or primary_mobile.last_four like ?
      ${searchMobileHash ? "or primary_mobile.normalized_value = ?" : ""}
    )`;
    bindings.push(search, search, search, search, search);
    if (searchMobileHash) bindings.push(searchMobileHash);
  }
  const rows = await c.env.DB.prepare(
    `select
       people.id as person_id,
       coalesce(people.public_name, people.full_name) as display_name,
       coalesce(person_roles.branch_id, people.home_branch_id) as branch_id,
       branches.name as branch_name,
       people.status as person_status,
       coalesce(person_roles.status, 'active') as trainer_status,
       primary_mobile.last_four as mobile_last_four,
       email_contact.id as email_contact_id,
       email_secret.value_ciphertext as email_ciphertext,
       coalesce(active_counts.active_batch_count, 0) as active_batch_count,
       coalesce(teaching_counts.teaching_batch_count, 0) as teaching_batch_count,
       coalesce(completed_counts.completed_batch_count, 0) as completed_batch_count
     from person_roles
     join roles on roles.id = person_roles.role_id and roles.organisation_id = ?
     join people on people.id = person_roles.person_id and people.organisation_id = roles.organisation_id
     left join branches on branches.id = coalesce(person_roles.branch_id, people.home_branch_id) and branches.organisation_id = people.organisation_id
     left join person_contacts primary_mobile on primary_mobile.person_id = people.id and primary_mobile.contact_type = 'mobile' and primary_mobile.is_primary = 1
     left join person_contacts email_contact on email_contact.person_id = people.id and email_contact.contact_type = 'email' and email_contact.is_primary = 1
     left join person_contact_secrets email_secret on email_secret.contact_id = email_contact.id
     left join (
       select primary_trainer_person_id, count(*) as active_batch_count
       from batches where organisation_id = ? and status = 'active' group by primary_trainer_person_id
     ) active_counts on active_counts.primary_trainer_person_id = people.id
     left join (
       select primary_trainer_person_id, count(*) as teaching_batch_count
       from batches where organisation_id = ? and status in ('active', 'inactive') group by primary_trainer_person_id
     ) teaching_counts on teaching_counts.primary_trainer_person_id = people.id
     left join (
       select primary_trainer_person_id, count(*) as completed_batch_count
       from batches where organisation_id = ? and status = 'completed' group by primary_trainer_person_id
     ) completed_counts on completed_counts.primary_trainer_person_id = people.id
     where ${where}
     order by display_name collate nocase
     limit ? offset ?`,
  )
    .bind(ORG_ID, ORG_ID, ORG_ID, ORG_ID, ...bindings, limit + 1, offset)
    .all<TrainerRow>();
  const mapped = await Promise.all((rows.results || []).slice(0, limit).map((row) => mapTrainerRow(c, row)));
  return {
    ok: true as const,
    trainers: mapped,
    pagination: { limit, offset, hasMore: (rows.results || []).length > limit },
  };
}

export async function findTrainerPersonCandidates(c: AppContext, staff: StaffContext, mobileInput: string) {
  const normalizedMobile = normalizeIndianMobile(mobileInput);
  if (!normalizedMobile) return { ok: false as const, status: 400, code: "invalid_mobile", message: "Enter a valid 10-digit Indian mobile number." };
  const candidates = await candidatesByMobile(c, staff, normalizedMobile);
  return { ok: true as const, candidates };
}

export async function createManagedTrainer(c: AppContext, staff: StaffContext, input: TrainerInput) {
  const validated = await validateCreateInput(c, staff, input);
  if (!validated.ok) return validated;
  const { fullName, branchId, normalizedMobile, email, candidatePersonId, createSeparatePerson, trainerStatus } = validated;
  const now = new Date().toISOString();
  const lookupHash = await mobileHash(c, normalizedMobile);
  const candidates = await candidatesByMobile(c, staff, normalizedMobile);
  let personId = candidatePersonId || "";
  let createdPerson = false;

  if (!personId && candidates.length && !createSeparatePerson) {
    return {
      ok: false as const,
      status: 409,
      code: "person_choice_required",
      message: "This mobile is already linked to an existing Person. Choose a Person or create a separate Person.",
      candidates,
    };
  }
  if (personId && !candidates.some((candidate) => candidate.personId === personId)) {
    return { ok: false as const, status: 400, code: "invalid_person_choice", message: "Selected Person is not linked to this mobile number." };
  }
  if (!personId) {
    personId = createOpaqueId("person");
    createdPerson = true;
  }

  const role = await trainerRole(c);
  if (!role) return { ok: false as const, status: 500, code: "trainer_role_missing", message: "Trainer role is not configured." };
  const existingRole = await getTrainerRoleForPerson(c, personId, branchId);
  if (existingRole?.status === trainerStatus) {
    await ensureTrainerLoginLinkage(c, personId, normalizedMobile, lookupHash, now, createdPerson);
    return { ok: true as const, personId, createdPerson: false, reusedPerson: Boolean(candidatePersonId), alreadyTrainer: true };
  }

  const statements: D1PreparedStatement[] = [];
  if (createdPerson) {
    statements.push(
      c.env.DB.prepare(
        `insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).bind(personId, ORG_ID, branchId, fullName, fullName, now, now),
    );
  } else {
    statements.push(c.env.DB.prepare("update people set home_branch_id = coalesce(home_branch_id, ?), updated_at = ? where id = ? and organisation_id = ?").bind(branchId, now, personId, ORG_ID));
  }
  statements.push(...(await mobileContactStatements(c, personId, normalizedMobile, lookupHash, now, createdPerson)));
  if (email) statements.push(...(await emailContactStatements(c, personId, email, now)));
  statements.push(...loginLinkageStatements(c, personId, normalizedMobile, lookupHash, now, createdPerson));
  statements.push(
    existingRole
      ? c.env.DB.prepare("update person_roles set status = ?, branch_id = ?, branch_key = ? where person_id = ? and role_id = ? and branch_key = ?")
          .bind(trainerStatus, branchId, branchId, personId, role.id, branchId)
      : c.env.DB.prepare("insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at) values (?, ?, ?, ?, ?, ?)")
          .bind(personId, role.id, branchId, branchId, trainerStatus, now),
    auditStatement(c, staff, branchId, createdPerson ? "trainer_created" : existingRole ? "trainer_activated" : "trainer_role_added", "person", personId, {
      personId,
      branchId,
      status: trainerStatus,
      reusedPerson: !createdPerson,
    }),
  );
  await c.env.DB.batch(statements);
  return { ok: true as const, personId, createdPerson, reusedPerson: !createdPerson, alreadyTrainer: false };
}

export async function getManagedTrainer(c: AppContext, staff: StaffContext, personId: string) {
  const row = await loadTrainer(c, personId);
  if (!row) return { ok: false as const, status: 404, code: "trainer_not_found", message: "Trainer was not found." };
  if (row.branch_id && !(await hasTrainerManagementBranchAccess(c, staff, row.branch_id))) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this trainer." };
  return { ok: true as const, trainer: await mapTrainerRow(c, row), batches: await listTrainerAssignedBatches(c, personId) };
}

export async function updateManagedTrainer(c: AppContext, staff: StaffContext, personId: string, input: TrainerUpdateInput) {
  const current = await loadTrainer(c, personId);
  if (!current) return { ok: false as const, status: 404, code: "trainer_not_found", message: "Trainer was not found." };
  if (current.branch_id && !(await hasTrainerManagementBranchAccess(c, staff, current.branch_id))) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this trainer." };
  const fullName = normalizeFullName(input.fullName);
  if (!fullName.ok) return fullName;
  const email = normalizeEmail(input.email || "");
  if (!email.ok) return email;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("update people set full_name = ?, public_name = ?, updated_at = ? where id = ? and organisation_id = ?").bind(fullName.value, fullName.value, now, personId, ORG_ID),
  ];
  if (email.value) statements.push(...(await emailContactStatements(c, personId, email.value, now)));
  statements.push(auditStatement(c, staff, current.branch_id || null, "trainer_details_updated", "person", personId, { personId, changedFields: ["fullName", "email"] }));
  await c.env.DB.batch(statements);
  return { ok: true as const, personId };
}

export async function setManagedTrainerStatus(c: AppContext, staff: StaffContext, personId: string, status: "active" | "inactive") {
  const current = await loadTrainer(c, personId);
  if (!current) return { ok: false as const, status: 404, code: "trainer_not_found", message: "Trainer was not found." };
  if (current.branch_id && !(await hasTrainerManagementBranchAccess(c, staff, current.branch_id))) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this trainer." };
  if (status === "inactive") {
    const blocking = await listTrainerAssignedBatches(c, personId, true);
    if (blocking.length) {
      return {
        ok: false as const,
        status: 409,
        code: "active_batch_assignments",
        message: `This Trainer is assigned to ${blocking.length} active or inactive batch${blocking.length === 1 ? "" : "es"}. Reassign those batches before deactivation.`,
        batches: blocking,
      };
    }
  }
  if (current.trainer_status === status) return { ok: true as const, personId, idempotent: true };
  const role = await trainerRole(c);
  if (!role) return { ok: false as const, status: 500, code: "trainer_role_missing", message: "Trainer role is not configured." };
  await c.env.DB.batch([
    c.env.DB.prepare("update person_roles set status = ? where person_id = ? and role_id = ?").bind(status, personId, role.id),
    ...(status === "inactive" ? [c.env.DB.prepare("update user_sessions set active_person_id = null where active_person_id = ? and active_subject_type = 'trainer'").bind(personId)] : []),
    auditStatement(c, staff, current.branch_id || null, status === "active" ? "trainer_activated" : "trainer_deactivated", "person", personId, { personId, status }),
  ]);
  return { ok: true as const, personId, idempotent: false };
}

async function validateCreateInput(c: AppContext, staff: StaffContext, input: TrainerInput) {
  const fullName = normalizeFullName(input.fullName);
  if (!fullName.ok) return fullName;
  const normalizedMobile = normalizeIndianMobile(input.mobile);
  if (!normalizedMobile) return { ok: false as const, status: 400, code: "invalid_mobile", message: "Enter a valid 10-digit Indian mobile number.", fieldErrors: { mobile: ["Enter a valid 10-digit Indian mobile number."] } };
  const email = normalizeEmail(input.email || "");
  if (!email.ok) return email;
  const status = input.status || "active";
  const branch = await c.env.DB.prepare("select id from branches where id = ? and organisation_id = ? and status = 'active'").bind(input.branchId, ORG_ID).first<{ id: string }>();
  if (!branch) return { ok: false as const, status: 400, code: "invalid_branch", message: "Select an active branch.", fieldErrors: { branchId: ["Select an active branch."] } };
  if (!(await hasTrainerManagementBranchAccess(c, staff, input.branchId))) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this branch." };
  return {
    ok: true as const,
    fullName: fullName.value,
    normalizedMobile,
    email: email.value,
    branchId: input.branchId,
    trainerStatus: status,
    candidatePersonId: input.existingPersonId?.trim() || "",
    createSeparatePerson: Boolean(input.createSeparatePerson),
  };
}

async function candidatesByMobile(c: AppContext, staff: StaffContext, mobile: string) {
  const hash = await mobileHash(c, mobile);
  const rows = await c.env.DB.prepare(
    `select
       people.id as person_id,
       coalesce(people.public_name, people.full_name) as display_name,
       people.home_branch_id as branch_id,
       branches.name as branch_name,
       people.status as person_status,
       students.student_number,
       primary_mobile.last_four as mobile_last_four,
       group_concat(distinct roles.code) as role_codes,
       max(case when roles.code = 'trainer' then coalesce(person_roles.status, 'active') end) as trainer_status
     from person_contacts primary_mobile
     join people on people.id = primary_mobile.person_id and people.organisation_id = ?
     left join branches on branches.id = people.home_branch_id and branches.organisation_id = people.organisation_id
     left join students on students.person_id = people.id and students.organisation_id = people.organisation_id
     left join person_roles on person_roles.person_id = people.id
     left join roles on roles.id = person_roles.role_id and roles.organisation_id = people.organisation_id
     left join person_contact_details on person_contact_details.contact_id = primary_mobile.id
     where primary_mobile.contact_type = 'mobile'
       and primary_mobile.normalized_value = ?
       and people.status != 'archived'
       and coalesce(person_contact_details.status, 'active') = 'active'
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
     group by people.id
     order by display_name collate nocase
     limit 12`,
  )
    .bind(ORG_ID, hash, new Date().toISOString())
    .all<{ person_id: string; display_name: string; branch_id: string | null; branch_name: string | null; person_status: string; student_number: string | null; mobile_last_four: string | null; role_codes: string | null; trainer_status: string | null }>();
  const scoped = [];
  for (const row of rows.results || []) {
    if (row.branch_id && !(await hasTrainerManagementBranchAccess(c, staff, row.branch_id))) continue;
    scoped.push({
      personId: row.person_id,
      displayName: row.display_name,
      branchId: row.branch_id,
      branchName: row.branch_name || "",
      personStatus: row.person_status,
      roles: (row.role_codes || "").split(",").filter(Boolean).sort(),
      studentNumber: row.student_number,
      trainerStatus: row.trainer_status,
      mobileDisplay: maskMobileByLastFour(row.mobile_last_four || mobile.slice(-4)),
    });
  }
  return scoped satisfies TrainerCandidate[];
}

async function ensureTrainerLoginLinkage(c: AppContext, personId: string, mobile: string, hash: string, now: string, makePrimary: boolean) {
  await c.env.DB.batch([...(await mobileContactStatements(c, personId, mobile, hash, now, makePrimary)), ...loginLinkageStatements(c, personId, mobile, hash, now, makePrimary)]);
}

async function mobileContactStatements(c: AppContext, personId: string, mobile: string, hash: string, now: string, makePrimary: boolean) {
  const contactId = createOpaqueId("contact");
  const ciphertext = await encryptText(c.env.SESSION_PEPPER, `contact:${contactId}`, mobile);
  return [
    c.env.DB.prepare(
      `insert into person_contacts
         (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
       values (?, ?, 'mobile', ?, null, ?, ?, 0, ?, ?)
       on conflict(person_id, contact_type, normalized_value) do update set
         is_primary = case when excluded.is_primary = 1 then 1 else person_contacts.is_primary end,
         last_four = excluded.last_four,
         updated_at = excluded.updated_at`,
    ).bind(contactId, personId, hash, mobile.slice(-4), makePrimary ? 1 : 0, now, now),
    c.env.DB.prepare(
      `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
       select id, 'office', 1, 'active', ?, ? from person_contacts where person_id = ? and contact_type = 'mobile' and normalized_value = ?
       on conflict(contact_id) do update set status = 'active', valid_until = null, updated_at = excluded.updated_at`,
    ).bind(now, now, personId, hash),
    c.env.DB.prepare(
      `insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
       select id, ?, 'v1', ?, ? from person_contacts where person_id = ? and contact_type = 'mobile' and normalized_value = ?
       on conflict(contact_id) do nothing`,
    ).bind(ciphertext, now, now, personId, hash),
  ];
}

async function emailContactStatements(c: AppContext, personId: string, email: string, now: string) {
  const contactId = createOpaqueId("contact");
  const ciphertext = await encryptText(c.env.SESSION_PEPPER, `contact:${contactId}`, email);
  return [
    c.env.DB.prepare("update person_contacts set is_primary = 0, updated_at = ? where person_id = ? and contact_type = 'email' and is_primary = 1").bind(now, personId),
    c.env.DB.prepare(
      `insert into person_contacts
         (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
       values (?, ?, 'email', ?, ?, null, 1, 0, ?, ?)
       on conflict(person_id, contact_type, normalized_value) do update set display_value = excluded.display_value, is_primary = 1, updated_at = excluded.updated_at`,
    ).bind(contactId, personId, email, email, now, now),
    c.env.DB.prepare(
      `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
       select id, 'office', 0, 'active', ?, ? from person_contacts where person_id = ? and contact_type = 'email' and normalized_value = ?
       on conflict(contact_id) do update set status = 'active', valid_until = null, updated_at = excluded.updated_at`,
    ).bind(now, now, personId, email),
    c.env.DB.prepare(
      `insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
       select id, ?, 'v1', ?, ? from person_contacts where person_id = ? and contact_type = 'email' and normalized_value = ?
       on conflict(contact_id) do nothing`,
    ).bind(ciphertext, now, now, personId, email),
  ];
}

function loginLinkageStatements(c: AppContext, personId: string, mobile: string, hash: string, now: string, makeDefault: boolean) {
  const accountId = createOpaqueId("acct");
  return [
    c.env.DB.prepare(
      `insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, 1, 'active', ?, ?)
       on conflict(organisation_id, mobile_normalized) do update set mobile_hash = excluded.mobile_hash, mobile_last_four = excluded.mobile_last_four, updated_at = excluded.updated_at`,
    ).bind(accountId, ORG_ID, hash, hash, mobile.slice(-4), now, now),
    c.env.DB.prepare(
      `insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at)
       select id, ?, 'staff', ?, 1, ? from login_accounts where organisation_id = ? and mobile_normalized = ?
       on conflict(login_account_id, person_id) do update set access_type = excluded.access_type, is_available = 1`,
    ).bind(personId, makeDefault ? 1 : 0, now, ORG_ID, hash),
  ];
}

async function loadTrainer(c: AppContext, personId: string) {
  return c.env.DB.prepare(
    `select
       people.id as person_id,
       coalesce(people.public_name, people.full_name) as display_name,
       coalesce(person_roles.branch_id, people.home_branch_id) as branch_id,
       branches.name as branch_name,
       people.status as person_status,
       coalesce(person_roles.status, 'active') as trainer_status,
       primary_mobile.last_four as mobile_last_four,
       email_contact.id as email_contact_id,
       email_secret.value_ciphertext as email_ciphertext,
       coalesce(active_counts.active_batch_count, 0) as active_batch_count,
       coalesce(teaching_counts.teaching_batch_count, 0) as teaching_batch_count,
       coalesce(completed_counts.completed_batch_count, 0) as completed_batch_count
     from people
     join person_roles on person_roles.person_id = people.id
     join roles on roles.id = person_roles.role_id and roles.organisation_id = people.organisation_id and roles.code = ?
     left join branches on branches.id = coalesce(person_roles.branch_id, people.home_branch_id) and branches.organisation_id = people.organisation_id
     left join person_contacts primary_mobile on primary_mobile.person_id = people.id and primary_mobile.contact_type = 'mobile' and primary_mobile.is_primary = 1
     left join person_contacts email_contact on email_contact.person_id = people.id and email_contact.contact_type = 'email' and email_contact.is_primary = 1
     left join person_contact_secrets email_secret on email_secret.contact_id = email_contact.id
     left join (select primary_trainer_person_id, count(*) as active_batch_count from batches where organisation_id = ? and status = 'active' group by primary_trainer_person_id) active_counts on active_counts.primary_trainer_person_id = people.id
     left join (select primary_trainer_person_id, count(*) as teaching_batch_count from batches where organisation_id = ? and status in ('active', 'inactive') group by primary_trainer_person_id) teaching_counts on teaching_counts.primary_trainer_person_id = people.id
     left join (select primary_trainer_person_id, count(*) as completed_batch_count from batches where organisation_id = ? and status = 'completed' group by primary_trainer_person_id) completed_counts on completed_counts.primary_trainer_person_id = people.id
     where people.id = ? and people.organisation_id = ?
     limit 1`,
  )
    .bind(TRAINER_ROLE_CODE, ORG_ID, ORG_ID, ORG_ID, personId, ORG_ID)
    .first<TrainerRow>();
}

async function mapTrainerRow(c: AppContext, row: TrainerRow) {
  return {
    personId: row.person_id,
    fullName: row.display_name,
    publicName: row.display_name,
    branchId: row.branch_id,
    branchName: row.branch_name || "",
    personStatus: row.person_status,
    trainerStatus: row.trainer_status,
    mobileDisplay: maskMobileByLastFour(row.mobile_last_four || ""),
    email: row.email_contact_id && row.email_ciphertext ? await readContactSecret(c, row.email_contact_id, row.email_ciphertext) : "",
    activeBatchCount: Number(row.active_batch_count || 0),
    teachingBatchCount: Number(row.teaching_batch_count || 0),
    completedBatchCount: Number(row.completed_batch_count || 0),
    trainerLoginUrl: "/trainer/login",
  };
}

async function listTrainerAssignedBatches(c: AppContext, personId: string, blockingOnly = false) {
  const rows = await c.env.DB.prepare(
    `select
       batches.id,
       batches.name,
       batches.status,
       branches.name as branch_name,
       batches.days_of_week_json,
       batches.start_time,
       batches.end_time,
       coalesce(active_counts.active_students, 0) as active_students,
       course_summary.course_pairs
     from batches
     left join branches on branches.id = batches.branch_id and branches.organisation_id = batches.organisation_id
     left join (
       select batch_id, count(*) as active_students
       from batch_memberships where status = 'active' and left_at is null group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     left join (
       select batch_courses.batch_id, group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
     where batches.organisation_id = ?
       and batches.primary_trainer_person_id = ?
       ${blockingOnly ? "and batches.status in ('active', 'inactive')" : ""}
     order by case batches.status when 'active' then 1 when 'inactive' then 2 else 3 end, batches.name collate nocase`,
  )
    .bind(ORG_ID, personId)
    .all<BatchRow>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    branchName: row.branch_name || "",
    courses: parseCoursePairs(row.course_pairs),
    daysOfWeek: parseDays(row.days_of_week_json),
    startTime: row.start_time,
    endTime: row.end_time,
    activeStudents: Number(row.active_students || 0),
  }));
}

async function trainerRole(c: AppContext) {
  return c.env.DB.prepare("select id from roles where organisation_id = ? and code = ?").bind(ORG_ID, TRAINER_ROLE_CODE).first<{ id: string }>();
}

async function getTrainerRoleForPerson(c: AppContext, personId: string, branchId: string) {
  const role = await trainerRole(c);
  if (!role) return null;
  return c.env.DB.prepare("select status from person_roles where person_id = ? and role_id = ? and branch_key = ?").bind(personId, role.id, branchId).first<{ status: string }>();
}

async function hasTrainerManagementBranchAccess(c: AppContext, staff: StaffContext, branchId: string) {
  if (staff.roles.some((role) => role === "owner" || role === "system_admin")) return true;
  const row = await c.env.DB.prepare(
    `select 1 as allowed
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code = 'admin'
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     limit 1`,
  )
    .bind(staff.loginAccountId, ORG_ID, branchId)
    .first<{ allowed: number }>();
  return Boolean(row);
}

function branchScopeSql(staff: StaffContext, column: string, bindings: unknown[]) {
  if (staff.roles.some((role) => role === "owner" || role === "system_admin")) return "";
  bindings.push(staff.loginAccountId, ORG_ID);
  return ` and exists (
    select 1 from login_account_roles lar
    join roles role_scope on role_scope.id = lar.role_id
    where lar.login_account_id = ?
      and role_scope.organisation_id = ?
      and role_scope.code = 'admin'
      and (lar.branch_id is null or lar.branch_id = ${column})
  )`;
}

function auditStatement(c: AppContext, staff: StaffContext, branchId: string | null, action: string, entityType: string, entityId: string, metadata: unknown) {
  return c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId || null, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString());
}

async function readContactSecret(c: AppContext, contactId: string, ciphertext: string) {
  try {
    return await decryptText(c.env.SESSION_PEPPER, `contact:${contactId}`, ciphertext);
  } catch {
    return "";
  }
}

function normalizeFullName(value: string): { ok: true; value: string } | { ok: false; status: number; code: string; message: string; fieldErrors?: FieldErrors } {
  const fullName = String(value || "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2) return { ok: false, status: 400, code: "invalid_name", message: "Enter the Trainer's full name.", fieldErrors: { fullName: ["Enter the Trainer's full name."] } };
  if (fullName.length > 120) return { ok: false, status: 400, code: "invalid_name", message: "Trainer name is too long.", fieldErrors: { fullName: ["Trainer name is too long."] } };
  if (/[\u0000-\u001F\u007F]/.test(fullName)) return { ok: false, status: 400, code: "invalid_name", message: "Trainer name contains unsupported characters.", fieldErrors: { fullName: ["Trainer name contains unsupported characters."] } };
  return { ok: true, value: fullName };
}

function normalizeEmail(value: string): { ok: true; value: string } | { ok: false; status: number; code: string; message: string; fieldErrors?: FieldErrors } {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return { ok: true, value: "" };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, code: "invalid_email", message: "Enter a valid email address.", fieldErrors: { email: ["Enter a valid email address."] } };
  return { ok: true, value: email };
}

function clampLimit(value: unknown) {
  const parsed = Math.trunc(Number(value || PAGE_SIZE_DEFAULT));
  if (!Number.isFinite(parsed) || parsed <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(parsed, PAGE_SIZE_MAX);
}

function maskMobileByLastFour(lastFour: string) {
  return lastFour ? maskMobile(lastFour) : "Protected";
}

function parseDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return [];
  }
  return [];
}

function parseCoursePairs(value: string | null) {
  if (!value) return [];
  return value.split(String.fromCharCode(30)).flatMap((pair) => {
    const [id, name] = pair.split(String.fromCharCode(31));
    return id ? [{ id, name: name || id }] : [];
  });
}
