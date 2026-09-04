import { z } from "zod";
import { ORG_ID, type TrainerProfileChoice } from "./auth-store";
import { createOpaqueId } from "./crypto";
import type { AppContext } from "./http";

export const attendanceStatuses = ["present", "absent"] as const;
export const trainerSessionStatusValues = ["open", "completed", "cancelled"] as const;
const MAX_NOTE_LENGTH = 2000;
const EDIT_WINDOW_HOURS = 48;

export const trainerSessionDateSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const saveTrainerSessionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  teachingNote: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
  attendance: z.array(z.object({
    batchMembershipId: z.string().trim().min(1).max(160),
    status: z.enum(attendanceStatuses),
  })).max(250),
});

type TrainerContext = {
  loginAccountId: string;
  activeTrainer: TrainerProfileChoice;
};

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

type SessionRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  batch_id: string;
  trainer_person_id: string;
  session_date: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  teaching_note: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by_actor_id: string | null;
};

type RosterRow = {
  membership_id: string;
  joined_at: string;
  left_at: string | null;
  membership_status: string;
  enrolment_id: string;
  enrolment_number: string;
  course_id: string;
  course_name: string;
  student_number: string;
  person_id: string;
  student_name: string;
  attendance_status?: string | null;
};

type D1RunResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

export async function listTrainerBatches(c: AppContext, trainer: TrainerContext, status = "active") {
  const bindings: unknown[] = [ORG_ID, trainer.activeTrainer.personId];
  let statusSql = "and batches.status = 'active'";
  if (status === "all") statusSql = "";
  else if (["active", "inactive", "completed"].includes(status)) {
    statusSql = "and batches.status = ?";
    bindings.push(status);
  }
  const rows = await c.env.DB.prepare(
    `select batches.*, branches.name as branch_name,
            course_summary.course_count, course_summary.course_pairs,
            coalesce(active_counts.active_students, 0) as active_students,
            latest_session.id as today_session_id
     from batches
     join branches on branches.id = batches.branch_id
     left join (
       select batch_courses.batch_id, count(*) as course_count,
              group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
     left join (
       select batch_id, count(*) as active_students
       from batch_memberships
       where status = 'active' and left_at is null
       group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     left join class_sessions latest_session
       on latest_session.batch_id = batches.id
      and latest_session.organisation_id = batches.organisation_id
      and latest_session.session_date = ?
      and latest_session.scheduled_start_time = batches.start_time
     where batches.organisation_id = ?
       and batches.primary_trainer_person_id = ?
       ${statusSql}
     order by batches.status = 'active' desc, batches.start_time, batches.name collate nocase`,
  )
    .bind(indiaDate(), ...bindings)
    .all<Record<string, unknown>>();
  return (rows.results || []).map(mapBatchRow);
}

export async function getTrainerBatchDetail(c: AppContext, trainer: TrainerContext, batchId: string) {
  const batch = await loadAssignedBatch(c, trainer.activeTrainer.personId, batchId);
  if (!batch) return null;
  const [roster, sessions] = await Promise.all([
    rosterForBatchDate(c, batchId, indiaDate()),
    recentSessionsForBatch(c, batchId),
  ]);
  return { batch: await decorateBatch(c, batch), roster: mapRoster(roster), sessions };
}

export async function listTrainerSessions(c: AppContext, trainer: TrainerContext) {
  const rows = await c.env.DB.prepare(
    `select class_sessions.*,
            batches.name as batch_name,
            branches.name as branch_name,
            course_summary.course_pairs,
            sum(case when attendance_records.status = 'present' then 1 else 0 end) as present_count,
            sum(case when attendance_records.status = 'absent' then 1 else 0 end) as absent_count
     from class_sessions
     join batches on batches.id = class_sessions.batch_id
       and batches.organisation_id = class_sessions.organisation_id
     join branches on branches.id = class_sessions.branch_id
     left join (
       select batch_courses.batch_id,
              group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = class_sessions.batch_id
     left join attendance_records on attendance_records.class_session_id = class_sessions.id
     where class_sessions.organisation_id = ?
       and class_sessions.trainer_person_id = ?
     group by class_sessions.id
     order by class_sessions.session_date desc, class_sessions.scheduled_start_time desc, class_sessions.created_at desc
     limit 50`,
  )
    .bind(ORG_ID, trainer.activeTrainer.personId)
    .all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({
    ...mapSession(row as unknown as SessionRecord, isWithinEditWindow(String(row.session_date))),
    batchName: String(row.batch_name || ""),
    branchName: String(row.branch_name || ""),
    courseLabel: parseCoursePairs(row.course_pairs, "", "").map((course) => course.name).join(" / "),
    presentCount: Number(row.present_count || 0),
    absentCount: Number(row.absent_count || 0),
    teachingNoteExcerpt: String(row.teaching_note || "").slice(0, 140),
  }));
}

export async function openOrCreateTrainerSession(c: AppContext, trainer: TrainerContext, batchId: string, sessionDate = indiaDate()) {
  const batch = await loadAssignedBatch(c, trainer.activeTrainer.personId, batchId);
  if (!batch) return { ok: false as const, status: 404, code: "batch_not_found", message: "Batch not found." };
  if (batch.status !== "active") return { ok: false as const, status: 409, code: "batch_not_active", message: "New sessions can be created only for active batches." };
  const existing = await findBatchSession(c, batchId, sessionDate, batch.start_time);
  if (existing) return { ok: true as const, session: await sessionDetail(c, existing, trainer) };

  const now = new Date().toISOString();
  const sessionId = createOpaqueId("classsess");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into class_sessions (
         id, organisation_id, branch_id, batch_id, trainer_person_id, session_date,
         scheduled_start_time, scheduled_end_time, actual_started_at, actual_ended_at,
         teaching_note, status, version, created_at, updated_at, created_by_actor_id
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, '', 'open', 1, ?, ?, ?)`,
    ).bind(sessionId, ORG_ID, batch.branch_id, batch.id, trainer.activeTrainer.personId, sessionDate, batch.start_time, batch.end_time, now, now, now, trainer.loginAccountId),
    auditStatement(c, batch.branch_id, trainer, "trainer_session_created", "class_session", sessionId, { batchId: batch.id, sessionDate }),
  ]);
  const created = await getSession(c, sessionId);
  if (!created) throw new Error("Session creation failed");
  return { ok: true as const, session: await sessionDetail(c, created, trainer) };
}

export async function getTrainerSessionDetail(c: AppContext, trainer: TrainerContext, sessionId: string) {
  const session = await getSession(c, sessionId);
  if (!session) return null;
  if (!(await canAccessSession(c, trainer.activeTrainer.personId, session))) return null;
  return sessionDetail(c, session, trainer);
}

export async function saveTrainerSession(c: AppContext, trainer: TrainerContext, sessionId: string, input: z.infer<typeof saveTrainerSessionSchema>) {
  const session = await getSession(c, sessionId);
  if (!session) return { ok: false as const, status: 404, code: "session_not_found", message: "Class session not found." };
  if (session.trainer_person_id !== trainer.activeTrainer.personId) {
    return { ok: false as const, status: 403, code: "forbidden", message: "Only the session trainer can save this session." };
  }
  if (!isWithinEditWindow(session.session_date)) {
    return { ok: false as const, status: 409, code: "edit_window_closed", message: "Trainer edits are available for 48 hours after the class date." };
  }
  if (session.version !== input.expectedVersion) {
    return { ok: false as const, status: 409, code: "stale_session", message: "This session changed elsewhere. Reload and try again." };
  }
  const applicable = await rosterForBatchDate(c, session.batch_id, session.session_date);
  const rosterIds = new Set(applicable.map((row) => row.membership_id));
  const submittedIds = new Set(input.attendance.map((row) => row.batchMembershipId));
  if (submittedIds.size !== input.attendance.length) {
    return { ok: false as const, status: 400, code: "duplicate_attendance", message: "Attendance contains duplicate students." };
  }
  if (submittedIds.size !== rosterIds.size || input.attendance.some((row) => !rosterIds.has(row.batchMembershipId))) {
    return { ok: false as const, status: 400, code: "attendance_roster_mismatch", message: "Mark attendance for every current student in this session." };
  }

  const now = new Date().toISOString();
  const byMembership = new Map(applicable.map((row) => [row.membership_id, row]));
  const statements = [
    c.env.DB.prepare(
      `update class_sessions
       set teaching_note = ?, status = 'completed', actual_ended_at = coalesce(actual_ended_at, ?), version = version + 1, updated_at = ?
       where id = ? and organisation_id = ? and version = ?`,
    ).bind(input.teachingNote, now, now, session.id, ORG_ID, input.expectedVersion),
    ...input.attendance.map((item) => {
      const roster = byMembership.get(item.batchMembershipId);
      return c.env.DB.prepare(
        `insert into attendance_records (
           id, organisation_id, class_session_id, batch_membership_id, enrolment_id, person_id,
           status, marked_by_actor_id, marked_at, updated_at
         )
         select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         where exists (
           select 1 from class_sessions
           where id = ? and organisation_id = ? and version = ? and updated_at = ?
         )
         on conflict(class_session_id, batch_membership_id) do update set
           status = excluded.status,
           marked_by_actor_id = excluded.marked_by_actor_id,
           marked_at = excluded.marked_at,
           updated_at = excluded.updated_at`,
      ).bind(
        createOpaqueId("att"),
        ORG_ID,
        session.id,
        item.batchMembershipId,
        roster?.enrolment_id || "",
        roster?.person_id || "",
        item.status,
        trainer.loginAccountId,
        now,
        now,
        session.id,
        ORG_ID,
        input.expectedVersion + 1,
        now,
      );
    }),
    guardedAuditStatement(c, session.branch_id, trainer, "trainer_session_saved", "class_session", session.id, {
      present: input.attendance.filter((row) => row.status === "present").length,
      absent: input.attendance.filter((row) => row.status === "absent").length,
      rosterCount: applicable.length,
    }, input.expectedVersion + 1, now),
  ];
  const results = await c.env.DB.batch(statements);
  if (!changed(results[0] as D1RunResult)) {
    return { ok: false as const, status: 409, code: "stale_session", message: "This session changed elsewhere. Reload and try again." };
  }
  const updated = await getSession(c, session.id);
  if (!updated) throw new Error("Session update failed");
  return { ok: true as const, session: await sessionDetail(c, updated, trainer) };
}

function indiaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function isWithinEditWindow(sessionDate: string, now = new Date()) {
  const end = new Date(`${sessionDate}T23:59:59.999+05:30`).getTime() + EDIT_WINDOW_HOURS * 60 * 60_000;
  return now.getTime() <= end;
}

async function loadAssignedBatch(c: AppContext, trainerPersonId: string, batchId: string) {
  return c.env.DB.prepare(
    `select * from batches
     where id = ? and organisation_id = ? and primary_trainer_person_id = ?`,
  )
    .bind(batchId, ORG_ID, trainerPersonId)
    .first<BatchRecord>();
}

async function decorateBatch(c: AppContext, batch: BatchRecord) {
  const rows = await c.env.DB.prepare(
    `select batches.*, branches.name as branch_name,
            course_summary.course_count, course_summary.course_pairs,
            coalesce(active_counts.active_students, 0) as active_students
     from batches
     join branches on branches.id = batches.branch_id
     left join (
       select batch_courses.batch_id, count(*) as course_count,
              group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
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

async function findBatchSession(c: AppContext, batchId: string, sessionDate: string, startTime: string) {
  return c.env.DB.prepare(
    `select * from class_sessions
     where organisation_id = ? and batch_id = ? and session_date = ? and scheduled_start_time = ?
     limit 1`,
  )
    .bind(ORG_ID, batchId, sessionDate, startTime)
    .first<SessionRecord>();
}

async function getSession(c: AppContext, sessionId: string) {
  return c.env.DB.prepare("select * from class_sessions where id = ? and organisation_id = ?")
    .bind(sessionId, ORG_ID)
    .first<SessionRecord>();
}

async function canAccessSession(c: AppContext, trainerPersonId: string, session: SessionRecord) {
  if (session.trainer_person_id === trainerPersonId) return true;
  const batch = await c.env.DB.prepare(
    `select 1 as allowed
     from batches
     where id = ? and organisation_id = ? and primary_trainer_person_id = ?
     limit 1`,
  )
    .bind(session.batch_id, ORG_ID, trainerPersonId)
    .first<{ allowed: number }>();
  return Boolean(batch);
}

async function sessionDetail(c: AppContext, session: SessionRecord, trainer: TrainerContext) {
  const batch = await c.env.DB.prepare(
    `select batches.*, branches.name as branch_name,
            course_summary.course_count, course_summary.course_pairs,
            coalesce(active_counts.active_students, 0) as active_students
     from batches
     join branches on branches.id = batches.branch_id
     left join (
       select batch_courses.batch_id, count(*) as course_count,
              group_concat(courses.id || char(31) || courses.name, char(30)) as course_pairs
       from batch_courses
       join courses on courses.id = batch_courses.course_id and courses.organisation_id = batch_courses.organisation_id
       group by batch_courses.batch_id
     ) course_summary on course_summary.batch_id = batches.id
     left join (
       select batch_id, count(*) as active_students
       from batch_memberships
       where status = 'active' and left_at is null
       group by batch_id
     ) active_counts on active_counts.batch_id = batches.id
     where batches.id = ?`,
  )
    .bind(session.batch_id)
    .first<Record<string, unknown>>();
  const roster = await rosterForSession(c, session);
  return {
    session: mapSession(session, session.trainer_person_id === trainer.activeTrainer.personId && isWithinEditWindow(session.session_date)),
    batch: batch ? mapBatchRow(batch) : null,
    roster: mapRoster(roster),
  };
}

async function rosterForBatchDate(c: AppContext, batchId: string, sessionDate: string) {
  return c.env.DB.prepare(
    `select batch_memberships.id as membership_id,
            batch_memberships.joined_at,
            batch_memberships.left_at,
            batch_memberships.status as membership_status,
            enrolments.id as enrolment_id,
            enrolments.enrolment_number,
            enrolments.course_id,
            courses.name as course_name,
            students.student_number,
            people.id as person_id,
            coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as student_name
     from batch_memberships
     join enrolments on enrolments.id = batch_memberships.enrolment_id
     join courses on courses.id = enrolments.course_id
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     where batch_memberships.organisation_id = ?
       and batch_memberships.batch_id = ?
       and date(batch_memberships.joined_at) <= date(?)
       and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(?))
       and students.organisation_id = ?
     order by student_name collate nocase
     limit 200`,
  )
    .bind(ORG_ID, batchId, sessionDate, sessionDate, ORG_ID)
    .all<RosterRow>()
    .then((rows) => rows.results || []);
}

async function rosterForSession(c: AppContext, session: SessionRecord) {
  return c.env.DB.prepare(
    `select batch_memberships.id as membership_id,
            batch_memberships.joined_at,
            batch_memberships.left_at,
            batch_memberships.status as membership_status,
            enrolments.id as enrolment_id,
            enrolments.enrolment_number,
            enrolments.course_id,
            courses.name as course_name,
            students.student_number,
            people.id as person_id,
            coalesce(person_identity_details.official_full_name, people.full_name, people.public_name) as student_name,
            attendance_records.status as attendance_status
     from batch_memberships
     join enrolments on enrolments.id = batch_memberships.enrolment_id
     join courses on courses.id = enrolments.course_id
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     left join attendance_records
       on attendance_records.class_session_id = ?
      and attendance_records.batch_membership_id = batch_memberships.id
     where batch_memberships.organisation_id = ?
       and batch_memberships.batch_id = ?
       and date(batch_memberships.joined_at) <= date(?)
       and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(?))
       and students.organisation_id = ?
     order by student_name collate nocase
     limit 200`,
  )
    .bind(session.id, ORG_ID, session.batch_id, session.session_date, session.session_date, ORG_ID)
    .all<RosterRow>()
    .then((rows) => rows.results || []);
}

async function recentSessionsForBatch(c: AppContext, batchId: string) {
  const rows = await c.env.DB.prepare(
    `select class_sessions.*,
            sum(case when attendance_records.status = 'present' then 1 else 0 end) as present_count,
            sum(case when attendance_records.status = 'absent' then 1 else 0 end) as absent_count
     from class_sessions
     left join attendance_records on attendance_records.class_session_id = class_sessions.id
     where class_sessions.organisation_id = ? and class_sessions.batch_id = ?
     group by class_sessions.id
     order by class_sessions.session_date desc, class_sessions.scheduled_start_time desc
     limit 25`,
  )
    .bind(ORG_ID, batchId)
    .all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({
    ...mapSession(row as unknown as SessionRecord, isWithinEditWindow(String(row.session_date))),
    presentCount: Number(row.present_count || 0),
    absentCount: Number(row.absent_count || 0),
    teachingNoteExcerpt: String(row.teaching_note || "").slice(0, 140),
  }));
}

function auditStatement(c: AppContext, branchId: string, trainer: TrainerContext, action: string, entityType: string, entityId: string, metadata: unknown) {
  return c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(createOpaqueId("audit"), ORG_ID, branchId, trainer.loginAccountId, trainer.activeTrainer.personId, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString());
}

function guardedAuditStatement(c: AppContext, branchId: string, trainer: TrainerContext, action: string, entityType: string, entityId: string, metadata: unknown, version: number, updatedAt: string) {
  return c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     where exists (
       select 1 from class_sessions
       where id = ? and organisation_id = ? and version = ? and updated_at = ?
     )`,
  ).bind(createOpaqueId("audit"), ORG_ID, branchId, trainer.loginAccountId, trainer.activeTrainer.personId, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString(), entityId, ORG_ID, version, updatedAt);
}

function mapBatchRow(row: Record<string, unknown>) {
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
    daysOfWeek: parseDays(String(row.days_of_week_json || "[]")),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    activeStudents: Number(row.active_students || 0),
    status: String(row.status),
    todaySessionId: row.today_session_id ? String(row.today_session_id) : null,
  };
}

function mapRoster(rows: RosterRow[]) {
  return rows.map((row) => ({
    batchMembershipId: row.membership_id,
    enrolmentId: row.enrolment_id,
    enrolmentNumber: row.enrolment_number,
    studentNumber: row.student_number,
    studentName: row.student_name,
    courseId: row.course_id,
    courseName: row.course_name,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    attendanceStatus: row.attendance_status || null,
  }));
}

function mapSession(session: SessionRecord, canEdit: boolean) {
  return {
    id: session.id,
    batchId: session.batch_id,
    trainerPersonId: session.trainer_person_id,
    sessionDate: session.session_date,
    scheduledStartTime: session.scheduled_start_time,
    scheduledEndTime: session.scheduled_end_time,
    actualStartedAt: session.actual_started_at,
    actualEndedAt: session.actual_ended_at,
    teachingNote: session.teaching_note,
    status: session.status,
    version: Number(session.version),
    canEdit,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

function parseDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseCoursePairs(value: unknown, legacyCourseId: unknown, legacyCourseName: unknown) {
  const fallback = [{ id: String(legacyCourseId || ""), name: String(legacyCourseName || "") }];
  if (typeof value !== "string" || !value) return fallback;
  const courses = value.split(String.fromCharCode(30)).flatMap((pair) => {
    const [id, name] = pair.split(String.fromCharCode(31));
    return id ? [{ id, name: name || id }] : [];
  });
  return courses.length ? courses : fallback;
}

function changed(result: D1RunResult) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 1) > 0;
}
