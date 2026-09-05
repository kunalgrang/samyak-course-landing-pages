/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TrainerProfileChoice } from "./auth-store";
import type { AppContext } from "./http";
import {
  MAX_ACTIVE_MATERIALS_PER_SESSION,
  deleteTrainerSessionMaterial,
  getStudentLearningEnrolment,
  getStudentMaterialContent,
  getTrainerMaterialContent,
  listStudentLearning,
  listTrainerSessionMaterials,
  materialUploadSchema,
  uploadTrainerSessionMaterial,
} from "./session-materials";

const NOW = "2026-09-05T04:30:00.000Z";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsession material");

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

class MemoryR2 {
  readonly objects = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  failPut = false;
  failDelete = false;

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string) {
    if (this.failPut) throw new Error("put failed");
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    this.objects.set(key, bytes);
  }

  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      body: new Response(bytes).body,
      size: bytes.byteLength,
      httpMetadata: { contentType: "application/pdf" },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    };
  }

  async delete(key: string) {
    if (this.failDelete) throw new Error("delete failed");
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

describe("session materials and student learning", () => {
  it("replays migrations through 0028 with session material constraints and indexes", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrationsThrough0028(db);

    const columns = db.prepare("select name from pragma_table_info('session_materials') order by cid").all().map((row) => (row as { name: string }).name);
    expect(columns).toEqual([
      "id",
      "organisation_id",
      "branch_id",
      "class_session_id",
      "batch_id",
      "trainer_person_id",
      "material_type",
      "title",
      "r2_object_key",
      "mime_type",
      "size_bytes",
      "original_filename",
      "created_at",
      "updated_at",
      "created_by_actor_id",
      "deleted_at",
    ]);
    const indexes = new Set(db.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'session_materials'").all().map((row) => (row as { name: string }).name));
    expect(indexes.has("session_materials_r2_object_key_unique")).toBe(true);
    expect(indexes.has("session_materials_class_session_idx")).toBe(true);
    expect(indexes.has("session_materials_org_session_idx")).toBe(true);
    expect(indexes.has("session_materials_org_trainer_created_idx")).toBe(true);

    expect(() => db.exec("insert into session_materials (id, organisation_id, branch_id, class_session_id, batch_id, trainer_person_id, material_type, title, r2_object_key, mime_type, size_bytes, original_filename, created_at, updated_at) values ('bad_type', 'org_samyak', 'branch_sion', 'class_missing', 'batch_missing', 'person_missing', 'video', 'Title', 'key-a', 'application/pdf', 10, 'a.pdf', 'now', 'now')")).toThrow();
    expect(() => db.exec("insert into session_materials (id, organisation_id, branch_id, class_session_id, batch_id, trainer_person_id, material_type, title, r2_object_key, mime_type, size_bytes, original_filename, created_at, updated_at) values ('bad_size', 'org_samyak', 'branch_sion', 'class_missing', 'batch_missing', 'person_missing', 'notes', 'Title', 'key-b', 'application/pdf', 10485761, 'a.pdf', 'now', 'now')")).toThrow();
    expect(() => db.exec("insert into session_materials (id, organisation_id, branch_id, class_session_id, batch_id, trainer_person_id, material_type, title, r2_object_key, mime_type, size_bytes, original_filename, created_at, updated_at) values ('bad_mime', 'org_samyak', 'branch_sion', 'class_missing', 'batch_missing', 'person_missing', 'notes', 'Title', 'key-c', 'text/plain', 10, 'a.pdf', 'now', 'now')")).toThrow();
  });

  it("accepts only trainer-owned PDF materials for open or completed sessions", async () => {
    const { c, trainer, otherTrainer } = setup();

    const uploaded = await uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Power BI Notes", materialType: "notes" }, pdfFile());
    expect(uploaded).toMatchObject({ ok: true, material: { title: "Power BI Notes", materialType: "notes", originalFilename: ".. unsafe name.pdf" } });
    if (!uploaded.ok) throw new Error("expected upload");
    expect(JSON.stringify(uploaded.material)).not.toContain("r2_object_key");
    expect(count(c, "session_materials")).toBe(1);
    expect(count(c, "audit_logs where action = 'session_material_uploaded'")).toBe(1);

    await expect(uploadTrainerSessionMaterial(c, otherTrainer, "class_completed", { title: "Nope", materialType: "notes" }, pdfFile()))
      .resolves.toMatchObject({ ok: false, code: "session_not_found" });
    await expect(uploadTrainerSessionMaterial(c, trainer, "class_cancelled", { title: "Nope", materialType: "notes" }, pdfFile()))
      .resolves.toMatchObject({ ok: false, code: "session_cancelled" });
  });

  it("rejects non-PDF, wrong MIME, oversized and over-cap uploads", async () => {
    const { c, trainer } = setup();
    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Wrong MIME", materialType: "notes" }, { ...pdfFile(), contentType: "text/plain" }))
      .resolves.toMatchObject({ ok: false, code: "invalid_mime_type" });
    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Wrong bytes", materialType: "notes" }, { ...pdfFile(), bytes: new TextEncoder().encode("not a pdf") }))
      .resolves.toMatchObject({ ok: false, code: "invalid_pdf" });
    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Huge", materialType: "notes" }, { ...pdfFile(), bytes: new Uint8Array(10 * 1024 * 1024 + 1) }))
      .resolves.toMatchObject({ ok: false, code: "file_too_large" });

    for (let index = 0; index < MAX_ACTIVE_MATERIALS_PER_SESSION; index += 1) {
      await uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: `File ${index}`, materialType: "study_material" }, pdfFile(`file-${index}.pdf`));
    }
    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "One more", materialType: "notes" }, pdfFile()))
      .resolves.toMatchObject({ ok: false, code: "material_limit_reached" });
  });

  it("validates material type and title before upload", () => {
    expect(materialUploadSchema.safeParse({ title: "", materialType: "notes" }).success).toBe(false);
    expect(materialUploadSchema.safeParse({ title: "x".repeat(121), materialType: "notes" }).success).toBe(false);
    expect(materialUploadSchema.safeParse({ title: "Valid", materialType: "video" }).success).toBe(false);
    expect(materialUploadSchema.safeParse({ title: "  Valid  ", materialType: "homework" })).toMatchObject({
      success: true,
      data: { title: "Valid", materialType: "homework" },
    });
  });

  it("does not count soft-deleted materials toward the active material cap", async () => {
    const { c, trainer } = setup();
    const uploaded = [];
    for (let index = 0; index < MAX_ACTIVE_MATERIALS_PER_SESSION; index += 1) {
      const result = await uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: `File ${index}`, materialType: "study_material" }, pdfFile(`file-${index}.pdf`));
      if (!result.ok) throw new Error("expected upload");
      uploaded.push(result.material);
    }

    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Blocked", materialType: "notes" }, pdfFile()))
      .resolves.toMatchObject({ ok: false, code: "material_limit_reached" });
    await expect(deleteTrainerSessionMaterial(c, trainer, uploaded[0].id)).resolves.toMatchObject({ ok: true });
    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Allowed again", materialType: "notes" }, pdfFile()))
      .resolves.toMatchObject({ ok: true });
  });

  it("does not create material metadata when private R2 put fails", async () => {
    const { c, trainer, storage } = setup();
    storage.failPut = true;

    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Storage failure", materialType: "notes" }, pdfFile()))
      .resolves.toMatchObject({ ok: false, code: "material_storage_failed" });

    expect(count(c, "session_materials")).toBe(0);
  });

  it("cleans up the private R2 object when metadata insert fails", async () => {
    const { c, trainer, storage } = setup();
    c.env.DB.database.exec(`
      create trigger session_material_insert_failure
      before insert on session_materials
      begin
        select raise(abort, 'insert failed');
      end;
    `);

    await expect(uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "DB failure", materialType: "notes" }, pdfFile()))
      .rejects.toThrow(/insert failed/);

    expect(count(c, "session_materials")).toBe(0);
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(1);
  });

  it("soft deletes material before R2 cleanup and hides deleted content", async () => {
    const { c, trainer } = setup();
    const uploaded = await uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Delete me", materialType: "homework" }, pdfFile());
    if (!uploaded.ok) throw new Error("expected upload");

    await expect(deleteTrainerSessionMaterial(c, trainer, uploaded.material.id)).resolves.toMatchObject({ ok: true });
    await expect(listTrainerSessionMaterials(c, trainer, "class_completed")).resolves.toMatchObject({ ok: true, materials: [] });
    await expect(getTrainerMaterialContent(c, trainer, uploaded.material.id)).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    expect(count(c, "audit_logs where action = 'session_material_deleted'")).toBe(1);
  });

  it("keeps deleted metadata hidden even when private R2 delete fails", async () => {
    const { c, trainer, storage } = setup();
    const uploaded = await uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Private orphan", materialType: "homework" }, pdfFile());
    if (!uploaded.ok) throw new Error("expected upload");
    expect(storage.objects.size).toBe(1);

    storage.failDelete = true;
    await expect(deleteTrainerSessionMaterial(c, trainer, uploaded.material.id)).resolves.toMatchObject({ ok: true });

    await expect(listTrainerSessionMaterials(c, trainer, "class_completed")).resolves.toMatchObject({ ok: true, materials: [] });
    await expect(getStudentMaterialContent(c, "person_asha", uploaded.material.id)).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    expect(storage.objects.size).toBe(1);
  });

  it("shows student learning across transfer-valid completed sessions only", async () => {
    const { c } = setup();
    const learning = await listStudentLearning(c, "person_asha");
    expect(learning.enrolments).toHaveLength(1);
    expect(learning.enrolments[0]).toMatchObject({ courseName: "Excel", currentBatch: { name: "Morning Batch" } });

    const detail = await getStudentLearningEnrolment(c, "person_transfer", "enrol_transfer", { limit: 20, offset: 0 });
    expect(detail).toMatchObject({ ok: true, summary: { totalClasses: 2, present: 1, absent: 1, attendancePercent: 50 } });
    if (!detail.ok) throw new Error("expected detail");
    expect(detail.sessions.map((session) => session.id)).toEqual(["class_new_batch", "class_old_batch", "class_before_join"]);
    expect(detail.sessions.map((session) => session.id)).not.toContain("class_after_left");
    expect(detail.sessions.map((session) => session.id)).not.toContain("class_open");
  });

  it("authorizes student material content by historical session eligibility", async () => {
    const { c, trainer } = setup();
    const own = await uploadTrainerSessionMaterial(c, trainer, "class_completed", { title: "Eligible", materialType: "notes" }, pdfFile());
    const beforeJoin = await uploadTrainerSessionMaterial(c, trainer, "class_before_join", { title: "Before Join", materialType: "notes" }, pdfFile("before.pdf"));
    if (!own.ok || !beforeJoin.ok) throw new Error("expected uploads");

    await expect(getStudentMaterialContent(c, "person_asha", own.material.id)).resolves.toMatchObject({ ok: true, filename: ".. unsafe name.pdf" });
    await expect(getStudentMaterialContent(c, "person_late", beforeJoin.material.id)).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    await expect(getStudentMaterialContent(c, "person_other", own.material.id)).resolves.toMatchObject({ ok: false, code: "material_not_found" });
  });

  it("denies cross-organisation material IDs before storage access", async () => {
    const { c, trainer, storage } = setup();
    c.env.DB.database.prepare(`insert into session_materials
      (id, organisation_id, branch_id, class_session_id, batch_id, trainer_person_id, material_type, title, r2_object_key, mime_type, size_bytes, original_filename, created_at, updated_at, created_by_actor_id, deleted_at)
      values ('mat_other_org', 'org_other', 'branch_other', 'class_completed', 'batch_morning', 'person_trainer', 'notes', 'Other org', 'session-materials/org_other/sessions/class_completed/materials/mat_other_org.pdf', 'application/pdf', ?, 'other.pdf', ?, ?, 'acct_trainer', null)`)
      .run(PDF_BYTES.byteLength, NOW, NOW);
    storage.objects.set("session-materials/org_other/sessions/class_completed/materials/mat_other_org.pdf", PDF_BYTES);

    await expect(getTrainerMaterialContent(c, trainer, "mat_other_org")).resolves.toMatchObject({ ok: false, code: "material_not_found" });
    await expect(getStudentMaterialContent(c, "person_asha", "mat_other_org")).resolves.toMatchObject({ ok: false, code: "material_not_found" });
  });

  it("sanitizes filenames and keeps script-like titles as escaped display data only", async () => {
    const { c, trainer } = setup();
    const uploaded = await uploadTrainerSessionMaterial(
      c,
      trainer,
      "class_completed",
      { title: "<script>alert(1)</script>", materialType: "notes" },
      pdfFile("bad\";\r\nContent-Length: 0/नाम.pdf"),
    );
    if (!uploaded.ok) throw new Error("expected upload");

    expect(uploaded.material.title).toBe("<script>alert(1)</script>");
    expect(uploaded.material.originalFilename).not.toMatch(/[\r\n"\\/;]/);
    expect(JSON.stringify(uploaded.material)).not.toContain("r2_object_key");
  });
});

function setup() {
  const d1 = new SqliteD1();
  const storage = new MemoryR2();
  installSchema(d1.database);
  seed(d1.database);
  const c = { env: { DB: d1, ENVIRONMENT: "production", CERTIFICATE_PDFS: storage } } as unknown as AppContext & { env: { DB: SqliteD1; CERTIFICATE_PDFS: MemoryR2 } };
  const activeTrainer: TrainerProfileChoice = { personId: "person_trainer", publicName: "Trainer", branchId: "branch_sion", branchName: "Sion", roles: ["trainer"] };
  const otherActiveTrainer: TrainerProfileChoice = { personId: "person_other_trainer", publicName: "Other Trainer", branchId: "branch_sion", branchName: "Sion", roles: ["trainer"] };
  return {
    c,
    storage,
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
    create table courses (id text primary key, organisation_id text, code text, name text, duration_label text, status text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, current_status text, portal_status text, created_at text, updated_at text);
    create table enrolments (id text primary key, student_id text, branch_id text, course_id text, enrolment_number text, joining_date text, actual_completion_date text, status text, created_at text, updated_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_hash text, mobile_last_four text, login_enabled integer, status text, created_at text, updated_at text);
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
    create table class_sessions (
      id text primary key, organisation_id text not null, branch_id text not null, batch_id text not null, trainer_person_id text not null,
      session_date text not null, scheduled_start_time text, scheduled_end_time text, actual_started_at text, actual_ended_at text,
      teaching_note text not null default '', status text not null default 'open', version integer not null default 1,
      created_at text not null, updated_at text not null, created_by_actor_id text
    );
    create table attendance_records (
      id text primary key, organisation_id text not null, class_session_id text not null, batch_membership_id text not null,
      enrolment_id text not null, person_id text not null, status text not null, marked_by_actor_id text, marked_at text not null, updated_at text not null
    );
    create table session_materials (
      id text primary key, organisation_id text not null, branch_id text not null, class_session_id text not null,
      batch_id text not null, trainer_person_id text not null, material_type text not null, title text not null,
      r2_object_key text not null, mime_type text not null, size_bytes integer not null, original_filename text not null,
      created_at text not null, updated_at text not null, created_by_actor_id text, deleted_at text
    );
  `);
}

function seed(db: DatabaseSync) {
  db.prepare("insert into organisations values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_excel', 'org_samyak', 'EXCEL', 'Excel', '1 month', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_trainer', 'org_samyak', 'hash', 'hash', '3210', 1, 'active', ?, ?)").run(NOW, NOW);
  for (const [id, name] of [["person_trainer", "Trainer User"], ["person_other_trainer", "Other Trainer"], ["person_asha", "Asha Student"], ["person_late", "Late Joiner"], ["person_transfer", "Transferred Student"], ["person_other", "Other Student"]] as const) {
    db.prepare("insert into people values (?, 'org_samyak', 'branch_sion', ?, ?, null, 'active', ?, ?)").run(id, name, name, NOW, NOW);
  }
  for (const [id, personId, number] of [["student_asha", "person_asha", "SYK-001"], ["student_late", "person_late", "SYK-002"], ["student_transfer", "person_transfer", "SYK-003"], ["student_other", "person_other", "SYK-004"]] as const) {
    db.prepare("insert into students values (?, 'org_samyak', ?, 'branch_sion', ?, 'active', 'active', ?, ?)").run(id, personId, number, NOW, NOW);
  }
  db.prepare("insert into enrolments values ('enrol_asha', 'student_asha', 'branch_sion', 'course_excel', 'ENR-001', '2026-08-20', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_late', 'student_late', 'branch_sion', 'course_excel', 'ENR-002', '2026-09-03', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_transfer', 'student_transfer', 'branch_sion', 'course_excel', 'ENR-003', '2026-08-20', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into enrolments values ('enrol_other', 'student_other', 'branch_sion', 'course_excel', 'ENR-004', '2026-08-20', null, 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batches values ('batch_morning', 'org_samyak', 'branch_sion', 'course_excel', 'Morning Batch', 'person_trainer', '[\"mon\",\"wed\",\"fri\"]', '10:00', '12:00', null, 'active', 'acct_admin', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batches values ('batch_evening', 'org_samyak', 'branch_sion', 'course_excel', 'Evening Batch', 'person_trainer', '[\"tue\",\"thu\"]', '18:00', '20:00', null, 'active', 'acct_admin', ?, ?)").run(NOW, NOW);
  db.prepare("insert into batch_memberships values ('mem_asha', 'org_samyak', 'batch_morning', 'enrol_asha', '2026-08-20T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('mem_late', 'org_samyak', 'batch_morning', 'enrol_late', '2026-09-03T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('mem_transfer_old', 'org_samyak', 'batch_morning', 'enrol_transfer', '2026-08-20T04:30:00.000Z', '2026-09-02T04:30:00.000Z', 'transferred', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('mem_transfer_new', 'org_samyak', 'batch_evening', 'enrol_transfer', '2026-09-03T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
  db.prepare("insert into batch_memberships values ('mem_other', 'org_samyak', 'batch_evening', 'enrol_other', '2026-08-20T04:30:00.000Z', null, 'active', 'acct_admin', ?)").run(NOW);
  classSession(db, "class_before_join", "batch_morning", "2026-09-01", "completed", "Before late student joined");
  classSession(db, "class_completed", "batch_morning", "2026-09-04", "completed", "Relationships and DAX");
  classSession(db, "class_old_batch", "batch_morning", "2026-09-01", "completed", "Old batch foundations");
  classSession(db, "class_after_left", "batch_morning", "2026-09-04", "completed", "After transfer out");
  classSession(db, "class_new_batch", "batch_evening", "2026-09-04", "completed", "New batch practice");
  classSession(db, "class_open", "batch_evening", "2026-09-05", "open", "Draft open session");
  classSession(db, "class_cancelled", "batch_morning", "2026-09-05", "cancelled", "Cancelled");
  attendance(db, "att_asha", "class_completed", "mem_asha", "enrol_asha", "person_asha", "present");
  attendance(db, "att_transfer_old", "class_old_batch", "mem_transfer_old", "enrol_transfer", "person_transfer", "present");
  attendance(db, "att_transfer_new", "class_new_batch", "mem_transfer_new", "enrol_transfer", "person_transfer", "absent");
}

function classSession(db: DatabaseSync, id: string, batchId: string, sessionDate: string, status: string, note: string) {
  db.prepare(`insert into class_sessions
    (id, organisation_id, branch_id, batch_id, trainer_person_id, session_date, scheduled_start_time, scheduled_end_time, actual_started_at, actual_ended_at, teaching_note, status, version, created_at, updated_at, created_by_actor_id)
    values (?, 'org_samyak', 'branch_sion', ?, 'person_trainer', ?, '10:00', '12:00', ?, ?, ?, ?, 1, ?, ?, 'acct_trainer')`)
    .run(id, batchId, sessionDate, NOW, NOW, note, status, NOW, NOW);
}

function attendance(db: DatabaseSync, id: string, sessionId: string, membershipId: string, enrolmentId: string, personId: string, status: string) {
  db.prepare("insert into attendance_records values (?, 'org_samyak', ?, ?, ?, ?, ?, 'acct_trainer', ?, ?)")
    .run(id, sessionId, membershipId, enrolmentId, personId, status, NOW, NOW);
}

function pdfFile(filename = "../unsafe\r\nname.pdf") {
  return { bytes: PDF_BYTES, filename, contentType: "application/pdf" };
}

function count(c: AppContext & { env: { DB: SqliteD1 } }, tableExpression: string) {
  const row = c.env.DB.database.prepare(`select count(*) as count from ${tableExpression}`).get() as { count: number };
  return row.count;
}

function applyMigrationsThrough0028(db: DatabaseSync) {
  const migrationsDir = join(process.cwd(), "migrations");
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (file > "0028_session_materials_student_academic.sql") break;
    if (file === "0012_d1_referral_foundation.sql") seedMigrationBase(db);
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
}

function seedMigrationBase(db: DatabaseSync) {
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
}
