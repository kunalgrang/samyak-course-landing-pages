import type { AppContext } from "./http";
import { ORG_ID, lookupPortalProfilesByMobile, mobileHash } from "./auth-store";
import { createOpaqueId, encryptText, hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";
import type { StaffContext } from "./staff-auth";

type StudentRecord = {
  student_id: string;
  student_number: string;
  person_id: string;
  branch_id: string;
  current_status: string;
  person_status: string;
};

type StudentNameRecord = StudentRecord & {
  people_full_name: string;
  people_public_name: string | null;
  people_updated_at: string;
  official_full_name: string | null;
  identity_updated_at: string | null;
};

type ContactRecord = {
  id: string;
  normalized_value: string;
  last_four: string | null;
  is_primary: number;
  status: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
};

type D1RunResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

export type MobileChangeResult =
  | {
      ok: true;
      studentId: string;
      studentNumber: string;
      personId: string;
      idempotent: boolean;
      mobileDisplay: string;
      oldLastFour: string | null;
      newLastFour: string;
      sharedMobileMatches: SharedMobileMatch[];
      otpProfiles: number;
    }
  | { ok: false; status: number; code: string; message: string; sharedMobileMatches?: SharedMobileMatch[] };

export type SharedMobileMatch = {
  personId: string;
  displayName: string;
  studentId: string | null;
  studentNumber: string | null;
  status: string | null;
};

export type NameChangeResult =
  | {
      ok: true;
      studentId: string;
      studentNumber: string;
      personId: string;
      fullName: string;
      idempotent: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

export async function changeStudentFullName(
  c: AppContext,
  staff: StaffContext,
  studentId: string,
  input: { fullName: string; expectedBasicDetailsVersion: string },
): Promise<NameChangeResult> {
  const student = await getStudentNameForMaintenance(c, studentId);
  if (!student) return { ok: false, status: 404, code: "student_not_found", message: "Student was not found." };
  if (student.person_status === "archived") return { ok: false, status: 404, code: "student_not_found", message: "Student was not found." };
  if (!(await hasOwnerMaintenanceAccessForBranch(c, staff, student.branch_id))) {
    return { ok: false, status: 403, code: "forbidden", message: "Only owner accounts can edit student basic details." };
  }

  const fullName = normalizeStudentFullName(input.fullName);
  if (!fullName.ok) return fullName;

  const currentVersion = await studentBasicDetailsVersionForRecord(c, student);
  if (input.expectedBasicDetailsVersion !== currentVersion) {
    return { ok: false, status: 409, code: "stale_student", message: "Student details changed. Refresh the profile and try again." };
  }

  const currentName = student.official_full_name || student.people_full_name || student.people_public_name || "";
  if (currentName === fullName.value && student.people_full_name === fullName.value && (student.people_public_name || fullName.value) === fullName.value) {
    return {
      ok: true,
      studentId: student.student_id,
      studentNumber: student.student_number,
      personId: student.person_id,
      fullName: fullName.value,
      idempotent: true,
    };
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (student.identity_updated_at) {
    statements.push(
      c.env.DB.prepare(
        `update person_identity_details
         set official_full_name = ?, updated_at = ?
         where person_id = ? and official_full_name = ? and updated_at = ?`,
      ).bind(fullName.value, now, student.person_id, student.official_full_name, student.identity_updated_at),
    );
  }
  const peopleStatementIndex = statements.length;
  statements.push(
    c.env.DB.prepare(
      `update people
       set full_name = ?, public_name = ?, updated_at = ?
       where id = ? and organisation_id = ? and full_name = ? and coalesce(public_name, '') = coalesce(?, '') and updated_at = ?`,
    ).bind(fullName.value, fullName.value, now, student.person_id, ORG_ID, student.people_full_name, student.people_public_name, student.people_updated_at),
  );
  statements.push(
    c.env.DB.prepare(
      `insert into audit_logs
         (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, ?, ?, ?, 'student_name_changed', 'student', ?, ?, ?)`,
    ).bind(
      createOpaqueId("audit"),
      ORG_ID,
      student.branch_id,
      staff.loginAccountId,
      staff.activePersonId,
      student.student_id,
      JSON.stringify({
        studentId: student.student_id,
        studentNumber: student.student_number,
        personId: student.person_id,
        changedFields: ["fullName"],
        oldNameFingerprint: await hmacHex(c.env.SESSION_PEPPER, "student-name-audit", currentName),
        newNameFingerprint: await hmacHex(c.env.SESSION_PEPPER, "student-name-audit", fullName.value),
      }),
      now,
    ),
  );

  const results = await c.env.DB.batch(statements);
  if (student.identity_updated_at && !changed(results[0] as D1RunResult)) {
    return { ok: false, status: 409, code: "stale_student", message: "Student details changed. Refresh the profile and try again." };
  }
  if (!changed(results[peopleStatementIndex] as D1RunResult)) {
    return { ok: false, status: 409, code: "stale_student", message: "Student details changed. Refresh the profile and try again." };
  }

  return {
    ok: true,
    studentId: student.student_id,
    studentNumber: student.student_number,
    personId: student.person_id,
    fullName: fullName.value,
    idempotent: false,
  };
}

export async function changeStudentPrimaryMobile(
  c: AppContext,
  staff: StaffContext,
  studentId: string,
  input: { newMobile: string; confirmSharedMobile: boolean; reason?: string; expectedContactVersion: string },
): Promise<MobileChangeResult> {
  const student = await getStudentForMaintenance(c, studentId);
  if (!student) return { ok: false, status: 404, code: "student_not_found", message: "Student was not found." };
  if (student.person_status === "archived") return { ok: false, status: 404, code: "student_not_found", message: "Student was not found." };
  if (!(await hasOwnerMaintenanceAccessForBranch(c, staff, student.branch_id))) {
    return { ok: false, status: 403, code: "forbidden", message: "Only owner accounts can maintain student contact details." };
  }

  const normalizedMobile = normalizeIndianMobile(input.newMobile);
  if (!normalizedMobile) return { ok: false, status: 400, code: "invalid_mobile", message: "Enter a valid 10-digit Indian mobile number." };

  const now = new Date().toISOString();
  const lookupHash = await mobileHash(c, normalizedMobile);
  const currentPrimary = await getCurrentPrimaryMobileContact(c, student.person_id);
  if (!currentPrimary) return { ok: false, status: 409, code: "contact_state_invalid", message: "Student does not have an active primary mobile to replace." };
  const currentVersion = await contactVersion(c, student.person_id, currentPrimary);
  if (input.expectedContactVersion !== currentVersion) {
    return { ok: false, status: 409, code: "stale_contact", message: "Student contact changed. Refresh the profile and try again." };
  }

  if (currentPrimary.normalized_value === lookupHash) {
    return {
      ok: true,
      studentId: student.student_id,
      studentNumber: student.student_number,
      personId: student.person_id,
      idempotent: true,
      mobileDisplay: maskMobileByLastFour(normalizedMobile.slice(-4)),
      oldLastFour: currentPrimary.last_four,
      newLastFour: normalizedMobile.slice(-4),
      sharedMobileMatches: [],
      otpProfiles: (await lookupPortalProfilesByMobile(c, normalizedMobile)).profiles.filter((profile) => profile.personId === student.person_id).length,
    };
  }

  const sharedMobileMatches = await findActiveSharedMobileMatches(c, lookupHash, student.person_id);
  if (sharedMobileMatches.length > 0 && !input.confirmSharedMobile) {
    return {
      ok: false,
      status: 409,
      code: "shared_mobile_confirmation_required",
      message: "This mobile is already used by another student/person. Confirm shared mobile use to continue.",
      sharedMobileMatches,
    };
  }

  const existingContact = await getPersonMobileContactByHash(c, student.person_id, lookupHash);
  const newContactId = existingContact?.id || createOpaqueId("contact");
  const ciphertext = existingContact ? null : await encryptText(c.env.SESSION_PEPPER, `contact:${newContactId}`, normalizedMobile);
  const oldLoginAccount = await c.env.DB.prepare("select id from login_accounts where organisation_id = ? and mobile_normalized = ?")
    .bind(ORG_ID, currentPrimary.normalized_value)
    .first<{ id: string }>();

  const currentPrimaryGuard = `exists (
    select 1
    from person_contacts expected_contact
    where expected_contact.id = ?
      and expected_contact.person_id = ?
      and expected_contact.contact_type = 'mobile'
      and expected_contact.is_primary = 1
  )`;

  const statements: D1PreparedStatement[] = [];
  const activationStatementIndex = statements.length;
  if (existingContact) {
    statements.push(
      c.env.DB.prepare(`update person_contacts set is_primary = 1, last_four = ?, updated_at = ? where id = ? and person_id = ? and ${currentPrimaryGuard}`)
        .bind(normalizedMobile.slice(-4), now, newContactId, student.person_id, currentPrimary.id, student.person_id),
      c.env.DB.prepare(
        `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, valid_until, status, created_at, updated_at)
         select ?, 'student', 1, null, 'active', ?, ?
         where ${currentPrimaryGuard}
         on conflict(contact_id) do update set status = 'active', valid_until = null, updated_at = excluded.updated_at`,
      ).bind(newContactId, now, now, currentPrimary.id, student.person_id),
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        `insert into person_contacts
           (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
         select ?, ?, 'mobile', ?, null, ?, 1, 0, ?, ?
         where ${currentPrimaryGuard}`,
      ).bind(newContactId, student.person_id, lookupHash, normalizedMobile.slice(-4), now, now, currentPrimary.id, student.person_id),
      c.env.DB.prepare(
        `insert into person_contact_details
           (contact_id, belongs_to, is_whatsapp, valid_until, status, created_at, updated_at)
         select ?, 'student', 1, null, 'active', ?, ?
         where exists (select 1 from person_contacts where id = ? and person_id = ?)`,
      ).bind(newContactId, now, now, newContactId, student.person_id),
      c.env.DB.prepare(
        `insert into person_contact_secrets
           (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
         select ?, ?, 'v1', ?, ?
         where exists (select 1 from person_contacts where id = ? and person_id = ?)`,
      ).bind(newContactId, ciphertext, now, now, newContactId, student.person_id),
    );
  }

  statements.push(
    c.env.DB.prepare(
      `update person_contact_details
       set status = 'previous', valid_until = coalesce(valid_until, ?), updated_at = ?
       where contact_id in (select id from person_contacts where person_id = ? and contact_type = 'mobile')
         and contact_id != ?
         and status = 'active'
         and ${currentPrimaryGuard}`,
    ).bind(now, now, student.person_id, newContactId, currentPrimary.id, student.person_id),
  );

  if (oldLoginAccount) {
    statements.push(
      c.env.DB.prepare(`update login_account_people set is_available = 0 where login_account_id = ? and person_id = ? and ${currentPrimaryGuard}`)
        .bind(oldLoginAccount.id, student.person_id, currentPrimary.id, student.person_id),
      c.env.DB.prepare(`update user_sessions set active_person_id = null where login_account_id = ? and active_person_id = ? and ${currentPrimaryGuard}`)
        .bind(oldLoginAccount.id, student.person_id, currentPrimary.id, student.person_id),
    );
  }

  statements.push(
    c.env.DB.prepare(
      `insert into audit_logs
         (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       select ?, ?, ?, ?, ?, 'student_mobile_changed', 'student', ?, ?, ?
       where ${currentPrimaryGuard}`,
    ).bind(
      createOpaqueId("audit"),
      ORG_ID,
      student.branch_id,
      staff.loginAccountId,
      staff.activePersonId,
      student.student_id,
      JSON.stringify({
        studentId: student.student_id,
        studentNumber: student.student_number,
        personId: student.person_id,
        oldLastFour: currentPrimary.last_four,
        newLastFour: normalizedMobile.slice(-4),
        sharedMobileConfirmed: sharedMobileMatches.length > 0 && input.confirmSharedMobile,
        reason: input.reason || null,
      }),
      now,
      currentPrimary.id,
      student.person_id,
    ),
    c.env.DB.prepare(`update person_contacts set is_primary = 0, updated_at = ? where person_id = ? and contact_type = 'mobile' and id != ? and ${currentPrimaryGuard}`)
      .bind(now, student.person_id, newContactId, currentPrimary.id, student.person_id),
  );

  const results = await c.env.DB.batch(statements);
  if (!changed(results[activationStatementIndex] as D1RunResult)) {
    return { ok: false, status: 409, code: "stale_contact", message: "Student contact changed. Refresh the profile and try again." };
  }
  if ((await countActivePrimaryMobiles(c, student.person_id)) !== 1) {
    return { ok: false, status: 409, code: "contact_state_invalid", message: "Student contact state needs review before another change." };
  }

  const otpProfiles = (await lookupPortalProfilesByMobile(c, normalizedMobile)).profiles.filter((profile) => profile.personId === student.person_id).length;
  return {
    ok: true,
    studentId: student.student_id,
    studentNumber: student.student_number,
    personId: student.person_id,
    idempotent: false,
    mobileDisplay: maskMobileByLastFour(normalizedMobile.slice(-4)),
    oldLastFour: currentPrimary.last_four,
    newLastFour: normalizedMobile.slice(-4),
    sharedMobileMatches,
    otpProfiles,
  };
}

export async function getStudentContactVersion(c: AppContext, personId: string) {
  return contactVersion(c, personId, await getCurrentPrimaryMobileContact(c, personId));
}

export async function getStudentBasicDetailsVersion(c: AppContext, studentId: string) {
  const student = await getStudentNameForMaintenance(c, studentId);
  return student ? studentBasicDetailsVersionForRecord(c, student) : null;
}

export async function getStudentContactHistory(c: AppContext, personId: string) {
  const rows = await c.env.DB.prepare(
    `select person_contacts.last_four, person_contacts.is_primary,
            coalesce(person_contact_details.status, 'active') as status,
            person_contact_details.valid_until,
            person_contacts.created_at,
            person_contacts.updated_at
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
     order by person_contacts.is_primary desc,
              case coalesce(person_contact_details.status, 'active') when 'active' then 1 when 'previous' then 2 else 3 end,
              person_contacts.updated_at desc`,
  )
    .bind(personId)
    .all<{ last_four: string | null; is_primary: number; status: string; valid_until: string | null; created_at: string; updated_at: string }>();
  return (rows.results || []).map((row) => ({
    mobileDisplay: maskMobileByLastFour(row.last_four || ""),
    lastFour: row.last_four,
    isPrimary: row.is_primary === 1,
    status: row.status,
    changedAt: row.updated_at || row.valid_until || row.created_at,
  }));
}

async function getStudentForMaintenance(c: AppContext, studentId: string) {
  return c.env.DB.prepare(
    `select students.id as student_id, students.student_number, students.person_id,
            students.home_branch_id as branch_id, students.current_status,
            people.status as person_status
     from students
     join people on people.id = students.person_id
       and people.organisation_id = students.organisation_id
     where students.id = ?
       and students.organisation_id = ?`,
  )
    .bind(studentId, ORG_ID)
    .first<StudentRecord>();
}

async function getStudentNameForMaintenance(c: AppContext, studentId: string) {
  return c.env.DB.prepare(
    `select students.id as student_id, students.student_number, students.person_id,
            students.home_branch_id as branch_id, students.current_status,
            people.status as person_status,
            people.full_name as people_full_name,
            people.public_name as people_public_name,
            people.updated_at as people_updated_at,
            person_identity_details.official_full_name,
            person_identity_details.updated_at as identity_updated_at
     from students
     join people on people.id = students.person_id
       and people.organisation_id = students.organisation_id
     left join person_identity_details on person_identity_details.person_id = people.id
     where students.id = ?
       and students.organisation_id = ?`,
  )
    .bind(studentId, ORG_ID)
    .first<StudentNameRecord>();
}

async function getCurrentPrimaryMobileContact(c: AppContext, personId: string) {
  return c.env.DB.prepare(
    `select person_contacts.id, person_contacts.normalized_value, person_contacts.last_four,
            person_contacts.is_primary, coalesce(person_contact_details.status, 'active') as status,
            person_contact_details.valid_until, person_contacts.created_at, person_contacts.updated_at
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
       and person_contacts.is_primary = 1
       and coalesce(person_contact_details.status, 'active') = 'active'
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
     order by person_contacts.updated_at desc
     limit 1`,
  )
    .bind(personId, new Date().toISOString())
    .first<ContactRecord>();
}

async function getPersonMobileContactByHash(c: AppContext, personId: string, lookupHash: string) {
  return c.env.DB.prepare(
    `select person_contacts.id, person_contacts.normalized_value, person_contacts.last_four,
            person_contacts.is_primary, coalesce(person_contact_details.status, 'active') as status,
            person_contact_details.valid_until, person_contacts.created_at, person_contacts.updated_at
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
       and person_contacts.normalized_value = ?
     limit 1`,
  )
    .bind(personId, lookupHash)
    .first<ContactRecord>();
}

async function findActiveSharedMobileMatches(c: AppContext, lookupHash: string, exceptPersonId: string) {
  const now = new Date().toISOString();
  const rows = await c.env.DB.prepare(
    `select people.id as person_id,
            coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as display_name,
            students.id as student_id,
            students.student_number,
            students.current_status
     from person_contacts
     join people on people.id = person_contacts.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     left join students on students.person_id = people.id
       and students.organisation_id = people.organisation_id
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where person_contacts.contact_type = 'mobile'
       and person_contacts.normalized_value = ?
       and person_contacts.person_id != ?
       and people.organisation_id = ?
       and people.status != 'archived'
       and coalesce(person_contact_details.status, 'active') = 'active'
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
     order by people.full_name
     limit 5`,
  )
    .bind(lookupHash, exceptPersonId, ORG_ID, now)
    .all<{ person_id: string; display_name: string; student_id: string | null; student_number: string | null; current_status: string | null }>();
  return (rows.results || []).map((row) => ({
    personId: row.person_id,
    displayName: row.display_name,
    studentId: row.student_id,
    studentNumber: row.student_number,
    status: row.current_status,
  }));
}

async function countActivePrimaryMobiles(c: AppContext, personId: string) {
  const row = await c.env.DB.prepare(
    `select count(*) as count
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
       and person_contacts.is_primary = 1
       and coalesce(person_contact_details.status, 'active') = 'active'
       and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)`,
  )
    .bind(personId, new Date().toISOString())
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

async function hasOwnerMaintenanceAccessForBranch(c: AppContext, staff: StaffContext, branchId: string) {
  const row = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code = 'owner'
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     limit 1`,
  )
    .bind(staff.loginAccountId, ORG_ID, branchId)
    .first<{ ok: number }>();
  return Boolean(row);
}

async function contactVersion(c: AppContext, personId: string, contact: ContactRecord | null) {
  const value = contact
    ? `${personId}:${contact.id}:${contact.normalized_value}:${contact.is_primary}:${contact.status || ""}:${contact.valid_until || ""}:${contact.updated_at}`
    : `${personId}:no-active-primary`;
  return hmacHex(c.env.SESSION_PEPPER, "student-contact-version", value);
}

async function studentBasicDetailsVersionForRecord(c: AppContext, student: StudentNameRecord) {
  const value = [
    student.student_id,
    student.person_id,
    student.people_full_name,
    student.people_public_name || "",
    student.people_updated_at,
    student.official_full_name || "",
    student.identity_updated_at || "",
  ].join(":");
  return hmacHex(c.env.SESSION_PEPPER, "student-basic-details-version", value);
}

function normalizeStudentFullName(value: string): { ok: true; value: string } | { ok: false; status: number; code: string; message: string } {
  const fullName = value.trim().replace(/\s+/g, " ");
  if (fullName.length < 2) return { ok: false, status: 400, code: "invalid_name", message: "Enter the student's full name." };
  if (fullName.length > 120) return { ok: false, status: 400, code: "invalid_name", message: "Student name is too long." };
  if (/[\u0000-\u001F\u007F]/.test(fullName)) return { ok: false, status: 400, code: "invalid_name", message: "Student name contains unsupported characters." };
  return { ok: true, value: fullName };
}

function changed(result: D1RunResult | null | undefined) {
  return Number(result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0;
}

function maskMobileByLastFour(lastFour: string) {
  return lastFour ? `******${lastFour}` : "Protected";
}
