import { ORG_ID } from "./auth-store";
import type { AppContext } from "./http";
import { sessionMaterialStorageFromEnv, type SessionMaterialRecord } from "./session-materials";
import type { StaffContext } from "./staff-auth";

export const STAFF_ACADEMIC_ROLES = ["owner", "system_admin", "admin"] as const;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const MAX_BATCH_LIMIT = 50;
const MAX_PAGE_LIMIT = 50;
const DEFAULT_SESSION_LIMIT = 20;

type DbResult<T> = { results?: T[] };

type BatchRow = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  name: string;
  primary_trainer_person_id: string | null;
  trainer_name: string | null;
  trainer_status: string | null;
  days_of_week_json: string;
  start_time: string;
  end_time: string;
  status: string;
  course_pairs: string | null;
  active_students: number;
  last_session_date: string | null;
  last_session_id: string | null;
  last_attendance_count: number;
  last_material_count: number;
};

type SessionSummaryRow = {
  id: string;
  branch_id: string;
  batch_id: string;
  batch_name: string;
  trainer_person_id: string;
  trainer_name: string | null;
  session_date: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  teaching_note: string;
  status: string;
  present_count: number;
  absent_count: number;
  material_count: number;
};

type MaterialContentResult =
  | { ok: true; body: ReadableStream<Uint8Array>; filename: string; sizeBytes?: number }
  | { ok: false; status: number; code: string; message: string };

type MaterialContentRow = SessionMaterialRecord & {
  session_branch_id: string;
};

export type AcademicPagination = {
  limit?: number;
  offset?: number;
};

export function indiaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function indiaBusinessWeek(now = new Date()) {
  const today = parseIndiaDate(indiaDate(now));
  const monday = new Date(today);
  const day = monday.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  monday.setUTCDate(monday.getUTCDate() + delta);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { startsOn: isoDate(monday), endsOn: isoDate(sunday) };
}

export function previousScheduledDates(daysOfWeek: string[], today: string, count: number) {
  const scheduled = new Set(daysOfWeek);
  const cursor = parseIndiaDate(today);
  const dates: string[] = [];
  for (let scanned = 0; scanned < 28 && dates.length < count; scanned += 1) {
    const label = WEEKDAYS[cursor.getUTCDay()];
    if (scheduled.has(label)) dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

export async function getStaffAcademicOverview(c: AppContext, staff: StaffContext) {
  const today = indiaDate();
  const week = indiaBusinessWeek();
  const branchBindings: unknown[] = [ORG_ID];
  const branchSql = branchScopeSql(staff, "batches.branch_id", branchBindings);

  const [todayRows, attendance, activeBatchRows] = await Promise.all([
    c.env.DB.prepare(
      `select class_sessions.id, class_sessions.branch_id, class_sessions.batch_id, batches.name as batch_name,
              class_sessions.trainer_person_id,
              coalesce(trainer_identity.official_full_name, trainers.public_name, trainers.full_name) as trainer_name,
              class_sessions.session_date, class_sessions.scheduled_start_time, class_sessions.scheduled_end_time,
              class_sessions.actual_started_at, class_sessions.actual_ended_at, class_sessions.teaching_note,
              class_sessions.status,
              sum(case when attendance_memberships.id is not null and attendance_records.status = 'present' then 1 else 0 end) as present_count,
              sum(case when attendance_memberships.id is not null and attendance_records.status = 'absent' then 1 else 0 end) as absent_count,
              coalesce(material_counts.material_count, 0) as material_count
       from class_sessions
       join batches on batches.id = class_sessions.batch_id and batches.organisation_id = class_sessions.organisation_id
       left join people trainers on trainers.id = class_sessions.trainer_person_id
       left join person_identity_details trainer_identity on trainer_identity.person_id = trainers.id
       left join attendance_records on attendance_records.class_session_id = class_sessions.id and attendance_records.organisation_id = class_sessions.organisation_id
       left join batch_memberships attendance_memberships on attendance_memberships.id = attendance_records.batch_membership_id
        and attendance_memberships.organisation_id = attendance_records.organisation_id
        and date(attendance_memberships.joined_at) <= date(class_sessions.session_date)
        and (attendance_memberships.left_at is null or date(attendance_memberships.left_at) >= date(class_sessions.session_date))
       left join (
         select class_session_id, count(*) as material_count
         from session_materials
         where organisation_id = ? and deleted_at is null
         group by class_session_id
       ) material_counts on material_counts.class_session_id = class_sessions.id
       where class_sessions.organisation_id = ?
         and class_sessions.session_date = ?
         ${branchScopeSql(staff, "class_sessions.branch_id", [])}
       group by class_sessions.id
       order by class_sessions.scheduled_start_time, batches.name collate nocase
       limit 50`,
    )
      .bind(ORG_ID, ORG_ID, today, ...branchBindings.slice(1))
      .all<SessionSummaryRow>(),
    c.env.DB.prepare(
      `select
         sum(case when attendance_memberships.id is not null and attendance_records.status = 'present' then 1 else 0 end) as present,
         sum(case when attendance_memberships.id is not null and attendance_records.status = 'absent' then 1 else 0 end) as absent
       from attendance_records
       join class_sessions on class_sessions.id = attendance_records.class_session_id
        and class_sessions.organisation_id = attendance_records.organisation_id
       left join batch_memberships attendance_memberships on attendance_memberships.id = attendance_records.batch_membership_id
        and attendance_memberships.organisation_id = attendance_records.organisation_id
        and date(attendance_memberships.joined_at) <= date(class_sessions.session_date)
        and (attendance_memberships.left_at is null or date(attendance_memberships.left_at) >= date(class_sessions.session_date))
       where attendance_records.organisation_id = ?
         and class_sessions.status = 'completed'
         and class_sessions.session_date = ?
         ${branchScopeSql(staff, "class_sessions.branch_id", [])}`,
    )
      .bind(ORG_ID, today, ...branchBindings.slice(1))
      .first<{ present: number | null; absent: number | null }>(),
    c.env.DB.prepare(activeBatchSql(`batches.organisation_id = ?${branchSql} and batches.status = 'active'`, "batches.name collate nocase", MAX_BATCH_LIMIT))
      .bind(ORG_ID, ORG_ID, ORG_ID, ...branchBindings)
      .all<BatchRow>(),
  ]);

  const activeBatches = (activeBatchRows.results || []).map(mapBatch);
  const todayClasses = (todayRows.results || []).map(mapSessionSummary);
  const todayBatchIds = new Set(todayClasses.filter((session) => session.status !== "cancelled").map((session) => session.batchId));
  const needsAttention = buildAttention(activeBatches, todayBatchIds, today);
  return {
    success: true as const,
    today,
    week,
    summary: {
      classesToday: todayClasses.filter((session) => session.status !== "cancelled").length,
      studentsPresentToday: Number(attendance?.present || 0),
      studentsAbsentToday: Number(attendance?.absent || 0),
      activeBatches: activeBatches.length,
      batchesWithoutRecentClass: needsAttention.filter((item) => item.type === "no_recent_class").length,
    },
    todayClasses,
    needsAttention,
    activeBatches,
  };
}

export async function listStaffAcademicBatches(c: AppContext, staff: StaffContext, query: { q?: string; limit?: number; offset?: number } = {}) {
  const limit = clampInteger(query.limit, 50, 1, MAX_BATCH_LIMIT);
  const offset = clampInteger(query.offset, 0, 0, 5000);
  const bindings: unknown[] = [ORG_ID];
  let where = "batches.organisation_id = ? and batches.status = 'active'";
  where += branchScopeSql(staff, "batches.branch_id", bindings);
  if (query.q?.trim()) {
    const search = `%${escapeLike(query.q.trim().toLowerCase())}%`;
    where += ` and (
      lower(batches.name) like ? escape '\\'
      or lower(coalesce(trainer.public_name, trainer.full_name, '')) like ? escape '\\'
      or exists (
        select 1 from batch_courses search_bc
        join courses search_courses on search_courses.id = search_bc.course_id and search_courses.organisation_id = search_bc.organisation_id
        where search_bc.batch_id = batches.id and lower(search_courses.name) like ? escape '\\'
      )
    )`;
    bindings.push(search, search, search);
  }
  const rows = await c.env.DB.prepare(activeBatchSql(where, "batches.name collate nocase", limit + 1, "limit ? offset ?"))
    .bind(ORG_ID, ORG_ID, ORG_ID, ...bindings, limit + 1, offset)
    .all<BatchRow>();
  const results = rows.results || [];
  return {
    success: true as const,
    batches: results.slice(0, limit).map(mapBatch),
    pagination: { limit, offset, hasMore: results.length > limit },
  };
}

export async function getStaffAcademicBatch(c: AppContext, staff: StaffContext, batchId: string, pagination: AcademicPagination = {}) {
  const batch = await loadAcademicBatch(c, staff, batchId);
  if (!batch) return notFound("batch_not_found", "Batch not found.");
  const limit = clampInteger(pagination.limit, DEFAULT_SESSION_LIMIT, 1, MAX_PAGE_LIMIT);
  const offset = clampInteger(pagination.offset, 0, 0, 5000);
  const [summary, sessions] = await Promise.all([
    c.env.DB.prepare(
      `select
         (select count(*)
          from class_sessions logged_sessions
          where logged_sessions.organisation_id = ?
            and logged_sessions.batch_id = ?
            and logged_sessions.status = 'completed') as classes_logged,
         (select count(*)
          from attendance_records
          join class_sessions attendance_sessions on attendance_sessions.id = attendance_records.class_session_id
           and attendance_sessions.organisation_id = attendance_records.organisation_id
          join batch_memberships attendance_memberships on attendance_memberships.id = attendance_records.batch_membership_id
           and attendance_memberships.organisation_id = attendance_records.organisation_id
           and date(attendance_memberships.joined_at) <= date(attendance_sessions.session_date)
           and (attendance_memberships.left_at is null or date(attendance_memberships.left_at) >= date(attendance_sessions.session_date))
          where attendance_records.organisation_id = ?
            and attendance_sessions.batch_id = ?
            and attendance_sessions.status = 'completed'
            and attendance_records.status = 'present') as present,
         (select count(*)
          from attendance_records
          join class_sessions attendance_sessions on attendance_sessions.id = attendance_records.class_session_id
           and attendance_sessions.organisation_id = attendance_records.organisation_id
          join batch_memberships attendance_memberships on attendance_memberships.id = attendance_records.batch_membership_id
           and attendance_memberships.organisation_id = attendance_records.organisation_id
           and date(attendance_memberships.joined_at) <= date(attendance_sessions.session_date)
           and (attendance_memberships.left_at is null or date(attendance_memberships.left_at) >= date(attendance_sessions.session_date))
          where attendance_records.organisation_id = ?
            and attendance_sessions.batch_id = ?
            and attendance_sessions.status = 'completed'
            and attendance_records.status = 'absent') as absent,
         (select max(recent_sessions.session_date)
          from class_sessions recent_sessions
          where recent_sessions.organisation_id = ?
            and recent_sessions.batch_id = ?
            and recent_sessions.status != 'cancelled') as last_class_date,
         (select count(*)
          from session_materials
          where session_materials.organisation_id = ?
            and session_materials.batch_id = ?
            and session_materials.deleted_at is null) as materials_shared`,
    )
      .bind(ORG_ID, batchId, ORG_ID, batchId, ORG_ID, batchId, ORG_ID, batchId, ORG_ID, batchId)
      .first<{ classes_logged: number; present: number | null; absent: number | null; last_class_date: string | null; materials_shared: number }>(),
    c.env.DB.prepare(sessionSummarySql("class_sessions.batch_id = ?", "class_sessions.session_date desc, class_sessions.scheduled_start_time desc, class_sessions.created_at desc, class_sessions.id desc", "limit ? offset ?"))
      .bind(ORG_ID, ORG_ID, batchId, limit + 1, offset)
      .all<SessionSummaryRow>(),
  ]);
  const present = Number(summary?.present || 0);
  const absent = Number(summary?.absent || 0);
  const total = present + absent;
  const pageRows = (sessions.results || []).slice(0, limit);
  return {
    ok: true as const,
    success: true as const,
    batch: mapBatch(batch),
    summary: {
      classesLogged: Number(summary?.classes_logged || 0),
      present,
      absent,
      attendancePercent: total ? Math.round((present / total) * 100) : null,
      lastClassDate: summary?.last_class_date || null,
      materialsShared: Number(summary?.materials_shared || 0),
    },
    sessions: pageRows.map(mapSessionSummary),
    pagination: { limit, offset, hasMore: (sessions.results || []).length > limit },
  };
}

export async function getStaffAcademicSession(c: AppContext, staff: StaffContext, sessionId: string) {
  const session = await loadAcademicSession(c, staff, sessionId);
  if (!session) return notFound("session_not_found", "Class session not found.");
  const [roster, materials] = await Promise.all([
    c.env.DB.prepare(
      `select
         students.id as student_id,
         students.student_number,
         enrolments.id as enrolment_id,
         enrolments.enrolment_number,
         courses.name as course_name,
         coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as student_name,
         attendance_records.status as attendance_status
       from batch_memberships
       join enrolments on enrolments.id = batch_memberships.enrolment_id
       join courses on courses.id = enrolments.course_id
       join students on students.id = enrolments.student_id
       join people on people.id = students.person_id
       left join person_identity_details on person_identity_details.person_id = people.id
       left join attendance_records on attendance_records.class_session_id = ?
        and attendance_records.batch_membership_id = batch_memberships.id
        and attendance_records.enrolment_id = enrolments.id
       where batch_memberships.organisation_id = ?
         and batch_memberships.batch_id = ?
         and date(batch_memberships.joined_at) <= date(?)
         and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(?))
         and students.organisation_id = ?
       order by student_name collate nocase
       limit 250`,
    )
      .bind(sessionId, ORG_ID, session.batch_id, session.session_date, session.session_date, ORG_ID)
      .all<Record<string, unknown>>(),
    listMaterials(c, sessionId),
  ]);
  return {
    ok: true as const,
    success: true as const,
    session: mapSessionSummary(session),
    roster: (roster.results || []).map((row) => ({
      studentId: String(row.student_id),
      studentNumber: String(row.student_number || ""),
      enrolmentId: String(row.enrolment_id),
      enrolmentNumber: String(row.enrolment_number || ""),
      courseName: String(row.course_name || ""),
      studentName: String(row.student_name || "Student"),
      attendanceStatus: row.attendance_status ? String(row.attendance_status) : null,
    })),
    materials,
  };
}

export async function getStaffTrainerActivity(c: AppContext, staff: StaffContext, personId: string, query: { range?: string; limit?: number; offset?: number } = {}) {
  const trainer = await loadAcademicTrainer(c, staff, personId);
  if (!trainer) return notFound("trainer_not_found", "Trainer not found.");
  const limit = clampInteger(query.limit, DEFAULT_SESSION_LIMIT, 1, MAX_PAGE_LIMIT);
  const offset = clampInteger(query.offset, 0, 0, 5000);
  const days = query.range === "30d" ? 30 : 7;
  const fromDate = addIndiaDays(indiaDate(), -(days - 1));
  const week = indiaBusinessWeek();
  const [summary, sessions] = await Promise.all([
    c.env.DB.prepare(
      `select
         count(distinct case when class_sessions.status = 'completed' and class_sessions.session_date between ? and ? then class_sessions.id end) as classes_this_week,
         count(distinct case when class_sessions.status = 'completed' and class_sessions.session_date >= ? then class_sessions.id end) as classes_this_month,
         max(case when class_sessions.status != 'cancelled' then class_sessions.session_date end) as last_class_date,
         count(distinct case when batches.status = 'active' then batches.id end) as active_batches
       from people trainer
       left join class_sessions on class_sessions.trainer_person_id = trainer.id and class_sessions.organisation_id = ?
       left join batches on batches.primary_trainer_person_id = trainer.id and batches.organisation_id = ?
       where trainer.id = ? and trainer.organisation_id = ?`,
    )
      .bind(week.startsOn, week.endsOn, addIndiaDays(indiaDate(), -29), ORG_ID, ORG_ID, personId, ORG_ID)
      .first<{ classes_this_week: number; classes_this_month: number; last_class_date: string | null; active_batches: number }>(),
    c.env.DB.prepare(sessionSummarySql("class_sessions.trainer_person_id = ? and class_sessions.session_date >= ?", "class_sessions.session_date desc, class_sessions.scheduled_start_time desc, class_sessions.created_at desc, class_sessions.id desc", "limit ? offset ?"))
      .bind(ORG_ID, ORG_ID, personId, fromDate, limit + 1, offset)
      .all<SessionSummaryRow>(),
  ]);
  return {
    ok: true as const,
    success: true as const,
    trainer,
    range: query.range === "30d" ? "30d" : "7d",
    summary: {
      activeBatches: Number(summary?.active_batches || 0),
      classesThisWeek: Number(summary?.classes_this_week || 0),
      classesThisMonth: Number(summary?.classes_this_month || 0),
      lastClassDate: summary?.last_class_date || null,
    },
    sessions: (sessions.results || []).slice(0, limit).map(mapSessionSummary),
    pagination: { limit, offset, hasMore: (sessions.results || []).length > limit },
  };
}

export async function getStaffStudentAttendance(c: AppContext, staff: StaffContext, studentId: string, pagination: AcademicPagination = {}) {
  const student = await loadAcademicStudent(c, staff, studentId);
  if (!student) return notFound("student_not_found", "Student not found.");
  const limit = clampInteger(pagination.limit, DEFAULT_SESSION_LIMIT, 1, MAX_PAGE_LIMIT);
  const offset = clampInteger(pagination.offset, 0, 0, 5000);
  const [enrolments, sessions] = await Promise.all([
    c.env.DB.prepare(
      `select
         enrolments.id as enrolment_id,
         enrolments.enrolment_number,
         enrolments.status,
         courses.name as course_name,
         sum(case when class_sessions.status = 'completed' and attendance_records.status = 'present' then 1 else 0 end) as present,
         sum(case when class_sessions.status = 'completed' and attendance_records.status = 'absent' then 1 else 0 end) as absent
       from enrolments
       join courses on courses.id = enrolments.course_id
       left join batch_memberships on batch_memberships.enrolment_id = enrolments.id and batch_memberships.organisation_id = ?
       left join class_sessions on class_sessions.batch_id = batch_memberships.batch_id
        and class_sessions.organisation_id = batch_memberships.organisation_id
        and date(batch_memberships.joined_at) <= date(class_sessions.session_date)
        and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(class_sessions.session_date))
       left join attendance_records on attendance_records.class_session_id = class_sessions.id
        and attendance_records.batch_membership_id = batch_memberships.id
        and attendance_records.enrolment_id = enrolments.id
       where enrolments.student_id = ?
       group by enrolments.id
       order by enrolments.joining_date desc, enrolments.created_at desc
       limit 50`,
    )
      .bind(ORG_ID, studentId)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `select distinct
         class_sessions.id, class_sessions.branch_id, class_sessions.batch_id, batches.name as batch_name,
         class_sessions.trainer_person_id,
         coalesce(trainer_identity.official_full_name, trainers.public_name, trainers.full_name) as trainer_name,
         class_sessions.session_date, class_sessions.scheduled_start_time, class_sessions.scheduled_end_time,
         class_sessions.actual_started_at, class_sessions.actual_ended_at, class_sessions.teaching_note,
         class_sessions.status,
         case when attendance_records.status = 'present' then 1 else 0 end as present_count,
         case when attendance_records.status = 'absent' then 1 else 0 end as absent_count,
         coalesce(material_counts.material_count, 0) as material_count,
         attendance_records.status as attendance_status,
         enrolments.id as enrolment_id,
         enrolments.enrolment_number,
         courses.name as course_name
       from batch_memberships
       join enrolments on enrolments.id = batch_memberships.enrolment_id
       join courses on courses.id = enrolments.course_id
       join class_sessions on class_sessions.organisation_id = batch_memberships.organisation_id
        and class_sessions.batch_id = batch_memberships.batch_id
        and class_sessions.status = 'completed'
        and date(batch_memberships.joined_at) <= date(class_sessions.session_date)
        and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(class_sessions.session_date))
       join batches on batches.id = class_sessions.batch_id
       join people trainers on trainers.id = class_sessions.trainer_person_id
       left join person_identity_details trainer_identity on trainer_identity.person_id = trainers.id
       left join attendance_records on attendance_records.class_session_id = class_sessions.id
        and attendance_records.batch_membership_id = batch_memberships.id
        and attendance_records.enrolment_id = enrolments.id
       left join (
         select class_session_id, count(*) as material_count
         from session_materials
         where organisation_id = ? and deleted_at is null
         group by class_session_id
       ) material_counts on material_counts.class_session_id = class_sessions.id
       where batch_memberships.organisation_id = ?
         and enrolments.student_id = ?
        order by class_sessions.session_date desc, class_sessions.scheduled_start_time desc, class_sessions.created_at desc, class_sessions.id desc
       limit ? offset ?`,
    )
      .bind(ORG_ID, ORG_ID, studentId, limit + 1, offset)
      .all<Record<string, unknown>>(),
  ]);
  const pageRows = (sessions.results || []).slice(0, limit);
  return {
    ok: true as const,
    success: true as const,
    student,
    enrolments: (enrolments.results || []).map(mapStudentEnrolment),
    sessions: pageRows.map((row) => ({
      ...mapSessionSummary(row as unknown as SessionSummaryRow),
      attendanceStatus: row.attendance_status ? String(row.attendance_status) : null,
      enrolmentId: String(row.enrolment_id),
      enrolmentNumber: String(row.enrolment_number || ""),
      courseName: String(row.course_name || ""),
    })),
    pagination: { limit, offset, hasMore: (sessions.results || []).length > limit },
  };
}

export async function getStaffAcademicMaterialContent(c: AppContext, staff: StaffContext, materialId: string): Promise<MaterialContentResult> {
  const material = await c.env.DB.prepare(
    `select session_materials.*, class_sessions.branch_id as session_branch_id
     from session_materials
     join class_sessions on class_sessions.id = session_materials.class_session_id
       and class_sessions.organisation_id = session_materials.organisation_id
     where session_materials.id = ?
       and session_materials.organisation_id = ?
       and session_materials.deleted_at is null
     limit 1`,
  )
    .bind(materialId, ORG_ID)
    .first<MaterialContentRow>();
  if (!material) return notFound("material_not_found", "Material was not found.");
  if (material.branch_id !== material.session_branch_id) return notFound("material_not_found", "Material was not found.");
  if (!(await hasAcademicBranchAccess(c, staff, material.session_branch_id))) return notFound("material_not_found", "Material was not found.");
  const storage = sessionMaterialStorageFromEnv(c.env);
  if (!storage) return { ok: false, status: 503, code: "material_storage_unavailable", message: "Session material storage is not configured." };
  const object = await storage.get(material.r2_object_key);
  if (!object?.body) return { ok: false, status: 503, code: "material_missing", message: "PDF is temporarily unavailable." };
  return { ok: true, body: object.body, filename: material.original_filename, sizeBytes: object.contentLength || material.size_bytes };
}

async function loadAcademicBatch(c: AppContext, staff: StaffContext, batchId: string) {
  const row = await c.env.DB.prepare(activeBatchSql("batches.organisation_id = ? and batches.id = ?", "batches.name", 1))
    .bind(ORG_ID, ORG_ID, ORG_ID, ORG_ID, batchId)
    .first<BatchRow>();
  if (!row) return null;
  if (!(await hasAcademicBranchAccess(c, staff, row.branch_id))) return null;
  return row;
}

async function loadAcademicSession(c: AppContext, staff: StaffContext, sessionId: string) {
  const row = await c.env.DB.prepare(sessionSummarySql("class_sessions.id = ?", "class_sessions.session_date desc", "limit 1"))
    .bind(ORG_ID, ORG_ID, sessionId)
    .first<SessionSummaryRow>();
  if (!row) return null;
  if (!(await hasAcademicBranchAccess(c, staff, row.branch_id))) return null;
  return row;
}

async function loadAcademicTrainer(c: AppContext, staff: StaffContext, personId: string) {
  const row = await c.env.DB.prepare(
    `select distinct
       people.id as personId,
       coalesce(person_identity_details.official_full_name, people.public_name, people.full_name) as name,
       coalesce(person_roles.branch_id, people.home_branch_id) as branchId,
       branches.name as branchName,
       coalesce(person_roles.status, 'active') as trainerStatus
     from people
     join person_roles on person_roles.person_id = people.id
     join roles on roles.id = person_roles.role_id and roles.organisation_id = people.organisation_id and roles.code = 'trainer'
     left join branches on branches.id = coalesce(person_roles.branch_id, people.home_branch_id)
     left join person_identity_details on person_identity_details.person_id = people.id
     where people.id = ? and people.organisation_id = ?
     limit 1`,
  )
    .bind(personId, ORG_ID)
    .first<{ personId: string; name: string; branchId: string | null; branchName: string | null; trainerStatus: string }>();
  if (!row) return null;
  if (row.branchId && !(await hasAcademicBranchAccess(c, staff, row.branchId))) return null;
  return { personId: row.personId, name: row.name, branchId: row.branchId, branchName: row.branchName || "", trainerStatus: row.trainerStatus };
}

async function loadAcademicStudent(c: AppContext, staff: StaffContext, studentId: string) {
  const row = await c.env.DB.prepare(
    `select students.id as studentId, students.student_number as studentNumber, students.current_status as status,
            students.home_branch_id as branchId, branches.name as branchName,
            coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as name
     from students
     join people on people.id = students.person_id and people.organisation_id = students.organisation_id
     left join branches on branches.id = students.home_branch_id and branches.organisation_id = students.organisation_id
     left join person_identity_details on person_identity_details.person_id = people.id
     where students.id = ? and students.organisation_id = ? and people.status != 'archived'
     limit 1`,
  )
    .bind(studentId, ORG_ID)
    .first<{ studentId: string; studentNumber: string; status: string; branchId: string; branchName: string | null; name: string }>();
  if (!row) return null;
  if (!(await hasAcademicBranchAccess(c, staff, row.branchId))) return null;
  return { studentId: row.studentId, studentNumber: row.studentNumber, status: row.status, branchId: row.branchId, branchName: row.branchName || "", name: row.name };
}

async function listMaterials(c: AppContext, sessionId: string) {
  const rows = await c.env.DB.prepare(
    `select id, material_type, title, size_bytes, original_filename, created_at
     from session_materials
     where organisation_id = ? and class_session_id = ? and deleted_at is null
     order by created_at asc, id asc`,
  )
    .bind(ORG_ID, sessionId)
    .all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({
    id: String(row.id),
    materialType: String(row.material_type),
    title: String(row.title),
    sizeBytes: Number(row.size_bytes || 0),
    originalFilename: String(row.original_filename || ""),
    createdAt: String(row.created_at),
  }));
}

function activeBatchSql(where: string, orderBy: string, limit: number, limitSql = `limit ${limit}`) {
  return `select batches.id, batches.branch_id, branches.name as branch_name, batches.name,
            batches.primary_trainer_person_id,
            coalesce(trainer_identity.official_full_name, trainer.public_name, trainer.full_name) as trainer_name,
            trainer_role.trainer_status,
            batches.days_of_week_json, batches.start_time, batches.end_time, batches.status,
            course_summary.course_pairs,
            coalesce(active_counts.active_students, 0) as active_students,
            latest_session.session_date as last_session_date,
            latest_session.id as last_session_id,
            coalesce(latest_attendance.attendance_count, 0) as last_attendance_count,
            coalesce(latest_materials.material_count, 0) as last_material_count
     from batches
     left join branches on branches.id = batches.branch_id and branches.organisation_id = batches.organisation_id
     left join people trainer on trainer.id = batches.primary_trainer_person_id
     left join person_identity_details trainer_identity on trainer_identity.person_id = trainer.id
     left join (
       select person_roles.person_id, max(coalesce(person_roles.status, 'active')) as trainer_status
       from person_roles
       join roles on roles.id = person_roles.role_id and roles.code = 'trainer'
       group by person_roles.person_id
     ) trainer_role on trainer_role.person_id = trainer.id
     left join (
       select batch_courses.batch_id, group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
     left join (
       select batch_id, count(*) as active_students
       from batch_memberships
       where organisation_id = ? and status = 'active' and left_at is null
       group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     left join class_sessions latest_session on latest_session.id = (
       select inner_sessions.id
       from class_sessions inner_sessions
       where inner_sessions.organisation_id = batches.organisation_id
         and inner_sessions.batch_id = batches.id
         and inner_sessions.status != 'cancelled'
       order by inner_sessions.session_date desc, inner_sessions.scheduled_start_time desc, inner_sessions.created_at desc
       limit 1
     )
     left join (
       select class_session_id, count(*) as attendance_count
       from attendance_records
       where organisation_id = ?
       group by class_session_id
     ) latest_attendance on latest_attendance.class_session_id = latest_session.id
     left join (
       select class_session_id, count(*) as material_count
       from session_materials
       where organisation_id = ? and deleted_at is null
       group by class_session_id
     ) latest_materials on latest_materials.class_session_id = latest_session.id
     where ${where}
     order by ${orderBy}
     ${limitSql}`;
}

function sessionSummarySql(extraWhere: string, orderBy: string, limitSql: string) {
  return `select class_sessions.id, class_sessions.branch_id, class_sessions.batch_id, batches.name as batch_name,
            class_sessions.trainer_person_id,
            coalesce(trainer_identity.official_full_name, trainers.public_name, trainers.full_name) as trainer_name,
            class_sessions.session_date, class_sessions.scheduled_start_time, class_sessions.scheduled_end_time,
            class_sessions.actual_started_at, class_sessions.actual_ended_at, class_sessions.teaching_note,
            class_sessions.status,
            sum(case when attendance_memberships.id is not null and attendance_records.status = 'present' then 1 else 0 end) as present_count,
            sum(case when attendance_memberships.id is not null and attendance_records.status = 'absent' then 1 else 0 end) as absent_count,
            coalesce(material_counts.material_count, 0) as material_count
     from class_sessions
     join batches on batches.id = class_sessions.batch_id and batches.organisation_id = class_sessions.organisation_id
     left join people trainers on trainers.id = class_sessions.trainer_person_id
     left join person_identity_details trainer_identity on trainer_identity.person_id = trainers.id
     left join attendance_records on attendance_records.class_session_id = class_sessions.id and attendance_records.organisation_id = class_sessions.organisation_id
     left join batch_memberships attendance_memberships on attendance_memberships.id = attendance_records.batch_membership_id
      and attendance_memberships.organisation_id = attendance_records.organisation_id
      and date(attendance_memberships.joined_at) <= date(class_sessions.session_date)
      and (attendance_memberships.left_at is null or date(attendance_memberships.left_at) >= date(class_sessions.session_date))
     left join (
       select class_session_id, count(*) as material_count
       from session_materials
       where organisation_id = ? and deleted_at is null
       group by class_session_id
     ) material_counts on material_counts.class_session_id = class_sessions.id
     where class_sessions.organisation_id = ? and ${extraWhere}
     group by class_sessions.id
     order by ${orderBy}
     ${limitSql}`;
}

export async function hasAcademicBranchAccess(c: AppContext, staff: StaffContext, branchId: string) {
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

function buildAttention(activeBatches: ReturnType<typeof mapBatch>[], todayBatchIds: Set<string>, today: string) {
  return activeBatches.flatMap((batch) => {
    const items = [];
    const scheduledDates = previousScheduledDates(batch.daysOfWeek, today, 2);
    const scheduledToday = scheduledDates[0] === today;
    if (scheduledToday && !todayBatchIds.has(batch.id)) {
      items.push({ type: "no_class_today", severity: "medium", batchId: batch.id, batchName: batch.name, message: "No class logged today" });
    }
    if (scheduledDates.length >= 2 && (!batch.lastClassDate || batch.lastClassDate < scheduledDates[1])) {
      items.push({ type: "no_recent_class", severity: "medium", batchId: batch.id, batchName: batch.name, message: "No recent class logged" });
    }
    if (!batch.trainerPersonId) {
      items.push({ type: "trainer_unassigned", severity: "medium", batchId: batch.id, batchName: batch.name, message: "Trainer not assigned" });
    }
    return items;
  });
}

function mapBatch(row: BatchRow) {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name || "",
    name: row.name,
    trainerPersonId: row.primary_trainer_person_id,
    trainerName: row.trainer_name,
    trainerStatus: row.trainer_status,
    daysOfWeek: parseDays(row.days_of_week_json),
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    courses: parseCoursePairs(row.course_pairs),
    activeStudents: Number(row.active_students || 0),
    lastClassDate: row.last_session_date,
    lastSessionId: row.last_session_id,
    lastAttendanceCount: Number(row.last_attendance_count || 0),
    lastMaterialCount: Number(row.last_material_count || 0),
  };
}

function mapSessionSummary(row: SessionSummaryRow) {
  return {
    id: row.id,
    branchId: row.branch_id,
    batchId: row.batch_id,
    batchName: row.batch_name,
    trainerPersonId: row.trainer_person_id,
    trainerName: row.trainer_name || "Trainer",
    sessionDate: row.session_date,
    scheduledStartTime: row.scheduled_start_time,
    scheduledEndTime: row.scheduled_end_time,
    actualStartedAt: row.actual_started_at,
    actualEndedAt: row.actual_ended_at,
    teachingNote: row.teaching_note,
    teachingNoteExcerpt: row.teaching_note.slice(0, 140),
    status: row.status,
    presentCount: Number(row.present_count || 0),
    absentCount: Number(row.absent_count || 0),
    materialCount: Number(row.material_count || 0),
  };
}

function mapStudentEnrolment(row: Record<string, unknown>) {
  const present = Number(row.present || 0);
  const absent = Number(row.absent || 0);
  const total = present + absent;
  return {
    enrolmentId: String(row.enrolment_id),
    enrolmentNumber: String(row.enrolment_number || ""),
    status: String(row.status || ""),
    courseName: String(row.course_name || ""),
    totalClasses: total,
    present,
    absent,
    attendancePercent: total ? Math.round((present / total) * 100) : null,
  };
}

function parseDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const selected = new Set(parsed.map((item) => String(item).toLowerCase()));
    return WEEKDAY_ORDER.filter((day) => selected.has(day));
  } catch {
    return [];
  }
}

function parseCoursePairs(value: string | null) {
  if (!value) return [];
  return value.split(String.fromCharCode(30)).flatMap((pair) => {
    const [id, name] = pair.split(String.fromCharCode(31));
    return id ? [{ id, name: name || id }] : [];
  });
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parseIndiaDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addIndiaDays(date: string, days: number) {
  const value = parseIndiaDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function notFound(code: string, message: string) {
  return { ok: false as const, status: 404, code, message };
}
