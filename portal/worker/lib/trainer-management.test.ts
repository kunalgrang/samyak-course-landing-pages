/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { lookupTrainersByMobile, mobileHash } from "./auth-store";
import { listTrainers as listBatchSelectorTrainers } from "./batch-management";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";
import {
  createManagedTrainer,
  findTrainerPersonCandidates,
  getManagedTrainer,
  listManagedTrainers,
  setManagedTrainerStatus,
  updateManagedTrainer,
} from "./trainer-management";
import type { TrainerCandidate as ManagedTrainerCandidate } from "./trainer-management";

const NOW = "2026-09-07T09:00:00.000Z";

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

describe("Trainer Management service", () => {
  it("creates a new Person trainer with OTP login linkage and batch selector eligibility", async () => {
    const { c, staff } = await setup();

    const created = await createManagedTrainer(c, staff, {
      fullName: "New Trainer",
      mobile: "9876543222",
      email: "TRAINER@EXAMPLE.COM",
      branchId: "branch_sion",
      status: "active",
    });

    expect(created).toMatchObject({ ok: true, createdPerson: true });
    if (!created.ok) return;
    expect(count(c, "people where id = ? and status = 'active'", created.personId)).toBe(1);
    expect(count(c, "person_contacts where person_id = ? and contact_type = 'mobile' and is_primary = 1", created.personId)).toBe(1);
    expect(count(c, "login_account_people where person_id = ? and is_available = 1", created.personId)).toBe(1);
    expect(count(c, "person_roles where person_id = ? and status = 'active'", created.personId)).toBe(1);

    const listed = await listManagedTrainers(c, staff, { q: "New Trainer" });
    expect(listed.ok && listed.trainers[0]).toMatchObject({ personId: created.personId, trainerStatus: "active", mobileDisplay: "******3222", email: "trainer@example.com" });

    const selector = await listBatchSelectorTrainers(c, staff, "branch_sion");
    expect(selector.ok && selector.trainers).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.personId, name: "New Trainer" })]));

    const loginLookup = await lookupTrainersByMobile(c, "9876543222");
    expect(loginLookup.trainers.map((trainer) => trainer.personId)).toContain(created.personId);
  });

  it("requires explicit reuse when a mobile belongs to an existing Student Person", async () => {
    const { c, staff } = await setup();

    const blocked = await createManagedTrainer(c, staff, {
      fullName: "Asha Student",
      mobile: "9876543211",
      branchId: "branch_sion",
    });

    expect(blocked).toMatchObject({ ok: false, code: "person_choice_required" });
    if (blocked.ok) return;
    const blockedWithCandidates = blocked as typeof blocked & { candidates: ManagedTrainerCandidate[] };
    expect(blockedWithCandidates.candidates[0]).toMatchObject({ personId: "person_student", studentNumber: "SYK-SION-0001" });

    const reused = await createManagedTrainer(c, staff, {
      fullName: "Asha Student",
      mobile: "9876543211",
      branchId: "branch_sion",
      existingPersonId: "person_student",
    });
    expect(reused).toMatchObject({ ok: true, reusedPerson: true });
    expect(count(c, "people where full_name = 'Asha Student'")).toBe(1);
    expect(count(c, "students where person_id = 'person_student'")).toBe(1);
    expect(count(c, "person_roles where person_id = 'person_student' and status = 'active'")).toBe(1);
  });

  it("keeps Student identity details aligned when editing a reused Trainer Person", async () => {
    const { c, staff } = await setup();
    await createManagedTrainer(c, staff, {
      fullName: "Asha Student",
      mobile: "9876543211",
      branchId: "branch_sion",
      existingPersonId: "person_student",
    });

    const updated = await updateManagedTrainer(c, staff, "person_student", { fullName: "Asha Trainer", email: "" });

    expect(updated).toMatchObject({ ok: true });
    expect(row(c, "select full_name, public_name from people where id = 'person_student'")).toMatchObject({ full_name: "Asha Trainer", public_name: "Asha Trainer" });
    expect(row(c, "select official_full_name from person_identity_details where person_id = 'person_student'")).toMatchObject({ official_full_name: "Asha Trainer" });
  });

  it("encrypts reused contact secrets with the existing contact id context", async () => {
    const { c, staff } = await setup();
    c.env.DB.database
      .prepare("insert into person_contacts values ('contact_existing_email', 'person_student', 'email', 'legacy@example.com', 'legacy@example.com', null, 1, 0, ?, ?)")
      .run(NOW, NOW);

    const reused = await createManagedTrainer(c, staff, {
      fullName: "Asha Student",
      mobile: "9876543211",
      email: "legacy@example.com",
      branchId: "branch_sion",
      existingPersonId: "person_student",
    });
    const detail = await getManagedTrainer(c, staff, "person_student");

    expect(reused).toMatchObject({ ok: true, reusedPerson: true });
    expect(count(c, "person_contact_secrets where contact_id = 'contact_existing_email'")).toBe(1);
    expect(detail.ok && detail.trainer.email).toBe("legacy@example.com");
  });

  it("keeps shared mobile Persons separate unless the operator selects one or chooses separate Person", async () => {
    const { c, staff } = await setup();

    await seedMobile(c, "person_shared", "9876543211");
    const candidates = await findTrainerPersonCandidates(c, staff, "9876543211");
    expect(candidates.ok && candidates.candidates.map((candidate) => candidate.personId).sort()).toEqual(["person_shared", "person_student"]);

    const separate = await createManagedTrainer(c, staff, {
      fullName: "Separate Trainer",
      mobile: "9876543211",
      branchId: "branch_sion",
      createSeparatePerson: true,
    });

    expect(separate).toMatchObject({ ok: true, createdPerson: true });
    expect(count(c, "people where full_name = 'Separate Trainer'")).toBe(1);
    expect(count(c, "people where full_name = 'Asha Student'")).toBe(1);
  });

  it("deactivates only the trainer role, blocks teaching batch assignments, and reactivates cleanly", async () => {
    const { c, staff } = await setup();
    await createManagedTrainer(c, staff, {
      fullName: "New Trainer",
      mobile: "9876543222",
      branchId: "branch_sion",
    });
    const trainer = (await listManagedTrainers(c, staff, { q: "New Trainer" }));
    if (!trainer.ok) return;
    const personId = trainer.trainers[0].personId;

    seedBatch(c, personId, "active");
    const blocked = await setManagedTrainerStatus(c, staff, personId, "inactive");
    expect(blocked).toMatchObject({ ok: false, code: "active_batch_assignments" });

    c.env.DB.database.prepare("update batches set status = 'completed' where primary_trainer_person_id = ?").run(personId);
    c.env.DB.database.prepare(
      "insert into user_sessions (id, login_account_id, active_person_id, active_education_partner_id, active_subject_type, token_hash, created_at, expires_at, last_seen_at, revoked_at, ip_hash, user_agent_hash) values ('sess_1', 'acct_new', ?, null, 'trainer', 'token', ?, '2099-01-01T00:00:00.000Z', ?, null, null, null)",
    ).run(personId, NOW, NOW);
    const deactivated = await setManagedTrainerStatus(c, staff, personId, "inactive");
    expect(deactivated).toMatchObject({ ok: true });
    expect(count(c, "people where id = ? and status = 'active'", personId)).toBe(1);
    expect(count(c, "person_roles where person_id = ? and status = 'inactive'", personId)).toBe(1);
    expect((await lookupTrainersByMobile(c, "9876543222")).eligible).toBe(false);
    expect(count(c, "user_sessions where id = 'sess_1' and active_person_id is null")).toBe(1);

    const reactivated = await setManagedTrainerStatus(c, staff, personId, "active");
    expect(reactivated).toMatchObject({ ok: true });
    expect((await lookupTrainersByMobile(c, "9876543222")).eligible).toBe(true);
    expect(count(c, "person_roles where person_id = ?", personId)).toBe(1);
  });

  it("returns profile batches without blocking completed history", async () => {
    const { c, staff } = await setup();
    seedBatch(c, "person_trainer", "completed");

    const detail = await getManagedTrainer(c, staff, "person_trainer");
    expect(detail.ok && detail.trainer).toMatchObject({ personId: "person_trainer", completedBatchCount: 1 });
    expect(detail.ok && detail.batches[0]).toMatchObject({ name: "Trainer Batch", status: "completed", activeStudents: 0 });
  });
});

async function setup() {
  const d1 = new SqliteD1();
  installSchema(d1.database);
  seedBase(d1.database);
  const c = { env: { DB: d1, SESSION_PEPPER: "test-pepper" } } as unknown as AppContext & { env: { DB: SqliteD1; SESSION_PEPPER: string } };
  await seedMobile(c, "person_student", "9876543211");
  await seedMobile(c, "person_trainer", "9876543210");
  const staff: StaffContext = { loginAccountId: "acct_admin", activePersonId: "person_admin", roles: ["admin"] };
  return { c, staff };
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table organisations (id text primary key, name text, slug text, status text, created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, display_value text, last_four text, is_primary integer, is_verified integer default 0, created_at text, updated_at text, unique(person_id, contact_type, normalized_value));
    create table person_contact_details (contact_id text primary key, belongs_to text, is_whatsapp integer, valid_until text, status text, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_hash text, mobile_last_four text, login_enabled integer, status text, last_login_at text, created_at text, updated_at text, unique(organisation_id, mobile_normalized));
    create table login_account_people (login_account_id text, person_id text, access_type text, is_default integer, is_available integer, created_at text, primary key (login_account_id, person_id));
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, status text default 'active', created_at text, unique(person_id, role_id, branch_key));
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, old_values_json text, new_values_json text, metadata_json text, ip_hash text, created_at text);
    create table courses (id text primary key, organisation_id text, code text, name text);
    create table batches (id text primary key, organisation_id text, branch_id text, course_id text, name text, primary_trainer_person_id text, days_of_week_json text, start_time text, end_time text, capacity integer, status text, created_by_login_account_id text, created_at text, updated_at text);
    create table batch_courses (batch_id text, course_id text, organisation_id text, created_at text, created_by text, primary key (batch_id, course_id));
    create table batch_memberships (id text primary key, organisation_id text, batch_id text, enrolment_id text, joined_at text, left_at text, status text, assigned_by_login_account_id text, created_at text);
    create table user_sessions (id text primary key, login_account_id text, active_person_id text, active_education_partner_id text, active_subject_type text, token_hash text, created_at text, expires_at text, last_seen_at text, revoked_at text, ip_hash text, user_agent_hash text);
  `);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into roles values ('role_admin', 'org_samyak', 'admin', 'Admin', ?), ('role_trainer', 'org_samyak', 'trainer', 'Trainer', ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_admin', 'org_samyak', 'branch_sion', 'Admin User', 'Admin', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_student', 'org_samyak', 'branch_sion', 'Asha Student', 'Asha Student', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_shared', 'org_samyak', 'branch_sion', 'Shared Person', 'Shared Person', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into people values ('person_trainer', 'org_samyak', 'branch_sion', 'Existing Trainer', 'Existing Trainer', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_admin', 'org_samyak', 'admin_hash', 'admin_hash', '0000', 1, 'active', null, ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_new', 'org_samyak', 'new_hash', 'new_hash', '3222', 1, 'active', null, ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_account_roles values ('acct_admin', 'role_admin', 'branch_sion', ?)").run(NOW);
  db.prepare("insert into person_roles values ('person_trainer', 'role_trainer', 'branch_sion', 'branch_sion', 'active', ?)").run(NOW);
  db.prepare("insert into students values ('student_one', 'org_samyak', 'person_student', 'branch_sion', 'SYK-SION-0001', 1, '2026-09-07', 'active', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into person_identity_details values ('person_student', 'Asha Student', '2000-01-01', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_fsd', 'org_samyak', 'FSD', 'Full Stack')").run();
}

async function seedMobile(c: AppContext & { env: { DB: SqliteD1; SESSION_PEPPER: string } }, personId: string, mobile: string) {
  const hash = await mobileHash(c, mobile);
  const contactId = `contact_${personId}_${mobile.slice(-4)}`;
  c.env.DB.database.prepare("insert or ignore into person_contacts values (?, ?, 'mobile', ?, null, ?, 1, 0, ?, ?)").run(contactId, personId, hash, mobile.slice(-4), NOW, NOW);
  c.env.DB.database.prepare("insert or ignore into person_contact_details values (?, 'office', 1, null, 'active', ?, ?)").run(contactId, NOW, NOW);
}

function seedBatch(c: AppContext & { env: { DB: SqliteD1 } }, trainerPersonId: string, status: string) {
  c.env.DB.database.prepare("insert into batches values ('batch_one', 'org_samyak', 'branch_sion', 'course_fsd', 'Trainer Batch', ?, '[\"mon\",\"wed\"]', '08:00', '10:00', null, ?, 'acct_admin', ?, ?)").run(trainerPersonId, status, NOW, NOW);
  c.env.DB.database.prepare("insert into batch_courses values ('batch_one', 'course_fsd', 'org_samyak', ?, 'acct_admin')").run(NOW);
}

function count(c: AppContext & { env: { DB: SqliteD1 } }, where: string, ...values: unknown[]) {
  const row = c.env.DB.database.prepare(`select count(*) as count from ${where}`).get(...(values as any[])) as { count: number };
  return row.count;
}

function row(c: AppContext & { env: { DB: SqliteD1 } }, sql: string, ...values: unknown[]) {
  return c.env.DB.database.prepare(sql).get(...(values as any[]));
}
