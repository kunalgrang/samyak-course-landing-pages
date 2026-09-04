/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { TrainerProfileChoice } from "./auth-store";
import type { AppContext } from "./http";
import {
  getTrainerBatchDetail,
  getTrainerSessionDetail,
  listTrainerSessions,
  listTrainerBatches,
  openOrCreateTrainerSession,
  saveTrainerSession,
} from "./trainer-attendance";

const NOW = "2026-09-04T04:30:00.000Z";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: SqliteD1,
    private readonly sql: string,
  ) {}

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

  async batch<T extends { run: () => Promise<unknown> }>(statements: T[]) {
    this.database.exec("begin");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("commit");
      return results;
    } catch (error) {
      this.database.exec("rollback");
      throw error;
    }
  }
}

describe("trainer attendance service", () => {
  it("lists only assigned active batches and hides sensitive roster data", async () => {
    const { c, trainer } = setup();
    const batches = await listTrainerBatches(c, trainer);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ id: "batch_morning", name: "Data Analytics Morning", activeStudents: 2 });

    const detail = await getTrainerBatchDetail(c, trainer, "batch_morning");
    expect(detail?.roster.map((item) => item.studentName)).toEqual(["Asha Student", "Late Joiner"]);
    expect(JSON.stringify(detail?.roster)).not.toContain("9876543210");
    expect(await getTrainerBatchDetail(c, trainer, "batch_other_trainer")).toBeNull();
  });

  it("creates today's session idempotently and snapshots batch time", async () => {
    const { c, trainer } = setup();
    const first = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-04");
    const second = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-04");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected session");
    expect(second.session.session.id).toBe(first.session.session.id);
    expect(first.session.session.scheduledStartTime).toBe("10:00");
    expect(first.session.session.scheduledEndTime).toBe("12:00");
    expect(count(c, "class_sessions")).toBe(1);
  });

  it("uses membership dates for attendance roster and preserves transfer history", async () => {
    const { c, trainer } = setup();
    const past = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-01");
    if (!past.ok) throw new Error("expected session");
    expect(past.session.roster.map((item) => item.studentName)).toEqual(["Asha Student", "Transferred Out"]);

    const today = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-04");
    if (!today.ok) throw new Error("expected session");
    expect(today.session.roster.map((item) => item.studentName)).toEqual(["Asha Student", "Late Joiner"]);
  });

  it("requires complete valid attendance and rejects forged students", async () => {
    const { c, trainer } = setup();
    const opened = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-04");
    if (!opened.ok) throw new Error("expected session");
    const [first] = opened.session.roster;

    await expect(saveTrainerSession(c, trainer, opened.session.session.id, {
      expectedVersion: opened.session.session.version,
      teachingNote: "Power BI relationships",
      attendance: [{ batchMembershipId: first.batchMembershipId, status: "present" }],
    })).resolves.toMatchObject({ ok: false, code: "attendance_roster_mismatch" });

    await expect(saveTrainerSession(c, trainer, opened.session.session.id, {
      expectedVersion: opened.session.session.version,
      teachingNote: "Power BI relationships",
      attendance: [
        ...opened.session.roster.map((item) => ({ batchMembershipId: item.batchMembershipId, status: "present" as const })),
        { batchMembershipId: "batchmem_other_trainer", status: "absent" },
      ],
    })).resolves.toMatchObject({ ok: false, code: "attendance_roster_mismatch" });
  });

  it("saves present and absent idempotently, audits once per save, and rejects stale overwrites", async () => {
    const { c, trainer } = setup();
    const opened = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-04");
    if (!opened.ok) throw new Error("expected session");
    const saved = await saveTrainerSession(c, trainer, opened.session.session.id, {
      expectedVersion: opened.session.session.version,
      teachingNote: "Power BI relationships and basic DAX measures.",
      attendance: opened.session.roster.map((item, index) => ({ batchMembershipId: item.batchMembershipId, status: index === 0 ? "present" : "absent" })),
    });
    expect(saved).toMatchObject({ ok: true });
    expect(count(c, "attendance_records")).toBe(2);
    expect(count(c, "audit_logs where action = 'trainer_session_saved'")).toBe(1);
    if (!saved.ok) throw new Error("expected save");

    await expect(saveTrainerSession(c, trainer, opened.session.session.id, {
      expectedVersion: opened.session.session.version,
      teachingNote: "Stale overwrite",
      attendance: opened.session.roster.map((item) => ({ batchMembershipId: item.batchMembershipId, status: "present" })),
    })).resolves.toMatchObject({ ok: false, code: "stale_session" });

    const detail = await getTrainerSessionDetail(c, trainer, opened.session.session.id);
    expect(detail?.session).toMatchObject({ status: "completed", version: 2 });
    expect(detail?.roster.map((item) => item.attendanceStatus)).toEqual(["present", "absent"]);
  });

  it("lists only the active trainer's class history with attendance counts", async () => {
    const { c, trainer, otherTrainer } = setup();
    const opened = await openOrCreateTrainerSession(c, trainer, "batch_morning", "2026-09-04");
    const otherOpened = await openOrCreateTrainerSession(c, otherTrainer, "batch_other_trainer", "2026-09-04");
    if (!opened.ok || !otherOpened.ok) throw new Error("expected sessions");
    await saveTrainerSession(c, trainer, opened.session.session.id, {
      expectedVersion: opened.session.session.version,
      teachingNote: "Power BI relationships and dashboard review.",
      attendance: opened.session.roster.map((item, index) => ({ batchMembershipId: item.batchMembershipId, status: index === 0 ? "present" : "absent" })),
    });

    const sessions = await listTrainerSessions(c, trainer);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: opened.session.session.id,
      batchName: "Data Analytics Morning",
      courseLabel: "Excel / SQL",
      presentCount: 1,
      absentCount: 1,
      teachingNoteExcerpt: "Power BI relationships and dashboard review.",
    });
    expect(JSON.stringify(sessions)).not.toContain(otherOpened.session.session.id);
  });

  it("blocks other trainers and inactive batches", async () => {
    const { c, trainer, otherTrainer } = setup();
    await expect(openOrCreateTrainerSession(c, trainer, "batch_inactive", "2026-09-04")).resolves.toMatchObject({ ok: false, code: "batch_not_active" });
    await expect(openOrCreateTrainerSession(c, otherTrainer, "batch_morning", "2026-09-04")).resolves.toMatchObject({ ok: false, code: "batch_not_found" });
  });
});

function setup() {
  const d1 = new SqliteD1();
  installSchema(d1.database);
  seed(d1.database);
  const c = { env: { DB: d1 } } as unknown as AppContext & { env: { DB: SqliteD1 } };
  const activeTrainer: TrainerProfileChoice = { personId: "person_trainer", publicName: "Trainer", branchId: "branch_sion", branchName: "Sion", roles: ["trainer"] };
  const otherActiveTrainer: TrainerProfileChoice = { personId: "person_other_trainer", publicName: "Other Trainer", branchId: "branch_sion", branchName: "Sion", roles: ["trainer"] };
  return {
    c,
    trainer: { loginAccountId: "acct_trainer", activeTrainer },
    otherTrainer: { loginAccountId: "acct_other_trainer", activeTrainer: otherActiveTrainer },
  };
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table organisations (id text primary key, name text, slug text, status text, created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_hash text, mobile_last_four text, login_enabled integer, status text, created_at text, updated_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, created_at text);
    create table courses (id text primary key, organisation_id text, code text, name text, duration_label text, status text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, current_status text, portal_status text, created_at text, updated_at text);
    create table enrolments (id text primary key, student_id text, branch_id text, course_id text, enrolment_number text, joining_date text, status text, created_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, old_values_json text, new_values_json text, metadata_json text, ip_hash text, created_at text);
    create table batches (
      id text primary key, organisation_id text not null, branch_id text not null, course_id text not null, name text not null,
      primary_trainer_person_id text, days_of_week_json text not null, start_time text not null, end_time text not null,
      capacity integer, status text not null default 'active', created_by_login_account_id text, created_at text not null, updated_at text not null
    );
    create table batch_courses (
      batch_id text not null, course_id text not null, organisation_id text not null, created_at text not null, created_by text,
      primary key (batch_id, course_id)
    );
    create table batch_memberships (
      id text primary key, organisation_id text not null, batch_id text not null, enrolment_id text not null,
      joined_at text not null, left_at text, status text not null default 'active', assigned_by_login_account_id text, created_at text not null
    );
    create table class_sessions (
      id text primary key, organisation_id text not null, branch_id text not null, batch_id text not null, trainer_person_id text not null,
      session_date text not null, scheduled_start_time text, scheduled_end_time text, actual_started_at text, actual_ended_at text,
      teaching_note text not null default '', status text not null default 'open', version integer not null default 1,
      created_at text not null, updated_at text not null, created_by_actor_id text
    );
    create unique index class_sessions_batch_date_start_unique on class_sessions (organisation_id, batch_id, session_date, scheduled_start_time);
    create table attendance_records (
      id text primary key, organisation_id text not null, class_session_id text not null, batch_membership_id text not null,
      enrolment_id text not null, person_id text not null, status text not null, marked_by_actor_id text, marked_at text not null, updated_at text not null
    );
    create unique index attendance_records_session_membership_unique on attendance_records (class_session_id, batch_membership_id);
  `);
}

function seed(db: DatabaseSync) {
  db.prepare("insert into organisations values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into roles values ('role_trainer', 'org_samyak', 'trainer', 'Trainer', ?)").run(NOW);
  db.prepare("insert into login_accounts values ('acct_trainer', 'org_samyak', 'hash', 'hash', '3210', 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_other_trainer', 'org_samyak', 'hash2', 'hash2', '0000', 1, 'active', ?, ?)").run(NOW, NOW);
  for (const [id, name] of [["person_trainer", "Trainer User"], ["person_other_trainer", "Other Trainer"], ["person_asha", "Asha Student"], ["person_late", "Late Joiner"], ["person_transfer", "Transferred Out"], ["person_other", "Other Student"]] as const) {
    db.prepare("insert into people values (?, 'org_samyak', 'branch_sion', ?, ?, null, 'active', ?, ?)").run(id, name, name, NOW, NOW);
  }
  db.prepare("insert into person_roles values ('person_trainer', 'role_trainer', 'branch_sion', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into person_roles values ('person_other_trainer', 'role_trainer', 'branch_sion', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into courses values ('course_excel', 'org_samyak', 'EXCEL', 'Excel', '1 month', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_sql', 'org_samyak', 'SQL', 'SQL', '1 month', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batches values ('batch_morning', 'org_samyak', 'branch_sion', 'course_excel', 'Data Analytics Morning', 'person_trainer', '[\"mon\",\"wed\",\"fri\"]', '10:00', '12:00', null, 'active', 'acct_admin', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batches values ('batch_other_trainer', 'org_samyak', 'branch_sion', 'course_excel', 'Other Trainer Batch', 'person_other_trainer', '[\"mon\"]', '13:00', '15:00', null, 'active', 'acct_admin', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batches values ('batch_inactive', 'org_samyak', 'branch_sion', 'course_excel', 'Inactive Batch', 'person_trainer', '[\"mon\"]', '16:00', '18:00', null, 'inactive', 'acct_admin', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batch_courses values ('batch_morning', 'course_excel', 'org_samyak', ?, 'acct_admin')").run(NOW);
  db.prepare("insert into batch_courses values ('batch_morning', 'course_sql', 'org_samyak', ?, 'acct_admin')").run(NOW);
  db.prepare("insert into batch_courses values ('batch_other_trainer', 'course_excel', 'org_samyak', ?, 'acct_admin')").run(NOW);
  db.prepare("insert into batch_courses values ('batch_inactive', 'course_excel', 'org_samyak', ?, 'acct_admin')").run(NOW);

  for (const [id, personId, number] of [["student_asha", "person_asha", "SYK-001"], ["student_late", "person_late", "SYK-002"], ["student_transfer", "person_transfer", "SYK-003"], ["student_other", "person_other", "SYK-004"]] as const) {
    db.prepare("insert into students values (?, 'org_samyak', ?, 'branch_sion', ?, 'active', 'not_invited', ?, ?)").run(id, personId, number, NOW, NOW);
  }
  db.prepare("insert into enrolments values ('enrol_asha', 'student_asha', 'branch_sion', 'course_excel', 'ENR-001', '2026-08-20', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_late', 'student_late', 'branch_sion', 'course_sql', 'ENR-002', '2026-09-03', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_transfer', 'student_transfer', 'branch_sion', 'course_excel', 'ENR-003', '2026-08-20', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_other', 'student_other', 'branch_sion', 'course_excel', 'ENR-004', '2026-08-20', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batch_memberships values ('batchmem_asha', 'org_samyak', 'batch_morning', 'enrol_asha', '2026-08-20T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('batchmem_late', 'org_samyak', 'batch_morning', 'enrol_late', '2026-09-03T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('batchmem_transfer', 'org_samyak', 'batch_morning', 'enrol_transfer', '2026-08-20T04:30:00.000Z', '2026-09-02T04:30:00.000Z', 'transferred', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('batchmem_other_trainer', 'org_samyak', 'batch_other_trainer', 'enrol_other', '2026-08-20T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
}

function count(c: AppContext & { env: { DB: SqliteD1 } }, tableExpression: string) {
  const row = c.env.DB.database.prepare(`select count(*) as count from ${tableExpression}`).get() as { count: number };
  return row.count;
}
