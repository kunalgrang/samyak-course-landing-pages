import { ORG_ID, mobileHash } from "./auth-store";
import type { AppContext } from "./http";
import { normalizeIndianMobile } from "./mobile";
import { ADMISSION_STAFF_ROLES, type StaffContext } from "./staff-auth";

export type StudentDirectoryStatus = "all" | "current" | "alumni";

export type StudentDirectoryQuery = {
  status?: StudentDirectoryStatus;
  search?: string;
  limit?: number;
  offset?: number;
};

export type StudentDirectoryItem = {
  studentId: string;
  studentNumber: string;
  currentStatus: string;
  studentSince: string;
  displayName: string;
  mobileDisplay: string | null;
  latestCourseName: string | null;
  latestEnrolmentNumber: string | null;
  enrolmentCount: number;
  paymentShortcutEnrolmentId: string | null;
};

export type StudentDirectoryResult = {
  success: true;
  filters: {
    status: StudentDirectoryStatus;
    search: string;
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  items: StudentDirectoryItem[];
};

const CURRENT_STATUS_VALUES = ["active", "current"];
const ALUMNI_STATUS_VALUES = ["alumni", "completed", "former"];
const MAX_LIMIT = 50;

export async function listStaffStudents(c: AppContext, staff: StaffContext, query: StudentDirectoryQuery = {}): Promise<StudentDirectoryResult> {
  const status = query.status || "all";
  const search = (query.search || "").trim();
  const limit = Math.min(Math.max(Math.trunc(query.limit || 25), 1), MAX_LIMIT);
  const offset = Math.max(Math.trunc(query.offset || 0), 0);
  const now = new Date().toISOString();
  const normalizedMobile = normalizeIndianMobile(search);
  const searchMobileHash = normalizedMobile ? await mobileHash(c, normalizedMobile) : null;
  const where = await directoryWhere(c, staff, { status, search, searchMobileHash, now });

  const total = await c.env.DB.prepare(`select count(*) as count ${where.fromAndWhere}`)
    .bind(...where.bindings)
    .first<{ count: number }>();

  const rows = await c.env.DB.prepare(
    `select
       students.id as studentId,
       students.student_number as studentNumber,
       students.current_status as currentStatus,
       students.student_since as studentSince,
       coalesce(person_identity_details.official_full_name, people.full_name, people.public_name, 'Student') as displayName,
       (
         select person_contacts.last_four
         from person_contacts
         left join person_contact_details on person_contact_details.contact_id = person_contacts.id
         where person_contacts.person_id = students.person_id
           and person_contacts.contact_type = 'mobile'
           and person_contacts.is_primary = 1
           and coalesce(person_contact_details.status, 'active') = 'active'
           and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
         order by person_contacts.updated_at desc
         limit 1
       ) as mobileLastFour,
       (
         select courses.name
         from enrolments
         join courses on courses.id = enrolments.course_id
         where enrolments.student_id = students.id
         order by coalesce(enrolments.joining_date, enrolments.admission_date, enrolments.created_at) desc, enrolments.created_at desc
         limit 1
       ) as latestCourseName,
       (
         select enrolments.enrolment_number
         from enrolments
         where enrolments.student_id = students.id
         order by coalesce(enrolments.joining_date, enrolments.admission_date, enrolments.created_at) desc, enrolments.created_at desc
         limit 1
       ) as latestEnrolmentNumber,
       (select count(*) from enrolments where enrolments.student_id = students.id) as enrolmentCount,
       (
         select case when count(*) = 1 then max(enrolments.id) else null end
         from enrolments
         join fee_agreements on fee_agreements.enrolment_id = enrolments.id
         where enrolments.student_id = students.id
           and fee_agreements.final_agreed_fee_paise is not null
       ) as paymentShortcutEnrolmentId
     ${where.fromAndWhere}
     order by
       case lower(students.current_status)
         when 'active' then 1
         when 'current' then 1
         when 'on_hold' then 2
         when 'alumni' then 3
         else 4
       end,
       coalesce(students.student_since, students.created_at) desc,
       students.student_number desc
     limit ? offset ?`,
  )
    .bind(now, ...where.bindings, limit, offset)
    .all<StudentDirectoryItemRow>();

  const items = (rows.results || []).map((row) => ({
    studentId: row.studentId,
    studentNumber: row.studentNumber,
    currentStatus: row.currentStatus,
    studentSince: row.studentSince,
    displayName: row.displayName,
    mobileDisplay: maskMobileByLastFour(row.mobileLastFour),
    latestCourseName: row.latestCourseName,
    latestEnrolmentNumber: row.latestEnrolmentNumber,
    enrolmentCount: Number(row.enrolmentCount || 0),
    paymentShortcutEnrolmentId: row.paymentShortcutEnrolmentId,
  }));

  const totalCount = Number(total?.count || 0);
  return {
    success: true,
    filters: { status, search },
    pagination: { limit, offset, total: totalCount, hasMore: offset + items.length < totalCount },
    items,
  };
}

async function directoryWhere(
  _c: AppContext,
  staff: StaffContext,
  input: { status: StudentDirectoryStatus; search: string; searchMobileHash: string | null; now: string },
) {
  const clauses = [
    "students.organisation_id = ?",
    "people.organisation_id = students.organisation_id",
    "people.status != 'archived'",
    `exists (
       select 1
       from login_account_roles
       join roles on roles.id = login_account_roles.role_id
       where login_account_roles.login_account_id = ?
         and roles.organisation_id = ?
         and roles.code in (${ADMISSION_STAFF_ROLES.map(() => "?").join(", ")})
         and (login_account_roles.branch_id is null or login_account_roles.branch_id = students.home_branch_id)
     )`,
  ];
  const bindings: Array<string | number> = [ORG_ID, staff.loginAccountId, ORG_ID, ...ADMISSION_STAFF_ROLES];

  if (input.status === "current") {
    clauses.push(`lower(students.current_status) in (${CURRENT_STATUS_VALUES.map(() => "?").join(", ")})`);
    bindings.push(...CURRENT_STATUS_VALUES);
  } else if (input.status === "alumni") {
    clauses.push(`lower(students.current_status) in (${ALUMNI_STATUS_VALUES.map(() => "?").join(", ")})`);
    bindings.push(...ALUMNI_STATUS_VALUES);
  }

  if (input.search) {
    const like = `%${escapeLike(input.search.toLowerCase())}%`;
    const searchClauses = [
      "lower(students.student_number) like ? escape '\\'",
      "lower(coalesce(person_identity_details.official_full_name, '')) like ? escape '\\'",
      "lower(coalesce(people.full_name, '')) like ? escape '\\'",
      "lower(coalesce(people.public_name, '')) like ? escape '\\'",
      `exists (
         select 1
         from enrolments
         left join courses on courses.id = enrolments.course_id
         where enrolments.student_id = students.id
           and (
             lower(coalesce(enrolments.enrolment_number, '')) like ? escape '\\'
             or lower(coalesce(courses.name, '')) like ? escape '\\'
             or lower(coalesce(courses.code, '')) like ? escape '\\'
           )
       )`,
    ];
    bindings.push(like, like, like, like, like, like, like);
    if (input.searchMobileHash) {
      searchClauses.push(
        `exists (
           select 1
           from person_contacts
           left join person_contact_details on person_contact_details.contact_id = person_contacts.id
           where person_contacts.person_id = students.person_id
             and person_contacts.contact_type = 'mobile'
             and person_contacts.normalized_value = ?
             and coalesce(person_contact_details.status, 'active') = 'active'
             and (person_contact_details.valid_until is null or person_contact_details.valid_until > ?)
         )`,
      );
      bindings.push(input.searchMobileHash, input.now);
    }
    clauses.push(`(${searchClauses.join(" or ")})`);
  }

  return {
    fromAndWhere: `from students
      join people on people.id = students.person_id
      left join person_identity_details on person_identity_details.person_id = people.id
      where ${clauses.join(" and ")}`,
    bindings,
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function maskMobileByLastFour(lastFour: string | null) {
  return lastFour ? `******${lastFour}` : null;
}

type StudentDirectoryItemRow = {
  studentId: string;
  studentNumber: string;
  currentStatus: string;
  studentSince: string;
  displayName: string;
  mobileLastFour: string | null;
  latestCourseName: string | null;
  latestEnrolmentNumber: string | null;
  enrolmentCount: number;
  paymentShortcutEnrolmentId: string | null;
};
