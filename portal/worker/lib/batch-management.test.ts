/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";
import {
  assignBatchOnAdmissionConfirmation,
  assignEnrolmentToBatch,
  createBatch,
  getBatchDetail,
  listAdmissionEligibleBatches,
  normalizeDaysOfWeek,
  removeBatchMembership,
  transferBatchMembership,
  updateBatch,
  validateAdmissionBatchSelection,
  validateBatchTimes,
} from "./batch-management";

const NOW = "2026-08-28T09:00:00.000Z";

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
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

describe("Batch Management V1 service", () => {
  it("normalizes weekdays and validates local HH:MM timings", () => {
    expect(normalizeDaysOfWeek(["fri", "mon", "mon", "wed"])).toEqual(["mon", "wed", "fri"]);
    expect(() => normalizeDaysOfWeek(["mon", "funday"])).toThrow("valid class days");
    expect(() => validateBatchTimes("09:00", "09:00")).toThrow("End time");
    expect(() => validateBatchTimes("24:00", "25:00")).toThrow("HH:MM");
  });

  it("creates batches with active trainer eligibility and lists admission options", async () => {
    const { c, staff } = setup();
    const created = await createBatch(c, staff, {
      name: "FSD Morning",
      branchId: "branch_sion",
      courseIds: ["course_fsd"],
      trainerPersonId: "person_trainer",
      daysOfWeek: ["wed", "mon"],
      startTime: "08:00",
      endTime: "10:00",
      capacity: 1,
      status: "active",
    });
    expect(created).toMatchObject({ ok: true });

    const options = await listAdmissionEligibleBatches(c, staff, "branch_sion", "course_fsd");
    expect(options.ok && options.batches[0]).toMatchObject({
      name: "FSD Morning",
      daysOfWeek: ["mon", "wed"],
      activeStudents: 0,
    });
  });

  it("creates mixed-course batches and enforces explicit course eligibility", async () => {
    const { c, staff } = setup();
    const created = await createBatch(c, staff, {
      name: "Digital Marketing Evening",
      branchId: "branch_sion",
      courseIds: ["course_fsd", "course_dm_ai", "course_dm_wp", "course_dm_ai"],
      trainerPersonId: "person_trainer",
      daysOfWeek: ["mon", "wed", "fri"],
      startTime: "18:00",
      endTime: "20:00",
      capacity: null,
      status: "active",
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;

    const mappings = c.env.DB.database.prepare("select course_id from batch_courses where batch_id = ? order by course_id").all(created.batchId) as any[];
    expect(mappings.map((row) => row.course_id)).toEqual(["course_dm_ai", "course_dm_wp", "course_fsd"]);

    await expect(assignEnrolmentToBatch(c, staff, created.batchId, "enrol_one")).resolves.toMatchObject({ ok: true });
    await expect(assignEnrolmentToBatch(c, staff, created.batchId, "enrol_dm_ai")).resolves.toMatchObject({ ok: true });
    await expect(assignEnrolmentToBatch(c, staff, created.batchId, "enrol_unrelated")).resolves.toMatchObject({ ok: false, code: "batch_course_not_eligible" });

    const detail = await getBatchDetail(c, staff, created.batchId);
    expect(detail.ok && detail.batch.courses.map((course) => course.id)).toEqual(["course_fsd", "course_dm_ai", "course_dm_wp"]);
    expect(detail.ok && detail.roster.map((row) => row.course_name).sort()).toEqual(["Digital Marketing with AI", "Full Stack"]);
  });

  it("uses batch course mappings for admission options and transfer targets", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd", ["course_fsd", "course_dm_ai"]);
    await seedBatch(c, "batch_two", "branch_sion", "course_fsd", ["course_fsd", "course_dm_ai"]);
    await seedBatch(c, "batch_unrelated", "branch_sion", "course_other", ["course_other"]);

    const fsdOptions = await listAdmissionEligibleBatches(c, staff, "branch_sion", "course_fsd");
    const aiOptions = await listAdmissionEligibleBatches(c, staff, "branch_sion", "course_dm_ai");
    const unrelatedOptions = await listAdmissionEligibleBatches(c, staff, "branch_sion", "course_unrelated");
    expect(fsdOptions.ok && fsdOptions.batches.map((batch) => batch.id)).toEqual(["batch_one", "batch_two"]);
    expect(aiOptions.ok && aiOptions.batches.map((batch) => batch.id)).toEqual(["batch_one", "batch_two"]);
    expect(unrelatedOptions.ok && unrelatedOptions.batches).toEqual([]);

    const assigned = await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_dm_ai");
    expect(assigned).toMatchObject({ ok: true });
    if (!assigned.ok) return;
    await expect(transferBatchMembership(c, staff, "batch_one", assigned.membershipId, "batch_two")).resolves.toMatchObject({ ok: true });
    await expect(validateAdmissionBatchSelection(c, staff, "branch_sion", "course_dm_ai", "batch_one")).resolves.toBeNull();
    await expect(validateAdmissionBatchSelection(c, staff, "branch_sion", "course_unrelated", "batch_one")).resolves.toHaveProperty("course.batchId");
  });

  it("requires at least one course, rejects cross-org courses, and locks course mappings with history", async () => {
    const { c, staff } = setup();
    await expect(createBatch(c, staff, {
      name: "No Course",
      branchId: "branch_sion",
      courseIds: [],
      trainerPersonId: null,
      daysOfWeek: ["mon"],
      startTime: "08:00",
      endTime: "10:00",
      capacity: null,
      status: "active",
    })).resolves.toMatchObject({ ok: false, code: "invalid_batch" });
    await expect(createBatch(c, staff, {
      name: "Cross Org",
      branchId: "branch_sion",
      courseIds: ["course_foreign"],
      trainerPersonId: null,
      daysOfWeek: ["mon"],
      startTime: "08:00",
      endTime: "10:00",
      capacity: null,
      status: "active",
    })).resolves.toMatchObject({ ok: false, code: "invalid_batch" });

    await seedBatch(c, "batch_one", "branch_sion", "course_fsd", ["course_fsd", "course_dm_ai"]);
    await expect(updateBatch(c, staff, "batch_one", { courseIds: ["course_fsd", "course_dm_ai", "course_dm_wp"] })).resolves.toMatchObject({ ok: true });
    await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_dm_ai");
    await expect(updateBatch(c, staff, "batch_one", { courseIds: ["course_fsd", "course_dm_wp"] })).resolves.toMatchObject({ ok: false, code: "batch_course_history_locked" });
  });

  it("rejects inactive trainers, branch mismatch and duplicate active memberships", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");

    const inactiveTrainer = await createBatch(c, staff, {
      name: "Bad Trainer",
      branchId: "branch_sion",
      courseId: "course_fsd",
      trainerPersonId: "person_inactive_trainer",
      daysOfWeek: ["mon"],
      startTime: "08:00",
      endTime: "10:00",
      capacity: null,
      status: "active",
    });
    expect(inactiveTrainer).toMatchObject({ ok: false, code: "invalid_batch" });

    const assigned = await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one");
    expect(assigned).toMatchObject({ ok: true });
    expect(await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one")).toMatchObject({ ok: false, code: "already_assigned" });
    expect(await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_other_branch")).toMatchObject({ ok: false, code: "batch_mismatch" });
  });

  it("preserves membership history across transfer and remove", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");
    await seedBatch(c, "batch_two", "branch_sion", "course_fsd");
    const assigned = await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one");
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;

    const transferred = await transferBatchMembership(c, staff, "batch_one", assigned.membershipId, "batch_two");
    expect(transferred).toMatchObject({ ok: true });
    const rowsAfterTransfer = c.env.DB.database.prepare("select batch_id, status, left_at from batch_memberships order by created_at").all() as any[];
    expect(rowsAfterTransfer.map((row) => row.status)).toEqual(["transferred", "active"]);
    expect(rowsAfterTransfer[0].left_at).toBeTruthy();

    if (!transferred.ok) return;
    await removeBatchMembership(c, staff, transferred.membershipId);
    const activeCount = c.env.DB.database.prepare("select count(*) as count from batch_memberships where status = 'active'").get() as any;
    expect(activeCount.count).toBe(0);
  });

  it("rejects transfer when membership does not belong to the source batch path", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");
    await seedBatch(c, "batch_two", "branch_sion", "course_fsd");
    const assigned = await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one");
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;

    await expect(transferBatchMembership(c, staff, "batch_two", assigned.membershipId, "batch_two")).resolves.toMatchObject({ ok: false, code: "membership_not_found" });
    const row = c.env.DB.database.prepare("select status, left_at from batch_memberships where id = ?").get(assigned.membershipId) as any;
    expect(row).toMatchObject({ status: "active", left_at: null });
  });

  it("enforces the active membership invariant at the database layer", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");
    await seedBatch(c, "batch_two", "branch_sion", "course_fsd");
    await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one");

    expect(() => {
      c.env.DB.database.prepare(
        "insert into batch_memberships (id, organisation_id, batch_id, enrolment_id, joined_at, status, assigned_by_login_account_id, created_at) values ('forced_second', 'org_samyak', 'batch_two', 'enrol_one', ?, 'active', 'acct_admin', ?)",
      ).run(NOW, NOW);
    }).toThrow();

    c.env.DB.database.prepare("update batch_memberships set status = 'removed', left_at = ? where enrolment_id = 'enrol_one'").run(NOW);
    c.env.DB.database.prepare(
      "insert into batch_memberships (id, organisation_id, batch_id, enrolment_id, joined_at, status, assigned_by_login_account_id, created_at) values ('after_close', 'org_samyak', 'batch_two', 'enrol_one', ?, 'active', 'acct_admin', ?)",
    ).run(NOW, NOW);
    const active = c.env.DB.database.prepare("select count(*) as count from batch_memberships where enrolment_id = 'enrol_one' and status = 'active'").get() as any;
    expect(active.count).toBe(1);
  });

  it("locks batch branch and mapped courses once membership history exists while allowing trainer/status changes", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");
    await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one");

    await expect(updateBatch(c, staff, "batch_one", { courseId: "course_other" })).resolves.toMatchObject({ ok: false, code: "batch_course_history_locked" });
    await expect(updateBatch(c, staff, "batch_one", { branchId: "branch_dadar" })).resolves.toMatchObject({ ok: false, code: "batch_identity_locked" });
    await expect(updateBatch(c, staff, "batch_one", { trainerPersonId: null, status: "inactive" })).resolves.toMatchObject({ ok: true });
  });

  it("blocks incoming assignments to inactive or completed batches but permits transfer out and removal", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");
    await seedBatch(c, "batch_two", "branch_sion", "course_fsd");
    const assigned = await assignEnrolmentToBatch(c, staff, "batch_one", "enrol_one");
    expect(assigned.ok).toBe(true);
    await updateBatch(c, staff, "batch_one", { status: "inactive" });

    await expect(assignEnrolmentToBatch(c, staff, "batch_one", "enrol_second")).resolves.toMatchObject({ ok: false, code: "inactive_batch" });
    if (!assigned.ok) return;
    const transferred = await transferBatchMembership(c, staff, "batch_one", assigned.membershipId, "batch_two");
    expect(transferred).toMatchObject({ ok: true });

    await updateBatch(c, staff, "batch_two", { status: "completed" });
    if (!transferred.ok) return;
    await expect(removeBatchMembership(c, staff, transferred.membershipId)).resolves.toMatchObject({ ok: true });
  });

  it("assigns admission batch idempotently and keeps assign later as a no-op", async () => {
    const { c, staff } = setup();
    await seedBatch(c, "batch_one", "branch_sion", "course_fsd");

    expect(await validateAdmissionBatchSelection(c, staff, "branch_sion", "course_fsd", "batch_one")).toBeNull();
    expect(await validateAdmissionBatchSelection(c, staff, "branch_sion", "course_other", "batch_one")).toHaveProperty("course.batchId");
    expect(await assignBatchOnAdmissionConfirmation(c, staff, { branchId: "branch_sion", courseId: "course_fsd", batchId: null }, "enrol_one", NOW)).toMatchObject({ ok: true, membershipId: null });

    const first = await assignBatchOnAdmissionConfirmation(c, staff, { branchId: "branch_sion", courseId: "course_fsd", batchId: "batch_one" }, "enrol_one", NOW);
    const second = await assignBatchOnAdmissionConfirmation(c, staff, { branchId: "branch_sion", courseId: "course_fsd", batchId: "batch_one" }, "enrol_one", NOW);
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
  });

  it("backfills existing V1 batches when migration 0025 is applied", () => {
    const db = new DatabaseSync(":memory:");
    const migrationsDir = join(process.cwd(), "migrations");
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql") && name <= "0024_batch_management_v1.sql").sort()) {
      db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    }
    db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
    db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
    db.prepare("insert into courses (id, organisation_id, code, name, duration_label, default_fee_paise, nsdc_available, status, created_at, updated_at) values ('course_fsd', 'org_samyak', 'FSD', 'Full Stack', '6 months', 5000000, 1, 'active', ?, ?)").run(NOW, NOW);
    db.prepare(
      `insert into batches
       (id, organisation_id, branch_id, course_id, name, days_of_week_json, start_time, end_time, status, created_at, updated_at)
       values ('batch_legacy', 'org_samyak', 'branch_sion', 'course_fsd', 'Legacy Batch', '["mon"]', '08:00', '10:00', 'active', ?, ?)`,
    ).run(NOW, NOW);

    db.exec(readFileSync(join(migrationsDir, "0025_batch_multi_course.sql"), "utf8"));

    const row = db.prepare("select count(*) as count from batch_courses where batch_id = 'batch_legacy' and course_id = 'course_fsd'").get() as any;
    expect(row.count).toBe(1);
  });
});

function setup() {
  const d1 = new SqliteD1();
  installSchema(d1.database);
  seedBase(d1.database);
  const c = { env: { DB: d1 } } as unknown as AppContext & { env: { DB: SqliteD1 } };
  const staff: StaffContext = { loginAccountId: "acct_admin", activePersonId: "person_admin", roles: ["admin"] };
  return { c, staff };
}

async function seedBatch(c: AppContext, id: string, branchId: string, courseId: string, courseIds = [courseId]) {
  await c.env.DB.batch([
    c.env.DB.prepare(
    `insert into batches (id, organisation_id, branch_id, course_id, name, primary_trainer_person_id, days_of_week_json, start_time, end_time, capacity, status, created_by_login_account_id, created_at, updated_at)
     values (?, 'org_samyak', ?, ?, ?, 'person_trainer', '["mon","wed"]', '08:00', '10:00', null, 'active', 'acct_admin', ?, ?)`,
    ).bind(id, branchId, courseId, id, NOW, NOW),
    ...courseIds.map((mappedCourseId) =>
      c.env.DB.prepare("insert into batch_courses (batch_id, course_id, organisation_id, created_at, created_by) values (?, ?, 'org_samyak', ?, 'acct_admin')")
        .bind(id, mappedCourseId, NOW),
    ),
  ]);
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table organisations (id text primary key, name text, slug text, status text, created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_last_four text, login_enabled integer, status text, created_at text, updated_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, created_at text);
    create table courses (id text primary key, organisation_id text, code text, name text, duration_label text, duration_months real, default_fee_paise integer, lowest_acceptable_fee_paise integer, admission_configuration_complete integer, nsdc_available integer, status text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table enrolments (id text primary key, student_id text, branch_id text, course_id text, enquiry_id text, enrolment_number text, training_mode text, batch_preference text, admission_date text, joining_date text, expected_completion_date text, actual_completion_date text, status text, nsdc_preference text, created_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, old_values_json text, new_values_json text, metadata_json text, ip_hash text, created_at text);
    create table batches (
      id text primary key, organisation_id text not null, branch_id text not null, course_id text not null, name text not null,
      primary_trainer_person_id text, days_of_week_json text not null, start_time text not null, end_time text not null,
      capacity integer, status text not null default 'active', created_by_login_account_id text, created_at text not null, updated_at text not null
    );
    create table batch_memberships (
      id text primary key, organisation_id text not null, batch_id text not null, enrolment_id text not null,
      joined_at text not null, left_at text, status text not null default 'active', assigned_by_login_account_id text, created_at text not null
    );
    create table batch_courses (
      batch_id text not null, course_id text not null, organisation_id text not null, created_at text not null, created_by text,
      primary key (batch_id, course_id)
    );
    create unique index batch_memberships_one_active_enrolment on batch_memberships (enrolment_id) where status = 'active' and left_at is null;
  `);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches values ('branch_dadar', 'org_samyak', 'Dadar', 'DDR', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into roles values ('role_admin', 'org_samyak', 'admin', 'Admin', ?), ('role_trainer', 'org_samyak', 'trainer', 'Trainer', ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_admin', 'org_samyak', 'branch_sion', 'Admin User', 'Admin', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_trainer', 'org_samyak', 'branch_sion', 'Trainer User', 'Trainer', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_inactive_trainer', 'org_samyak', 'branch_sion', 'Inactive Trainer', 'Inactive', null, 'inactive', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_student', 'org_samyak', 'branch_sion', 'Asha Student', 'Asha', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_second_student', 'org_samyak', 'branch_sion', 'Second Student', 'Second', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_other_student', 'org_samyak', 'branch_dadar', 'Dadar Student', 'Dadar Student', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_admin', 'org_samyak', '+919876543210', '3210', 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_account_roles values ('acct_admin', 'role_admin', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into person_roles values ('person_trainer', 'role_trainer', 'branch_sion', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into person_roles values ('person_inactive_trainer', 'role_trainer', 'branch_sion', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into courses values ('course_fsd', 'org_samyak', 'FSD', 'Full Stack', '6 months', 6, 5000000, 4000000, 1, 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_dm_ai', 'org_samyak', 'DMAI', 'Digital Marketing with AI', '4 months', 4, 5000000, 4000000, 1, 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_dm_wp', 'org_samyak', 'DMWP', 'Digital Marketing with AI & WordPress', '4 months', 4, 5000000, 4000000, 1, 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_unrelated', 'org_samyak', 'TLY', 'Tally', '3 months', 3, 3000000, 2500000, 1, 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_other', 'org_samyak', 'DS', 'Data Science', '6 months', 6, 5000000, 4000000, 1, 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_foreign', 'org_other', 'FO', 'Foreign', '1 month', 1, 1000000, 1000000, 1, 1, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into students values ('student_one', 'org_samyak', 'person_student', 'branch_sion', 'SYK-SION-0001', 1, '2026-08-28', 'active', 'not_invited', ?, ?)").run(NOW, NOW);
  db.prepare("insert into students values ('student_second', 'org_samyak', 'person_second_student', 'branch_sion', 'SYK-SION-0002', 2, '2026-08-28', 'active', 'not_invited', ?, ?)").run(NOW, NOW);
  db.prepare("insert into students values ('student_other_branch', 'org_samyak', 'person_other_student', 'branch_dadar', 'SYK-DDR-0001', 1, '2026-08-28', 'active', 'not_invited', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_one', 'student_one', 'branch_sion', 'course_fsd', 'enq_one', 'ENR-SION-2026-0001', 'classroom', null, '2026-08-28', '2026-08-28', null, null, 'confirmed', 'no', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_second', 'student_second', 'branch_sion', 'course_fsd', 'enq_second', 'ENR-SION-2026-0002', 'classroom', null, '2026-08-28', '2026-08-28', null, null, 'confirmed', 'no', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_dm_ai', 'student_second', 'branch_sion', 'course_dm_ai', 'enq_dm_ai', 'ENR-SION-2026-0003', 'classroom', null, '2026-08-28', '2026-08-28', null, null, 'confirmed', 'no', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_unrelated', 'student_second', 'branch_sion', 'course_unrelated', 'enq_unrelated', 'ENR-SION-2026-0004', 'classroom', null, '2026-08-28', '2026-08-28', null, null, 'confirmed', 'no', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_other_branch', 'student_other_branch', 'branch_dadar', 'course_fsd', 'enq_two', 'ENR-DDR-2026-0001', 'classroom', null, '2026-08-28', '2026-08-28', null, null, 'confirmed', 'no', ?, ?)").run(NOW, NOW);
}
