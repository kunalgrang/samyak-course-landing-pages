import type { AppContext } from "./http";
import { ORG_ID, lookupPortalProfilesByMobile, mobileHash } from "./auth-store";
import { createOpaqueId, encryptText } from "./crypto";
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

type ContactRecord = {
  id: string;
  normalized_value: string;
  last_four: string | null;
  is_primary: number;
  status: string | null;
  valid_until: string | null;
  created_at: string;
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

export async function changeStudentPrimaryMobile(
  c: AppContext,
  staff: StaffContext,
  studentId: string,
  input: { newMobile: string; confirmSharedMobile: boolean; reason?: string },
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
  if (currentPrimary?.normalized_value === lookupHash) {
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
  const oldLoginAccount = currentPrimary?.normalized_value
    ? await c.env.DB.prepare("select id from login_accounts where organisation_id = ? and mobile_normalized = ?")
        .bind(ORG_ID, currentPrimary.normalized_value)
        .first<{ id: string }>()
    : null;

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("update person_contacts set is_primary = 0, updated_at = ? where person_id = ? and contact_type = 'mobile'").bind(now, student.person_id),
    c.env.DB.prepare(
      `update person_contact_details
       set status = 'previous', valid_until = coalesce(valid_until, ?), updated_at = ?
       where contact_id in (select id from person_contacts where person_id = ? and contact_type = 'mobile')
         and contact_id != ?
         and status = 'active'`,
    ).bind(now, now, student.person_id, newContactId),
  ];

  if (existingContact) {
    statements.push(
      c.env.DB.prepare("update person_contacts set is_primary = 1, last_four = ?, updated_at = ? where id = ? and person_id = ?")
        .bind(normalizedMobile.slice(-4), now, newContactId, student.person_id),
      c.env.DB.prepare(
        `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, valid_until, status, created_at, updated_at)
         values (?, 'student', 1, null, 'active', ?, ?)
         on conflict(contact_id) do update set status = 'active', valid_until = null, updated_at = excluded.updated_at`,
      ).bind(newContactId, now, now),
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        `insert into person_contacts
           (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
         values (?, ?, 'mobile', ?, null, ?, 1, 0, ?, ?)`,
      ).bind(newContactId, student.person_id, lookupHash, normalizedMobile.slice(-4), now, now),
      c.env.DB.prepare(
        `insert into person_contact_details
           (contact_id, belongs_to, is_whatsapp, valid_until, status, created_at, updated_at)
         values (?, 'student', 1, null, 'active', ?, ?)`,
      ).bind(newContactId, now, now),
      c.env.DB.prepare(
        `insert into person_contact_secrets
           (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
         values (?, ?, 'v1', ?, ?)`,
      ).bind(newContactId, ciphertext, now, now),
    );
  }

  if (oldLoginAccount) {
    statements.push(
      c.env.DB.prepare("update login_account_people set is_available = 0 where login_account_id = ? and person_id = ?")
        .bind(oldLoginAccount.id, student.person_id),
      c.env.DB.prepare("update user_sessions set active_person_id = null where login_account_id = ? and active_person_id = ?")
        .bind(oldLoginAccount.id, student.person_id),
    );
  }

  statements.push(
    c.env.DB.prepare(
      `insert into audit_logs
         (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, ?, ?, ?, 'student_mobile_changed', 'student', ?, ?, ?)`,
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
        oldLastFour: currentPrimary?.last_four || null,
        newLastFour: normalizedMobile.slice(-4),
        sharedMobileConfirmed: sharedMobileMatches.length > 0 && input.confirmSharedMobile,
        reason: input.reason || null,
      }),
      now,
    ),
  );

  await c.env.DB.batch(statements);
  const otpProfiles = (await lookupPortalProfilesByMobile(c, normalizedMobile)).profiles.filter((profile) => profile.personId === student.person_id).length;
  return {
    ok: true,
    studentId: student.student_id,
    studentNumber: student.student_number,
    personId: student.person_id,
    idempotent: false,
    mobileDisplay: maskMobileByLastFour(normalizedMobile.slice(-4)),
    oldLastFour: currentPrimary?.last_four || null,
    newLastFour: normalizedMobile.slice(-4),
    sharedMobileMatches,
    otpProfiles,
  };
}

export async function getStudentContactHistory(c: AppContext, personId: string) {
  const rows = await c.env.DB.prepare(
    `select person_contacts.id, person_contacts.last_four, person_contacts.is_primary,
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
    .all<{ id: string; last_four: string | null; is_primary: number; status: string; valid_until: string | null; created_at: string; updated_at: string }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
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

async function getCurrentPrimaryMobileContact(c: AppContext, personId: string) {
  return c.env.DB.prepare(
    `select person_contacts.id, person_contacts.normalized_value, person_contacts.last_four,
            person_contacts.is_primary, coalesce(person_contact_details.status, 'active') as status,
            person_contact_details.valid_until, person_contacts.created_at
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
            person_contact_details.valid_until, person_contacts.created_at
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

function maskMobileByLastFour(lastFour: string) {
  return lastFour ? `******${lastFour}` : "Protected";
}
