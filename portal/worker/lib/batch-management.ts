import { z } from "zod";
import { ORG_ID } from "./auth-store";
import { createOpaqueId } from "./crypto";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";

export const BATCH_READ_ROLES = ["owner", "system_admin", "admin", "admission_admin", "counsellor"] as const;
export const BATCH_MANAGE_ROLES = ["owner", "system_admin", "admin", "admission_admin"] as const;

const weekdayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const weekdaySet = new Set<string>(weekdayOrder);
const batchStatusValues = ["active", "inactive", "completed"] as const;
type BatchStatus = (typeof batchStatusValues)[number];

const batchBaseSchema = z.object({
  name: z.string().trim().min(2).max(140),
  branchId: z.string().trim().min(1).max(140),
  courseId: z.string().trim().min(1).max(140).optional(),
  courseIds: z.array(z.string().trim().min(1).max(140)).min(1).max(24).optional(),
  trainerPersonId: z.string().trim().min(1).max(140).nullable().optional(),
  daysOfWeek: z.array(z.string().trim()).min(1).max(7),
  startTime: z.string().trim(),
  endTime: z.string().trim(),
  capacity: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(batchStatusValues).default("active"),
});
export const batchInputSchema = batchBaseSchema.refine((value) => Boolean(value.courseId || value.courseIds?.length), {
  message: "Select at least one course.",
  path: ["courseIds"],
});
export const batchPatchSchema = batchBaseSchema.partial();
export const batchAssignmentSchema = z.object({
  enrolmentId: z.string().trim().min(1).max(160),
});
export const batchTransferSchema = z.object({
  targetBatchId: z.string().trim().min(1).max(160),
});

type DbResult<T> = { results?: T[] };
type FieldErrors = Record<string, string[]>;

type BatchRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  course_id: string;
  name: string;
  primary_trainer_person_id: string | null;
  days_of_week_json: string;
  start_time: string;
  end_time: string;
  capacity: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export function normalizeDaysOfWeek(days: string[]) {
  const selected = new Set<string>();
  for (const raw of days) {
    const day = raw.trim().toLowerCase();
    if (!weekdaySet.has(day)) throw new Error("Choose valid class days.");
    selected.add(day);
  }
  const ordered = weekdayOrder.filter((day) => selected.has(day));
  if (!ordered.length) throw new Error("Choose at least one class day.");
  return ordered;
}

export function validateBatchTimes(startTime: string, endTime: string) {
  const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!pattern.test(startTime) || !pattern.test(endTime)) throw new Error("Use 24-hour HH:MM timings.");
  if (endTime <= startTime) throw new Error("End time must be after start time.");
}

export async function listBatches(c: AppContext, staff: StaffContext, filters: { branchId?: string; courseId?: string; status?: string; q?: string }) {
  const bindings: unknown[] = [ORG_ID];
  let where = "batches.organisation_id = ?";
  if (filters.branchId) {
    const access = await hasBranchAccess(c, staff, filters.branchId);
    if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this branch." };
    where += " and batches.branch_id = ?";
    bindings.push(filters.branchId);
  } else {
    where += branchScopeSql(staff, "batches.branch_id", bindings);
  }
  if (filters.courseId) {
    where += " and exists (select 1 from batch_courses filter_courses where filter_courses.batch_id = batches.id and filter_courses.course_id = ? and filter_courses.organisation_id = batches.organisation_id)";
    bindings.push(filters.courseId);
  }
  if (filters.status && filters.status !== "all") {
    where += " and batches.status = ?";
    bindings.push(filters.status);
  }
  if (filters.q) {
    where += " and (batches.name like ? or exists (select 1 from batch_courses search_batch_courses join courses search_courses on search_courses.id = search_batch_courses.course_id where search_batch_courses.batch_id = batches.id and search_courses.name like ?) or trainer.public_name like ? or trainer.full_name like ?)";
    const query = `%${filters.q}%`;
    bindings.push(query, query, query, query);
  }
  const rows = await c.env.DB.prepare(
    `select batches.*, branches.name as branch_name, legacy_course.name as course_name,
            course_summary.course_count, course_summary.course_pairs,
            coalesce(trainer.public_name, trainer.full_name) as trainer_name,
            coalesce(active_counts.active_students, 0) as active_students
     from batches
     join branches on branches.id = batches.branch_id
     join courses legacy_course on legacy_course.id = batches.course_id
     left join (
       select batch_courses.batch_id, count(*) as course_count,
              group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
     left join people trainer on trainer.id = batches.primary_trainer_person_id
     left join (
       select batch_id, count(*) as active_students
       from batch_memberships
       where status = 'active' and left_at is null
       group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     where ${where}
     order by batches.status = 'active' desc, batches.updated_at desc`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return { ok: true as const, batches: (rows.results || []).map(mapBatchRow) };
}

export async function getBatchDetail(c: AppContext, staff: StaffContext, batchId: string) {
  const batch = await loadBatch(c, batchId);
  if (!batch) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  const access = await hasBranchAccess(c, staff, batch.branch_id);
  if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this batch." };
  const roster = await c.env.DB.prepare(
    `select batch_memberships.id as membership_id, batch_memberships.joined_at, batch_memberships.status as membership_status,
            enrolments.id as enrolment_id, enrolments.enrolment_number, enrolments.status as enrolment_status,
            enrolments.course_id, courses.name as course_name,
            students.id as student_id, students.student_number,
            coalesce(people.public_name, people.full_name) as student_name
     from batch_memberships
     join enrolments on enrolments.id = batch_memberships.enrolment_id
     join courses on courses.id = enrolments.course_id
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     where batch_memberships.batch_id = ?
       and batch_memberships.organisation_id = ?
       and students.organisation_id = ?
       and batch_memberships.status = 'active'
       and batch_memberships.left_at is null
     order by people.full_name collate nocase
     limit 200`,
  )
    .bind(batchId, ORG_ID, ORG_ID)
    .all<Record<string, unknown>>();
  return { ok: true as const, batch: await decorateBatch(c, batch), roster: roster.results || [] };
}

export async function createBatch(c: AppContext, staff: StaffContext, input: z.infer<typeof batchInputSchema>) {
  const validated = await validateBatchInput(c, staff, input);
  if (!validated.ok) return validated;
  const now = new Date().toISOString();
  const batchId = createOpaqueId("batch");
  const primaryCourseId = validated.courseIds[0];
  await c.env.DB.batch([
    c.env.DB.prepare(
    `insert into batches
       (id, organisation_id, branch_id, course_id, name, primary_trainer_person_id, days_of_week_json, start_time, end_time, capacity, status, created_by_login_account_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(batchId, ORG_ID, input.branchId, primaryCourseId, input.name, input.trainerPersonId || null, JSON.stringify(validated.days), input.startTime, input.endTime, input.capacity ?? null, input.status, staff.loginAccountId, now, now),
    ...validated.courseIds.map((courseId) =>
      c.env.DB.prepare(
        `insert into batch_courses (batch_id, course_id, organisation_id, created_at, created_by)
         values (?, ?, ?, ?, ?)`,
      ).bind(batchId, courseId, ORG_ID, now, staff.loginAccountId),
    ),
  ]);
  await writeAudit(c, staff, input.branchId, "batch_created", "batch", batchId, null, { name: input.name, courseIds: validated.courseIds, trainerPersonId: input.trainerPersonId || null });
  return { ok: true as const, batchId };
}

export async function updateBatch(c: AppContext, staff: StaffContext, batchId: string, patch: z.infer<typeof batchPatchSchema>) {
  const current = await loadBatch(c, batchId);
  if (!current) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  const currentAccess = await hasBranchAccess(c, staff, current.branch_id);
  if (!currentAccess) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this batch." };
  const merged = {
    name: patch.name ?? current.name,
    branchId: patch.branchId ?? current.branch_id,
    courseId: patch.courseId ?? current.course_id,
    courseIds: patch.courseIds,
    trainerPersonId: patch.trainerPersonId === undefined ? current.primary_trainer_person_id : patch.trainerPersonId,
    daysOfWeek: patch.daysOfWeek ?? parseDays(current.days_of_week_json),
    startTime: patch.startTime ?? current.start_time,
    endTime: patch.endTime ?? current.end_time,
    capacity: patch.capacity === undefined ? current.capacity : patch.capacity,
    status: (patch.status ?? current.status) as BatchStatus,
  };
  const currentCourseIds = await listBatchCourseIds(c, batchId, current.course_id);
  const nextCourseIds = normalizeCourseIds(merged.courseIds ?? (patch.courseId ? [merged.courseId] : currentCourseIds));
  const hasHistory = await batchHasMembershipHistory(c, batchId);
  if (hasHistory && merged.branchId !== current.branch_id) {
    return {
      ok: false as const,
      status: 409,
      code: "batch_identity_locked",
      message: "Batch branch cannot change after students have been assigned.",
      fieldErrors: {
        branchId: ["Branch is locked after batch membership history exists."],
      },
    };
  }
  const removedCourseIds = currentCourseIds.filter((courseId) => !nextCourseIds.includes(courseId));
  if (removedCourseIds.length) {
    const locked = await lockedCourseRemovals(c, batchId, removedCourseIds);
    if (locked.length) {
      const courseName = locked[0]?.name || "This course";
      return {
        ok: false as const,
        status: 409,
        code: "batch_course_history_locked",
        message: `${courseName} cannot be removed because students from this course are currently or historically assigned to this batch.`,
        fieldErrors: { courseIds: [`${courseName} cannot be removed because this batch has membership history for the course.`] },
      };
    }
  }
  const validated = await validateBatchInput(c, staff, merged);
  if (!validated.ok) return validated;
  const now = new Date().toISOString();
  const primaryCourseId = validated.courseIds[0];
  await c.env.DB.batch([
    c.env.DB.prepare(
    `update batches
     set branch_id = ?, course_id = ?, name = ?, primary_trainer_person_id = ?, days_of_week_json = ?,
         start_time = ?, end_time = ?, capacity = ?, status = ?, updated_at = ?
     where id = ? and organisation_id = ?`,
    ).bind(merged.branchId, primaryCourseId, merged.name, merged.trainerPersonId || null, JSON.stringify(validated.days), merged.startTime, merged.endTime, merged.capacity ?? null, merged.status, now, batchId, ORG_ID),
    ...removedCourseIds.map((courseId) => c.env.DB.prepare("delete from batch_courses where batch_id = ? and course_id = ? and organisation_id = ?").bind(batchId, courseId, ORG_ID)),
    ...validated.courseIds.map((courseId) =>
      c.env.DB.prepare(
        `insert or ignore into batch_courses (batch_id, course_id, organisation_id, created_at, created_by)
         values (?, ?, ?, ?, ?)`,
      ).bind(batchId, courseId, ORG_ID, now, staff.loginAccountId),
    ),
  ]);
  await writeAudit(c, staff, merged.branchId, "batch_updated", "batch", batchId, current, { ...merged, courseIds: validated.courseIds });
  return { ok: true as const, batchId };
}

export async function listTrainers(c: AppContext, staff: StaffContext, branchId?: string) {
  const bindings: unknown[] = [ORG_ID];
  let where = "people.organisation_id = ? and people.status = 'active'";
  if (branchId) {
    const access = await hasBranchAccess(c, staff, branchId);
    if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this branch." };
    where += " and (person_roles.branch_id is null or person_roles.branch_id = ?)";
    bindings.push(branchId);
  } else {
    where += branchScopeSql(staff, "coalesce(person_roles.branch_id, people.home_branch_id)", bindings);
  }
  const rows = await c.env.DB.prepare(
    `select distinct people.id, coalesce(people.public_name, people.full_name) as name, people.home_branch_id
     from people
     join person_roles on person_roles.person_id = people.id
     join roles on roles.id = person_roles.role_id and roles.organisation_id = people.organisation_id
     where ${where} and roles.code = 'trainer'
     order by name collate nocase`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return { ok: true as const, trainers: rows.results || [] };
}

export async function listEligibleEnrolments(c: AppContext, staff: StaffContext, batchId: string, q = "") {
  const batch = await loadBatch(c, batchId);
  if (!batch) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  const access = await hasBranchAccess(c, staff, batch.branch_id);
  if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this batch." };
  const rows = await c.env.DB.prepare(
    `select enrolments.id, enrolments.enrolment_number, enrolments.status, students.student_number,
            coalesce(people.public_name, people.full_name) as student_name,
            primary_mobile.last_four as mobile_last_four
     from enrolments
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id and people.organisation_id = ?
     left join person_contacts primary_mobile
       on primary_mobile.person_id = people.id
      and primary_mobile.contact_type = 'mobile'
      and primary_mobile.is_primary = 1
     left join batch_memberships active_membership
       on active_membership.enrolment_id = enrolments.id
      and active_membership.status = 'active'
      and active_membership.left_at is null
     join batch_courses on batch_courses.batch_id = ?
      and batch_courses.course_id = enrolments.course_id
      and batch_courses.organisation_id = ?
     where enrolments.branch_id = ?
       and enrolments.status in ('confirmed', 'not_started', 'active', 'on_hold')
       and active_membership.id is null
       and (? = '' or people.full_name like ? or students.student_number like ? or enrolments.enrolment_number like ? or primary_mobile.normalized_value like ? or primary_mobile.display_value like ? or primary_mobile.last_four like ?)
     order by people.full_name collate nocase
     limit 50`,
  )
    .bind(ORG_ID, batchId, ORG_ID, batch.branch_id, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
    .all<Record<string, unknown>>();
  return { ok: true as const, enrolments: rows.results || [] };
}

export async function listAdmissionEligibleBatches(c: AppContext, staff: StaffContext, branchId: string, courseId: string) {
  const access = await hasBranchAccess(c, staff, branchId);
  if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this branch." };
  const rows = await c.env.DB.prepare(
    `select batches.id, batches.name, batches.days_of_week_json, batches.start_time, batches.end_time, batches.capacity,
            coalesce(trainer.public_name, trainer.full_name) as trainer_name,
            coalesce(active_counts.active_students, 0) as active_students
     from batches
     left join people trainer on trainer.id = batches.primary_trainer_person_id
     left join (
       select batch_id, count(*) as active_students from batch_memberships
       where status = 'active' and left_at is null
       group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     join batch_courses on batch_courses.batch_id = batches.id
      and batch_courses.organisation_id = batches.organisation_id
      and batch_courses.course_id = ?
     where batches.organisation_id = ? and batches.branch_id = ? and batches.status = 'active'
     order by batches.start_time, batches.name collate nocase`,
  )
    .bind(courseId, ORG_ID, branchId)
    .all<Record<string, unknown>>();
  return { ok: true as const, batches: (rows.results || []).map(mapAdmissionBatchOption) };
}

export async function validateAdmissionBatchSelection(c: AppContext, staff: StaffContext, branchId: string, courseId: string, batchId: string | null | undefined) {
  if (!batchId) return null;
  const batch = await loadBatch(c, batchId);
  if (!batch || batch.status !== "active" || batch.branch_id !== branchId || batch.organisation_id !== ORG_ID || !(await batchIncludesCourse(c, batchId, courseId))) {
    return { "course.batchId": ["Select an active batch for this branch and course, or choose Assign later."] };
  }
  const access = await hasBranchAccess(c, staff, branchId);
  if (!access) return { "course.batchId": ["You do not have access to assign this batch."] };
  return null;
}

export async function assignEnrolmentToBatch(c: AppContext, staff: StaffContext, batchId: string, enrolmentId: string) {
  const batch = await loadBatch(c, batchId);
  if (!batch) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  const validation = await validateAssignment(c, staff, batch, enrolmentId, false);
  if (!validation.ok) return validation;
  const now = new Date().toISOString();
  const membershipId = createOpaqueId("batchmem");
  await c.env.DB.prepare(
    `insert into batch_memberships
       (id, organisation_id, batch_id, enrolment_id, joined_at, status, assigned_by_login_account_id, created_at)
     values (?, ?, ?, ?, ?, 'active', ?, ?)`,
  )
    .bind(membershipId, ORG_ID, batchId, enrolmentId, now, staff.loginAccountId, now)
    .run();
  await writeAudit(c, staff, batch.branch_id, "batch_membership_assigned", "batch_membership", membershipId, null, { batchId, enrolmentId });
  return { ok: true as const, membershipId };
}

export async function transferBatchMembership(c: AppContext, staff: StaffContext, sourceBatchId: string, membershipId: string, targetBatchId: string) {
  const current = await activeMembership(c, membershipId);
  if (!current) return { ok: false as const, status: 404, code: "membership_not_found", message: "Active batch membership not found." };
  if (current.batch_id !== sourceBatchId) return { ok: false as const, status: 404, code: "membership_not_found", message: "Active batch membership not found for this batch." };
  const source = await loadBatch(c, sourceBatchId);
  if (!source) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  const sourceAccess = await hasBranchAccess(c, staff, source.branch_id);
  if (!sourceAccess) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this batch." };
  const target = await loadBatch(c, targetBatchId);
  if (!target) return { ok: false as const, status: 404, code: "batch_not_found", message: "Target batch not found." };
  const validation = await validateAssignment(c, staff, target, current.enrolment_id, true);
  if (!validation.ok) return validation;
  const now = new Date().toISOString();
  const nextMembershipId = createOpaqueId("batchmem");
  await c.env.DB.batch([
    c.env.DB.prepare("update batch_memberships set status = 'transferred', left_at = ? where id = ? and status = 'active' and left_at is null").bind(now, membershipId),
    c.env.DB.prepare(
      `insert into batch_memberships
         (id, organisation_id, batch_id, enrolment_id, joined_at, status, assigned_by_login_account_id, created_at)
       values (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(nextMembershipId, ORG_ID, targetBatchId, current.enrolment_id, now, staff.loginAccountId, now),
  ]);
  await writeAudit(c, staff, target.branch_id, "batch_membership_transferred", "batch_membership", nextMembershipId, current, { targetBatchId });
  return { ok: true as const, membershipId: nextMembershipId };
}

export async function removeBatchMembership(c: AppContext, staff: StaffContext, membershipId: string) {
  const current = await activeMembership(c, membershipId);
  if (!current) return { ok: false as const, status: 404, code: "membership_not_found", message: "Active batch membership not found." };
  const batch = await loadBatch(c, current.batch_id);
  if (!batch) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  const access = await hasBranchAccess(c, staff, batch.branch_id);
  if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this batch." };
  const now = new Date().toISOString();
  await c.env.DB.prepare("update batch_memberships set status = 'removed', left_at = ? where id = ? and status = 'active' and left_at is null")
    .bind(now, membershipId)
    .run();
  await writeAudit(c, staff, batch.branch_id, "batch_membership_removed", "batch_membership", membershipId, current, { enrolmentId: current.enrolment_id });
  return { ok: true as const, membershipId };
}

export async function removeBatchMembershipFromBatch(c: AppContext, staff: StaffContext, batchId: string, membershipId: string) {
  const current = await activeMembership(c, membershipId);
  if (!current || current.batch_id !== batchId) return { ok: false as const, status: 404, code: "membership_not_found", message: "Active batch membership not found for this batch." };
  return removeBatchMembership(c, staff, membershipId);
}

export async function assignBatchOnAdmissionConfirmation(c: AppContext, staff: StaffContext, snapshot: { branchId: string; courseId: string; batchId?: string | null }, enrolmentId: string, now: string) {
  if (!snapshot.batchId) return { ok: true as const, membershipId: null };
  const batch = await loadBatch(c, snapshot.batchId);
  if (!batch) return { ok: false as const, status: 409, code: "batch_not_found", message: "Selected batch is no longer available." };
  const existing = await currentMembershipForEnrolment(c, enrolmentId);
  if (existing?.batch_id === snapshot.batchId) return { ok: true as const, membershipId: existing.id };
  if (existing) return { ok: false as const, status: 409, code: "batch_assignment_conflict", message: "This enrolment is already assigned to another batch." };
  const validation = await validateAssignment(c, staff, batch, enrolmentId, false);
  if (!validation.ok) return validation;
  const membershipId = `batchmem_${enrolmentId}`;
  await c.env.DB.prepare(
    `insert or ignore into batch_memberships
       (id, organisation_id, batch_id, enrolment_id, joined_at, status, assigned_by_login_account_id, created_at)
     values (?, ?, ?, ?, ?, 'active', ?, ?)`,
  )
    .bind(membershipId, ORG_ID, snapshot.batchId, enrolmentId, now, staff.loginAccountId, now)
    .run();
  await writeAudit(c, staff, batch.branch_id, "batch_membership_assigned_from_admission", "batch_membership", membershipId, null, { batchId: snapshot.batchId, enrolmentId });
  return { ok: true as const, membershipId };
}

async function validateBatchInput(c: AppContext, staff: StaffContext, input: z.infer<typeof batchInputSchema>) {
  const fieldErrors: FieldErrors = {};
  const courseIds = normalizeCourseIds(input.courseIds || (input.courseId ? [input.courseId] : []));
  if (!courseIds.length) fieldErrors.courseIds = ["Select at least one course."];
  let days: string[] = [];
  try {
    days = normalizeDaysOfWeek(input.daysOfWeek);
  } catch (error) {
    fieldErrors.daysOfWeek = [error instanceof Error ? error.message : "Choose valid class days."];
  }
  try {
    validateBatchTimes(input.startTime, input.endTime);
  } catch (error) {
    fieldErrors.endTime = [error instanceof Error ? error.message : "Check batch timings."];
  }
  const access = await hasBranchAccess(c, staff, input.branchId);
  if (!access) fieldErrors.branchId = ["You do not have access to this branch."];
  if (courseIds.length) {
    const placeholders = courseIds.map(() => "?").join(", ");
    const rows = await c.env.DB.prepare(`select id from courses where id in (${placeholders}) and organisation_id = ? and status = 'active'`)
      .bind(...courseIds, ORG_ID)
      .all<{ id: string }>();
    const validCourseIds = new Set((rows.results || []).map((row) => row.id));
    const invalid = courseIds.filter((courseId) => !validCourseIds.has(courseId));
    if (invalid.length) fieldErrors.courseIds = ["Select only active courses from this organisation."];
  }
  const branch = await c.env.DB.prepare("select id from branches where id = ? and organisation_id = ? and status = 'active'")
    .bind(input.branchId, ORG_ID)
    .first<{ id: string }>();
  if (!branch) fieldErrors.branchId = ["Select an active branch."];
  if (input.trainerPersonId) {
    const trainer = await eligibleTrainer(c, input.trainerPersonId, input.branchId);
    if (!trainer) fieldErrors.trainerPersonId = ["Select an active trainer for this branch."];
  }
  if (Object.keys(fieldErrors).length) {
    return { ok: false as const, status: 400, code: "invalid_batch", message: Object.values(fieldErrors)[0]?.[0] || "Please check the batch details.", fieldErrors };
  }
  return { ok: true as const, days, courseIds };
}

async function validateAssignment(c: AppContext, staff: StaffContext, batch: BatchRecord, enrolmentId: string, allowCurrent: boolean) {
  if (batch.status !== "active") return { ok: false as const, status: 400, code: "inactive_batch", message: "Assign students only to an active batch." };
  const access = await hasBranchAccess(c, staff, batch.branch_id);
  if (!access) return { ok: false as const, status: 403, code: "forbidden", message: "You do not have access to this batch." };
  const enrolment = await c.env.DB.prepare(
    `select enrolments.id, enrolments.branch_id, enrolments.course_id, enrolments.status, students.organisation_id
     from enrolments
     join students on students.id = enrolments.student_id
     where enrolments.id = ?`,
  )
    .bind(enrolmentId)
    .first<{ id: string; branch_id: string; course_id: string; status: string; organisation_id: string }>();
  if (!enrolment || enrolment.organisation_id !== ORG_ID) return { ok: false as const, status: 404, code: "enrolment_not_found", message: "Enrolment not found." };
  if (!["confirmed", "not_started", "active", "on_hold"].includes(enrolment.status)) return { ok: false as const, status: 400, code: "ineligible_enrolment", message: "Only current confirmed enrolments can be assigned." };
  if (enrolment.branch_id !== batch.branch_id) return { ok: false as const, status: 400, code: "batch_mismatch", message: "Enrolment branch must match the batch." };
  if (!(await batchIncludesCourse(c, batch.id, enrolment.course_id))) {
    return { ok: false as const, status: 400, code: "batch_course_not_eligible", message: "This enrolment's course is not configured for the batch." };
  }
  const current = await currentMembershipForEnrolment(c, enrolmentId);
  if (current && !(allowCurrent && current.batch_id !== batch.id)) return { ok: false as const, status: 409, code: "already_assigned", message: "This enrolment already has an active batch assignment." };
  return { ok: true as const };
}

async function hasBranchAccess(c: AppContext, staff: StaffContext, branchId: string) {
  if (staff.roles.some((role) => role === "owner" || role === "system_admin")) return true;
  const row = await c.env.DB.prepare(
    `select 1 as allowed
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code in ('admin', 'admission_admin', 'counsellor')
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
      and role_scope.code in ('admin', 'admission_admin', 'counsellor')
      and (lar.branch_id is null or lar.branch_id = ${column})
  )`;
}

async function loadBatch(c: AppContext, batchId: string) {
  return c.env.DB.prepare("select * from batches where id = ? and organisation_id = ?")
    .bind(batchId, ORG_ID)
    .first<BatchRecord>();
}

async function decorateBatch(c: AppContext, batch: BatchRecord) {
  const rows = await c.env.DB.prepare(
    `select batches.*, branches.name as branch_name, legacy_course.name as course_name,
            course_summary.course_count, course_summary.course_pairs,
            coalesce(trainer.public_name, trainer.full_name) as trainer_name,
            coalesce(active_counts.active_students, 0) as active_students
     from batches
     join branches on branches.id = batches.branch_id
     join courses legacy_course on legacy_course.id = batches.course_id
     left join (
       select batch_courses.batch_id, count(*) as course_count,
              group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
     left join people trainer on trainer.id = batches.primary_trainer_person_id
     left join (
       select batch_id, count(*) as active_students
       from batch_memberships
       where status = 'active' and left_at is null
       group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     where batches.id = ?`,
  )
    .bind(batch.id)
    .all<Record<string, unknown>>();
  return mapBatchRow((rows.results || [batch as unknown as Record<string, unknown>])[0]);
}

async function eligibleTrainer(c: AppContext, personId: string, branchId: string) {
  return c.env.DB.prepare(
    `select people.id
     from people
     join person_roles on person_roles.person_id = people.id
     join roles on roles.id = person_roles.role_id and roles.organisation_id = people.organisation_id
     where people.id = ?
       and people.organisation_id = ?
       and people.status = 'active'
       and roles.code = 'trainer'
       and (person_roles.branch_id is null or person_roles.branch_id = ?)
     limit 1`,
  )
    .bind(personId, ORG_ID, branchId)
    .first<{ id: string }>();
}

async function activeMembership(c: AppContext, membershipId: string) {
  return c.env.DB.prepare("select * from batch_memberships where id = ? and organisation_id = ? and status = 'active' and left_at is null")
    .bind(membershipId, ORG_ID)
    .first<{ id: string; batch_id: string; enrolment_id: string }>();
}

async function currentMembershipForEnrolment(c: AppContext, enrolmentId: string) {
  return c.env.DB.prepare("select id, batch_id from batch_memberships where enrolment_id = ? and organisation_id = ? and status = 'active' and left_at is null")
    .bind(enrolmentId, ORG_ID)
    .first<{ id: string; batch_id: string }>();
}

async function batchHasMembershipHistory(c: AppContext, batchId: string) {
  const row = await c.env.DB.prepare("select 1 as found from batch_memberships where batch_id = ? and organisation_id = ? limit 1")
    .bind(batchId, ORG_ID)
    .first<{ found: number }>();
  return Boolean(row);
}

function normalizeCourseIds(courseIds: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of courseIds) {
    const courseId = raw.trim();
    if (!courseId || seen.has(courseId)) continue;
    seen.add(courseId);
    normalized.push(courseId);
  }
  return normalized;
}

async function listBatchCourseIds(c: AppContext, batchId: string, legacyCourseId: string) {
  const rows = await c.env.DB.prepare("select course_id from batch_courses where batch_id = ? and organisation_id = ? order by created_at, course_id")
    .bind(batchId, ORG_ID)
    .all<{ course_id: string }>();
  const courseIds = (rows.results || []).map((row) => row.course_id);
  return courseIds.length ? courseIds : [legacyCourseId];
}

async function batchIncludesCourse(c: AppContext, batchId: string, courseId: string) {
  const row = await c.env.DB.prepare("select 1 as found from batch_courses where batch_id = ? and course_id = ? and organisation_id = ? limit 1")
    .bind(batchId, courseId, ORG_ID)
    .first<{ found: number }>();
  return Boolean(row);
}

async function lockedCourseRemovals(c: AppContext, batchId: string, courseIds: string[]) {
  if (!courseIds.length) return [];
  const placeholders = courseIds.map(() => "?").join(", ");
  const rows = await c.env.DB.prepare(
    `select distinct courses.id, courses.name
     from batch_memberships
     join enrolments on enrolments.id = batch_memberships.enrolment_id
     join courses on courses.id = enrolments.course_id
     where batch_memberships.batch_id = ?
       and batch_memberships.organisation_id = ?
       and enrolments.course_id in (${placeholders})
     order by courses.name collate nocase`,
  )
    .bind(batchId, ORG_ID, ...courseIds)
    .all<{ id: string; name: string }>();
  return rows.results || [];
}

async function writeAudit(c: AppContext, staff: StaffContext, branchId: string, action: string, entityType: string, entityId: string, oldValues: unknown, newValues: unknown) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId || null, action, entityType, entityId, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, new Date().toISOString())
    .run();
}

function parseDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return normalizeDaysOfWeek(parsed.map(String));
  } catch {
    return ["mon"];
  }
  return ["mon"];
}

function mapBatchRow(row: Record<string, unknown>) {
  const daysOfWeek = parseDays(String(row.days_of_week_json || "[]"));
  const capacity = row.capacity == null ? null : Number(row.capacity);
  const activeStudents = Number(row.active_students || 0);
  const courses = parseCoursePairs(row.course_pairs, row.course_id, row.course_name);
  const primaryCourse = courses[0] || { id: String(row.course_id), name: String(row.course_name || "") };
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    branchName: String(row.branch_name || ""),
    courseId: primaryCourse.id,
    courseName: primaryCourse.name,
    courses,
    courseCount: courses.length || Number(row.course_count || 0) || 1,
    name: String(row.name),
    trainerPersonId: row.primary_trainer_person_id ? String(row.primary_trainer_person_id) : null,
    trainerName: row.trainer_name ? String(row.trainer_name) : null,
    daysOfWeek,
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    capacity,
    activeStudents,
    capacityWarning: capacity != null && activeStudents >= capacity,
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseCoursePairs(value: unknown, legacyCourseId: unknown, legacyCourseName: unknown) {
  const fallback = [{ id: String(legacyCourseId), name: String(legacyCourseName || "") }];
  if (typeof value !== "string" || !value) return fallback;
  const courses = value.split(String.fromCharCode(30)).flatMap((pair) => {
    const [id, name] = pair.split(String.fromCharCode(31));
    return id ? [{ id, name: name || id }] : [];
  });
  if (!courses.length) return fallback;
  const primaryId = String(legacyCourseId);
  return courses.sort((left, right) => {
    if (left.id === primaryId) return -1;
    if (right.id === primaryId) return 1;
    return left.name.localeCompare(right.name);
  });
}

function mapAdmissionBatchOption(row: Record<string, unknown>) {
  const capacity = row.capacity == null ? null : Number(row.capacity);
  const activeStudents = Number(row.active_students || 0);
  return {
    id: String(row.id),
    name: String(row.name),
    trainerName: row.trainer_name ? String(row.trainer_name) : null,
    daysOfWeek: parseDays(String(row.days_of_week_json || "[]")),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    capacity,
    activeStudents,
    capacityWarning: capacity != null && activeStudents >= capacity,
  };
}
