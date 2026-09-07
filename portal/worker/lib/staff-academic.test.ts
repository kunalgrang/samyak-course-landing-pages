/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./http";
import {
  getStaffAcademicBatch,
  getStaffAcademicMaterialContent,
  getStaffAcademicOverview,
  getStaffAcademicSession,
  getStaffStudentAttendance,
  getStaffTrainerActivity,
  indiaBusinessWeek,
  indiaDate,
  previousScheduledDates,
} from "./staff-academic";
import type { StaffContext } from "./staff-auth";

const NOW = "2026-09-04T18:45:00.000Z";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nstaff academic");

class SqliteD1Statement {
  private values: unknown[] = [];
  constructor(private readonly db: SqliteD1, private readonly sql: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.database.prepare(this.sql).get(...(this.values as any[])) ?? null) as T;
  }
  async all<T>() {
    return { results: this.db.database.prepare(this.sql).all(...(this.values as any[])) } as T;
  }
  async run() {
    const result = this.db.database.prepare(this.sql).run(...(this.values as any[]));
    return { success: true, meta: { changes: result.changes, rows_written: result.changes } };
  }
}

class SqliteD1 {
  readonly database = new DatabaseSync(":memory:");
  prepare(sql: string) {
    return new SqliteD1Statement(this, sql);
  }
}

class MemoryR2 {
  readonly objects = new Map<string, Uint8Array>();
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return { body: new Response(bytes).body, size: bytes.byteLength, arrayBuffer: async () => new Uint8Array(bytes).buffer };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("staff academic service", () => {
  it("uses India-local dates, Monday week start, and schedule-aware previous days", () => {
    expect(indiaDate(new Date("2026-09-04T18:45:00.000Z"))).toBe("2026-09-05");
    expect(indiaBusinessWeek(new Date("2026-09-04T18:45:00.000Z"))).toEqual({ startsOn: "2026-08-31", endsOn: "2026-09-06" });
    expect(previousScheduledDates(["mon", "wed", "fri"], "2026-09-05", 2)).toEqual(["2026-09-04", "2026-09-02"]);
  });

  it("summarizes today's classes and flags scheduled gaps without treating unscheduled batches as missing", async () => {
    const { c } = setup();
    const overview = await getStaffAcademicOverview(c, owner());

    expect(overview.summary).toMatchObject({ classesToday: 5, studentsPresentToday: 1, studentsAbsentToday: 2, activeBatches: 6 });
    expect(overview.todayClasses.map((session) => session.status)).toEqual(expect.arrayContaining(["completed", "open", "cancelled"]));
    expect(overview.needsAttention).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: "batch_no_today", type: "no_class_today" }),
      expect.objectContaining({ batchId: "batch_no_today", type: "no_recent_class" }),
      expect.objectContaining({ batchId: "batch_unassigned", type: "trainer_unassigned" }),
    ]));
    expect(overview.needsAttention).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: "batch_unscheduled", type: "no_class_today" }),
    ]));
  });

  it("enforces branch scope for overview, batch, session, trainer and student reads", async () => {
    const { c } = setup();
    const scoped = admin("branch_sion");
    const overview = await getStaffAcademicOverview(c, scoped);

    expect(overview.activeBatches.map((batch) => batch.branchId)).toEqual(expect.arrayContaining(["branch_sion"]));
    expect(overview.activeBatches.map((batch) => batch.branchId)).not.toContain("branch_bandra");
    await expect(getStaffAcademicBatch(c, scoped, "batch_bandra")).resolves.toMatchObject({ ok: false, code: "batch_not_found" });
    await expect(getStaffAcademicSession(c, scoped, "session_bandra")).resolves.toMatchObject({ ok: false, code: "session_not_found" });
    await expect(getStaffTrainerActivity(c, scoped, "person_bandra_trainer")).resolves.toMatchObject({ ok: false, code: "trainer_not_found" });
    await expect(getStaffStudentAttendance(c, scoped, "student_bandra")).resolves.toMatchObject({ ok: false, code: "student_not_found" });
  });

  it("reports batch sessions with completed metrics, open visibility, material counts and no-session empty state", async () => {
    const { c } = setup();
    const detail = await getStaffAcademicBatch(c, owner(), "batch_morning");
    expect(detail).toMatchObject({ ok: true });
    if (!detail.ok) throw new Error("expected batch");

    expect(detail.summary).toMatchObject({ classesLogged: 3, present: 3, absent: 1, attendancePercent: 75, materialsShared: 3 });
    expect(detail.sessions.map((session) => session.status)).toContain("open");
    expect(detail.sessions.map((session) => session.status)).toContain("cancelled");
    expect(detail.sessions.find((session) => session.id === "session_today")?.materialCount).toBe(3);
    expect(JSON.stringify(detail)).not.toContain("9876543210");

    const empty = await getStaffAcademicBatch(c, owner(), "batch_unscheduled");
    expect(empty).toMatchObject({ ok: true, sessions: [], summary: { attendancePercent: null, lastClassDate: null } });
  });

  it("shows session roster fields, teaching note, active materials only, and private PDF content headers data", async () => {
    const { c } = setup();
    const detail = await getStaffAcademicSession(c, owner(), "session_today");
    expect(detail).toMatchObject({ ok: true });
    if (!detail.ok) throw new Error("expected session");

    expect(detail.session.teachingNote).toBe("Power BI relationships");
    expect(detail.roster).toEqual(expect.arrayContaining([
      expect.objectContaining({ studentName: "Asha Student", studentNumber: "SYK-001", courseName: "Excel", attendanceStatus: "present" }),
      expect.objectContaining({ studentName: "Late Joiner", attendanceStatus: "absent" }),
    ]));
    expect(JSON.stringify(detail.roster)).not.toContain("fees");
    expect(detail.materials).toHaveLength(3);
    expect(JSON.stringify(detail.materials)).not.toContain("r2_object_key");

    await expect(getStaffAcademicMaterialContent(c, owner(), "mat_today")).resolves.toMatchObject({ ok: true, filename: "notes.pdf", sizeBytes: PDF_BYTES.byteLength });
    await expect(getStaffAcademicMaterialContent(c, owner(), "mat_deleted")).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    await expect(getStaffAcademicMaterialContent(c, admin("branch_sion"), "mat_bandra")).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    await expect(getStaffAcademicMaterialContent(c, admin("branch_sion"), "mat_mismatched_branch")).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    await expect(getStaffAcademicMaterialContent(c, owner(), "mat_missing")).resolves.toMatchObject({ ok: false, status: 503, code: "material_missing" });
  });

  it("reports trainer activity without scoring and preserves historical session trainer assignment", async () => {
    const { c } = setup();
    const activity = await getStaffTrainerActivity(c, owner(), "person_trainer", { range: "30d" });
    expect(activity).toMatchObject({ ok: true });
    if (!activity.ok) throw new Error("expected trainer");

    expect(activity.summary).toMatchObject({ activeBatches: 3, classesThisWeek: 4, classesThisMonth: 4, lastClassDate: "2026-09-05" });
    expect(activity.sessions.map((session) => session.id)).toContain("session_reassigned_history");
    expect(JSON.stringify(activity)).not.toMatch(/score|rating|rank/i);
  });

  it("isolates student attendance by enrolment and transfer-valid membership dates", async () => {
    const { c } = setup();
    const attendance = await getStaffStudentAttendance(c, owner(), "student_transfer");
    expect(attendance).toMatchObject({ ok: true });
    if (!attendance.ok) throw new Error("expected student");

    expect(attendance.enrolments).toEqual(expect.arrayContaining([
      expect.objectContaining({ enrolmentId: "enrol_transfer_excel", courseName: "Excel", present: 1, absent: 0, attendancePercent: 100 }),
      expect.objectContaining({ enrolmentId: "enrol_transfer_tally", courseName: "Tally", present: 0, absent: 1, attendancePercent: 0 }),
    ]));
    expect(attendance.sessions.map((session) => session.id)).toEqual(expect.arrayContaining(["session_old_batch", "session_new_batch"]));
    expect(attendance.sessions.map((session) => session.id)).not.toContain("session_after_left");
    expect(attendance.sessions.map((session) => session.id)).not.toContain("session_cancelled");
  });
});

function setup() {
  const d1 = new SqliteD1();
  const storage = new MemoryR2();
  installSchema(d1.database);
  seed(d1.database, storage);
  return { c: { env: { DB: d1, CERTIFICATE_PDFS: storage } } as unknown as AppContext & { env: { DB: SqliteD1; CERTIFICATE_PDFS: MemoryR2 } } };
}

function owner(): StaffContext {
  return { loginAccountId: "acct_owner", activePersonId: "person_owner", roles: ["owner"] };
}

function admin(branchId: string): StaffContext {
  return { loginAccountId: branchId === "branch_sion" ? "acct_admin_sion" : "acct_admin_bandra", activePersonId: null, roles: ["admin"] };
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table branches (id text primary key, organisation_id text, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, status text default 'active', created_at text);
    create table courses (id text primary key, organisation_id text, code text, name text, duration_label text, status text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, current_status text, portal_status text, created_at text, updated_at text);
    create table enrolments (id text primary key, student_id text, branch_id text, course_id text, enrolment_number text, joining_date text, actual_completion_date text, status text, created_at text, updated_at text);
    create table batches (id text primary key, organisation_id text, branch_id text, course_id text, name text, primary_trainer_person_id text, days_of_week_json text, start_time text, end_time text, capacity integer, status text, created_by_login_account_id text, created_at text, updated_at text);
    create table batch_courses (batch_id text, course_id text, organisation_id text, created_at text, created_by text, primary key (batch_id, course_id));
    create table batch_memberships (id text primary key, organisation_id text, batch_id text, enrolment_id text, joined_at text, left_at text, status text, assigned_by_login_account_id text, created_at text);
    create table class_sessions (id text primary key, organisation_id text, branch_id text, batch_id text, trainer_person_id text, session_date text, scheduled_start_time text, scheduled_end_time text, actual_started_at text, actual_ended_at text, teaching_note text, status text, version integer, created_at text, updated_at text, created_by_actor_id text);
    create table attendance_records (id text primary key, organisation_id text, class_session_id text, batch_membership_id text, enrolment_id text, person_id text, status text, marked_by_actor_id text, marked_at text, updated_at text);
    create table session_materials (id text primary key, organisation_id text, branch_id text, class_session_id text, batch_id text, trainer_person_id text, material_type text, title text, r2_object_key text, mime_type text, size_bytes integer, original_filename text, created_at text, updated_at text, created_by_actor_id text, deleted_at text);
  `);
}

function seed(db: DatabaseSync, storage: MemoryR2) {
  for (const [id, name] of [["branch_sion", "Sion"], ["branch_bandra", "Bandra"]] as const) {
    db.prepare("insert into branches values (?, 'org_samyak', ?, ?, 'Asia/Kolkata', 'active', ?, ?)").run(id, name, name.toUpperCase(), NOW, NOW);
  }
  db.prepare("insert into roles values ('role_admin', 'org_samyak', 'admin', 'Admin', ?)").run(NOW);
  db.prepare("insert into roles values ('role_trainer', 'org_samyak', 'trainer', 'Trainer', ?)").run(NOW);
  db.prepare("insert into login_account_roles values ('acct_admin_sion', 'role_admin', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into login_account_roles values ('acct_admin_bandra', 'role_admin', 'branch_bandra', ?)").run(NOW);
  for (const [id, branch, name] of [
    ["person_owner", "branch_sion", "Owner"],
    ["person_trainer", "branch_sion", "Rajesh Sharma"],
    ["person_new_trainer", "branch_sion", "New Trainer"],
    ["person_bandra_trainer", "branch_bandra", "Bandra Trainer"],
    ["person_asha", "branch_sion", "Asha Student"],
    ["person_late", "branch_sion", "Late Joiner"],
    ["person_transfer", "branch_sion", "Transfer Student"],
    ["person_bandra_student", "branch_bandra", "Bandra Student"],
  ] as const) {
    db.prepare("insert into people values (?, 'org_samyak', ?, ?, ?, null, 'active', ?, ?)").run(id, branch, name, name, NOW, NOW);
    db.prepare("insert into person_identity_details values (?, ?, null, ?, ?)").run(id, name, NOW, NOW);
  }
  for (const personId of ["person_trainer", "person_new_trainer", "person_bandra_trainer"]) {
    const branch = personId === "person_bandra_trainer" ? "branch_bandra" : "branch_sion";
    db.prepare("insert into person_roles values (?, 'role_trainer', ?, ?, 'active', ?)").run(personId, branch, branch, NOW);
  }
  for (const [id, name] of [["course_excel", "Excel"], ["course_tally", "Tally"]] as const) {
    db.prepare("insert into courses values (?, 'org_samyak', ?, ?, '1 month', 'active', ?, ?)").run(id, id.toUpperCase(), name, NOW, NOW);
  }
  for (const [id, person, branch, number] of [
    ["student_asha", "person_asha", "branch_sion", "SYK-001"],
    ["student_late", "person_late", "branch_sion", "SYK-002"],
    ["student_transfer", "person_transfer", "branch_sion", "SYK-003"],
    ["student_bandra", "person_bandra_student", "branch_bandra", "SYK-B01"],
  ] as const) {
    db.prepare("insert into students values (?, 'org_samyak', ?, ?, ?, 'active', 'active', ?, ?)").run(id, person, branch, number, NOW, NOW);
  }
  enrolment(db, "enrol_asha", "student_asha", "branch_sion", "course_excel", "ENR-001");
  enrolment(db, "enrol_late", "student_late", "branch_sion", "course_excel", "ENR-002");
  enrolment(db, "enrol_transfer_excel", "student_transfer", "branch_sion", "course_excel", "ENR-003-A");
  enrolment(db, "enrol_transfer_tally", "student_transfer", "branch_sion", "course_tally", "ENR-003-B");
  enrolment(db, "enrol_bandra", "student_bandra", "branch_bandra", "course_excel", "ENR-B01");

  batch(db, "batch_morning", "branch_sion", "Data Analytics Morning", "person_trainer", ["mon", "wed", "sat"], "active", "course_excel");
  batch(db, "batch_no_today", "branch_sion", "No Class Today", "person_trainer", ["sat"], "active", "course_excel");
  batch(db, "batch_unscheduled", "branch_sion", "Weekend Batch", "person_trainer", ["sun"], "active", "course_excel");
  batch(db, "batch_unassigned", "branch_sion", "Unassigned Batch", null, ["sat"], "active", "course_excel");
  batch(db, "batch_new", "branch_sion", "New Batch", "person_new_trainer", ["sat"], "active", "course_tally");
  batch(db, "batch_bandra", "branch_bandra", "Bandra Batch", "person_bandra_trainer", ["sat"], "active", "course_excel");

  membership(db, "mem_asha", "batch_morning", "enrol_asha", "2026-08-20T04:30:00.000Z", null, "active");
  membership(db, "mem_late", "batch_morning", "enrol_late", "2026-09-03T04:30:00.000Z", null, "active");
  membership(db, "mem_transfer_old", "batch_morning", "enrol_transfer_excel", "2026-08-20T04:30:00.000Z", "2026-09-03T04:30:00.000Z", "transferred");
  membership(db, "mem_transfer_new", "batch_new", "enrol_transfer_tally", "2026-09-04T04:30:00.000Z", null, "active");
  membership(db, "mem_bandra", "batch_bandra", "enrol_bandra", "2026-08-20T04:30:00.000Z", null, "active");

  session(db, "session_today", "batch_morning", "branch_sion", "person_trainer", "2026-09-05", "completed", "Power BI relationships");
  session(db, "session_open", "batch_morning", "branch_sion", "person_trainer", "2026-09-05", "open", "Draft open session");
  session(db, "session_cancelled", "batch_morning", "branch_sion", "person_trainer", "2026-09-05", "cancelled", "Cancelled class");
  session(db, "session_old_batch", "batch_morning", "branch_sion", "person_trainer", "2026-09-02", "completed", "Excel foundations");
  session(db, "session_after_left", "batch_morning", "branch_sion", "person_trainer", "2026-09-05", "completed", "After transfer");
  session(db, "session_new_batch", "batch_new", "branch_sion", "person_new_trainer", "2026-09-05", "completed", "Tally practice");
  session(db, "session_reassigned_history", "batch_new", "branch_sion", "person_trainer", "2026-09-01", "completed", "Historical trainer session");
  session(db, "session_bandra", "batch_bandra", "branch_bandra", "person_bandra_trainer", "2026-09-05", "completed", "Bandra class");

  attendance(db, "att_asha_today", "session_today", "mem_asha", "enrol_asha", "person_asha", "present");
  attendance(db, "att_late_today", "session_today", "mem_late", "enrol_late", "person_late", "absent");
  attendance(db, "att_asha_old", "session_old_batch", "mem_asha", "enrol_asha", "person_asha", "present");
  attendance(db, "att_transfer_old", "session_old_batch", "mem_transfer_old", "enrol_transfer_excel", "person_transfer", "present");
  attendance(db, "att_transfer_after_left", "session_after_left", "mem_transfer_old", "enrol_transfer_excel", "person_transfer", "absent");
  attendance(db, "att_transfer_new", "session_new_batch", "mem_transfer_new", "enrol_transfer_tally", "person_transfer", "absent");

  material(db, "mat_today", "session_today", "batch_morning", "branch_sion", "person_trainer", "notes.pdf", null);
  material(db, "mat_today_extra", "session_today", "batch_morning", "branch_sion", "person_trainer", "extra.pdf", null);
  material(db, "mat_deleted", "session_today", "batch_morning", "branch_sion", "person_trainer", "deleted.pdf", NOW);
  material(db, "mat_bandra", "session_bandra", "batch_bandra", "branch_bandra", "person_bandra_trainer", "bandra.pdf", null);
  material(db, "mat_mismatched_branch", "session_bandra", "batch_bandra", "branch_sion", "person_bandra_trainer", "mismatch.pdf", null);
  material(db, "mat_missing", "session_today", "batch_morning", "branch_sion", "person_trainer", "missing.pdf", null);
  storage.objects.set("key_mat_today", PDF_BYTES);
  storage.objects.set("key_mat_today_extra", PDF_BYTES);
  storage.objects.set("key_mat_bandra", PDF_BYTES);
  storage.objects.set("key_mat_mismatched_branch", PDF_BYTES);
}

function enrolment(db: DatabaseSync, id: string, studentId: string, branchId: string, courseId: string, number: string) {
  db.prepare("insert into enrolments values (?, ?, ?, ?, ?, '2026-08-20', null, 'active', ?, ?)").run(id, studentId, branchId, courseId, number, NOW, NOW);
}

function batch(db: DatabaseSync, id: string, branchId: string, name: string, trainerId: string | null, days: string[], status: string, courseId: string) {
  db.prepare("insert into batches values (?, 'org_samyak', ?, ?, ?, ?, ?, '10:00', '12:00', null, ?, 'acct_owner', ?, ?)")
    .run(id, branchId, courseId, name, trainerId, JSON.stringify(days), status, NOW, NOW);
  db.prepare("insert into batch_courses values (?, ?, 'org_samyak', ?, 'acct_owner')").run(id, courseId, NOW);
}

function membership(db: DatabaseSync, id: string, batchId: string, enrolmentId: string, joinedAt: string, leftAt: string | null, status: string) {
  db.prepare("insert into batch_memberships values (?, 'org_samyak', ?, ?, ?, ?, ?, 'acct_owner', ?)").run(id, batchId, enrolmentId, joinedAt, leftAt, status, NOW);
}

function session(db: DatabaseSync, id: string, batchId: string, branchId: string, trainerId: string, date: string, status: string, note: string) {
  db.prepare("insert into class_sessions values (?, 'org_samyak', ?, ?, ?, ?, '10:00', '12:00', ?, ?, ?, ?, 1, ?, ?, 'acct_trainer')")
    .run(id, branchId, batchId, trainerId, date, NOW, NOW, note, status, NOW, NOW);
}

function attendance(db: DatabaseSync, id: string, sessionId: string, membershipId: string, enrolmentId: string, personId: string, status: string) {
  db.prepare("insert into attendance_records values (?, 'org_samyak', ?, ?, ?, ?, ?, 'acct_trainer', ?, ?)")
    .run(id, sessionId, membershipId, enrolmentId, personId, status, NOW, NOW);
}

function material(db: DatabaseSync, id: string, sessionId: string, batchId: string, branchId: string, trainerId: string, filename: string, deletedAt: string | null) {
  db.prepare("insert into session_materials values (?, 'org_samyak', ?, ?, ?, ?, 'notes', 'Notes', ?, 'application/pdf', ?, ?, ?, ?, 'acct_trainer', ?)")
    .run(id, branchId, sessionId, batchId, trainerId, `key_${id}`, PDF_BYTES.byteLength, filename, NOW, NOW, deletedAt);
}
