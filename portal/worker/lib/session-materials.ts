import { z } from "zod";
import { ORG_ID, type TrainerProfileChoice } from "./auth-store";
import { createOpaqueId } from "./crypto";
import type { AppContext } from "./http";

export const materialTypes = ["notes", "homework", "study_material"] as const;
export const MAX_SESSION_MATERIAL_BYTES = 10 * 1024 * 1024;
export const MAX_ACTIVE_MATERIALS_PER_SESSION = 20;

export const materialUploadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  materialType: z.enum(materialTypes).default("study_material"),
});

export type TrainerMaterialContext = {
  loginAccountId: string;
  activeTrainer: TrainerProfileChoice;
};

export type MaterialFileInput = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};

export type SessionMaterialRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  class_session_id: string;
  batch_id: string;
  trainer_person_id: string;
  material_type: (typeof materialTypes)[number];
  title: string;
  r2_object_key: string;
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  created_at: string;
  updated_at: string;
  created_by_actor_id: string | null;
  deleted_at: string | null;
};

type SessionRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  batch_id: string;
  trainer_person_id: string;
  session_date: string;
  status: string;
};

type LearningEnrolmentRow = {
  enrolment_id: string;
  enrolment_number: string;
  enrolment_status: string;
  joining_date: string;
  actual_completion_date: string | null;
  student_id: string;
  student_number: string;
  course_id: string;
  course_code: string;
  course_name: string;
  branch_name: string;
  current_batch_id: string | null;
  current_batch_name: string | null;
  current_trainer_name: string | null;
  current_days_json: string | null;
  current_start_time: string | null;
  current_end_time: string | null;
  current_joined_at: string | null;
};

type StudentSessionRow = {
  session_id: string;
  session_date: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  teaching_note: string;
  status: string;
  batch_id: string;
  batch_name: string;
  trainer_name: string;
  attendance_status: string | null;
  material_count: number;
};

type MaterialSummaryRow = {
  id: string;
  class_session_id: string;
  material_type: string;
  title: string;
  size_bytes: number;
  original_filename: string;
  created_at: string;
};

export function sessionMaterialStorageFromEnv(env: { CERTIFICATE_PDFS?: R2Bucket }) {
  return env.CERTIFICATE_PDFS ? createR2SessionMaterialStorage(env.CERTIFICATE_PDFS) : null;
}

export function buildSessionMaterialKey(material: Pick<SessionMaterialRecord, "organisation_id" | "class_session_id" | "id">) {
  return `session-materials/${safePathSegment(material.organisation_id, "org_samyak")}/sessions/${safePathSegment(material.class_session_id, "session")}/materials/${safePathSegment(material.id, "material")}.pdf`;
}

export function sanitizeMaterialFilename(value: string) {
  const base = value
    .replace(/[\\/\r\n\t\0]+/g, " ")
    .replace(/[^\w .()#&+-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const fallback = base || "session-material.pdf";
  return /\.pdf$/i.test(fallback) ? fallback : `${fallback}.pdf`;
}

export async function listTrainerSessionMaterials(c: AppContext, trainer: TrainerMaterialContext, sessionId: string) {
  const session = await loadTrainerOwnedSession(c, trainer.activeTrainer.personId, sessionId);
  if (!session) return { ok: false as const, status: 404, code: "session_not_found", message: "Class session not found." };
  return { ok: true as const, materials: await activeMaterialsForSession(c, session.id) };
}

export async function uploadTrainerSessionMaterial(c: AppContext, trainer: TrainerMaterialContext, sessionId: string, input: z.infer<typeof materialUploadSchema>, file: MaterialFileInput) {
  const session = await loadTrainerOwnedSession(c, trainer.activeTrainer.personId, sessionId);
  if (!session) return { ok: false as const, status: 404, code: "session_not_found", message: "Class session not found." };
  if (session.status === "cancelled") return { ok: false as const, status: 409, code: "session_cancelled", message: "Materials cannot be uploaded to cancelled sessions." };
  const activeCount = await activeMaterialCount(c, session.id);
  if (activeCount >= MAX_ACTIVE_MATERIALS_PER_SESSION) {
    return { ok: false as const, status: 409, code: "material_limit_reached", message: `A session can have up to ${MAX_ACTIVE_MATERIALS_PER_SESSION} active materials.` };
  }
  const validation = validatePdfFile(file);
  if (!validation.ok) return validation;
  const storage = sessionMaterialStorageFromEnv(c.env);
  if (!storage && c.env.ENVIRONMENT === "production") {
    return { ok: false as const, status: 500, code: "material_storage_unavailable", message: "Session material storage is not configured." };
  }
  const now = new Date().toISOString();
  const material: SessionMaterialRecord = {
    id: createOpaqueId("mat"),
    organisation_id: ORG_ID,
    branch_id: session.branch_id,
    class_session_id: session.id,
    batch_id: session.batch_id,
    trainer_person_id: session.trainer_person_id,
    material_type: input.materialType,
    title: input.title.trim(),
    r2_object_key: "",
    mime_type: "application/pdf",
    size_bytes: file.bytes.byteLength,
    original_filename: sanitizeMaterialFilename(file.filename),
    created_at: now,
    updated_at: now,
    created_by_actor_id: trainer.loginAccountId,
    deleted_at: null,
  };
  material.r2_object_key = buildSessionMaterialKey(material);
  if (storage) {
    try {
      await storage.put({
        key: material.r2_object_key,
        bytes: file.bytes,
        title: material.title,
        originalFilename: material.original_filename,
        materialId: material.id,
      });
    } catch {
      return { ok: false as const, status: 500, code: "material_storage_failed", message: "PDF could not be stored." };
    }
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `insert into session_materials
          (id, organisation_id, branch_id, class_session_id, batch_id, trainer_person_id, material_type, title,
           r2_object_key, mime_type, size_bytes, original_filename, created_at, updated_at, created_by_actor_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?)`,
      ).bind(
        material.id, material.organisation_id, material.branch_id, material.class_session_id, material.batch_id,
        material.trainer_person_id, material.material_type, material.title, material.r2_object_key,
        material.size_bytes, material.original_filename, material.created_at, material.updated_at, material.created_by_actor_id,
      ),
      auditStatement(c, session.branch_id, trainer, "session_material_uploaded", material.id, {
        sessionId: session.id,
        materialType: material.material_type,
        sizeBytes: material.size_bytes,
      }),
    ]);
  } catch (error) {
    if (storage) await storage.delete(material.r2_object_key).catch(() => undefined);
    throw error;
  }
  return { ok: true as const, material: publicMaterial(material) };
}

export async function deleteTrainerSessionMaterial(c: AppContext, trainer: TrainerMaterialContext, materialId: string) {
  const material = await loadMaterial(c, materialId);
  if (!material || material.deleted_at) return { ok: false as const, status: 404, code: "material_not_found", message: "Material was not found." };
  if (material.trainer_person_id !== trainer.activeTrainer.personId) {
    return { ok: false as const, status: 403, code: "forbidden", message: "Only the session trainer can remove this material." };
  }
  const now = new Date().toISOString();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `update session_materials
       set deleted_at = ?, updated_at = ?
       where id = ? and organisation_id = ? and deleted_at is null`,
    ).bind(now, now, material.id, ORG_ID),
    auditStatement(c, material.branch_id, trainer, "session_material_deleted", material.id, {
      sessionId: material.class_session_id,
      materialType: material.material_type,
      sizeBytes: material.size_bytes,
    }),
  ]);
  if (!changed(result[0] as D1RunResult)) return { ok: false as const, status: 404, code: "material_not_found", message: "Material was not found." };
  const storage = sessionMaterialStorageFromEnv(c.env);
  if (storage) await storage.delete(material.r2_object_key).catch(() => undefined);
  return { ok: true as const };
}

export async function getTrainerMaterialContent(c: AppContext, trainer: TrainerMaterialContext, materialId: string) {
  const material = await loadMaterial(c, materialId);
  if (!material || material.deleted_at) return materialNotFound();
  if (material.trainer_person_id !== trainer.activeTrainer.personId) return materialNotFound();
  return materialContent(c, material);
}

export async function listStudentLearning(c: AppContext, personId: string) {
  const rows = await c.env.DB.prepare(
    `select
       enrolments.id as enrolment_id,
       enrolments.enrolment_number,
       enrolments.status as enrolment_status,
       enrolments.joining_date,
       enrolments.actual_completion_date,
       students.id as student_id,
       students.student_number,
       courses.id as course_id,
       courses.code as course_code,
       courses.name as course_name,
       branches.name as branch_name,
       current_membership.batch_id as current_batch_id,
       batches.name as current_batch_name,
       coalesce(trainer_identity.official_full_name, trainers.public_name, trainers.full_name) as current_trainer_name,
       batches.days_of_week_json as current_days_json,
       batches.start_time as current_start_time,
       batches.end_time as current_end_time,
       current_membership.joined_at as current_joined_at
     from students
     join enrolments on enrolments.student_id = students.id
     join courses on courses.id = enrolments.course_id
     join branches on branches.id = enrolments.branch_id
     left join batch_memberships current_membership
       on current_membership.organisation_id = students.organisation_id
      and current_membership.enrolment_id = enrolments.id
      and current_membership.left_at is null
      and current_membership.status = 'active'
     left join batches on batches.id = current_membership.batch_id
      and batches.organisation_id = students.organisation_id
     left join people trainers on trainers.id = batches.primary_trainer_person_id
     left join person_identity_details trainer_identity on trainer_identity.person_id = trainers.id
     where students.organisation_id = ?
       and students.person_id = ?
     order by case when enrolments.status in ('active', 'on_hold', 'confirmed', 'not_started') then 0 else 1 end,
              enrolments.joining_date desc,
              enrolments.id desc
     limit 50`,
  )
    .bind(ORG_ID, personId)
    .all<LearningEnrolmentRow>();
  return { success: true as const, enrolments: (rows.results || []).map(mapLearningEnrolment) };
}

export async function getStudentLearningEnrolment(c: AppContext, personId: string, enrolmentId: string, pagination: { limit: number; offset: number }) {
  const enrolments = await listStudentLearning(c, personId);
  const enrolment = enrolments.enrolments.find((item) => item.enrolmentId === enrolmentId);
  if (!enrolment) return { ok: false as const, status: 404, code: "enrolment_not_found", message: "Learning record was not found." };
  const summary = await attendanceSummary(c, personId, enrolmentId);
  const sessions = await studentSessions(c, personId, enrolmentId, pagination);
  return { ok: true as const, success: true as const, enrolment, summary, sessions: sessions.items, pagination: sessions.pagination };
}

export async function getStudentMaterialContent(c: AppContext, personId: string, materialId: string) {
  const material = await loadMaterial(c, materialId);
  if (!material || material.deleted_at) return materialNotFound();
  const eligible = await isStudentEligibleForSession(c, personId, material.class_session_id);
  if (!eligible) return materialNotFound();
  return materialContent(c, material);
}

async function studentSessions(c: AppContext, personId: string, enrolmentId: string, pagination: { limit: number; offset: number }) {
  const rows = await c.env.DB.prepare(
    `select distinct
       class_sessions.id as session_id,
       class_sessions.session_date,
       class_sessions.scheduled_start_time,
       class_sessions.scheduled_end_time,
       class_sessions.teaching_note,
       class_sessions.status,
       batches.id as batch_id,
       batches.name as batch_name,
       coalesce(trainer_identity.official_full_name, trainers.public_name, trainers.full_name) as trainer_name,
       attendance_records.status as attendance_status,
       coalesce(material_counts.material_count, 0) as material_count
     from batch_memberships
     join enrolments on enrolments.id = batch_memberships.enrolment_id
     join students on students.id = enrolments.student_id
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
      and attendance_records.person_id = students.person_id
     left join (
       select class_session_id, count(*) as material_count
       from session_materials
       where organisation_id = ? and deleted_at is null
       group by class_session_id
     ) material_counts on material_counts.class_session_id = class_sessions.id
     where batch_memberships.organisation_id = ?
       and enrolments.id = ?
       and students.person_id = ?
     order by class_sessions.session_date desc, class_sessions.scheduled_start_time desc, class_sessions.created_at desc, class_sessions.id desc
     limit ? offset ?`,
  )
    .bind(ORG_ID, ORG_ID, enrolmentId, personId, pagination.limit + 1, pagination.offset)
    .all<StudentSessionRow>();
  const sessionRows = (rows.results || []).slice(0, pagination.limit);
  const materials = sessionRows.length ? await materialsForSessions(c, sessionRows.map((row) => row.session_id)) : new Map<string, ReturnType<typeof publicMaterial>[]>();
  return {
    items: sessionRows.map((row) => mapStudentSession(row, materials.get(row.session_id) || [])),
    pagination: { limit: pagination.limit, offset: pagination.offset, hasMore: (rows.results || []).length > pagination.limit },
  };
}

async function attendanceSummary(c: AppContext, personId: string, enrolmentId: string) {
  const row = await c.env.DB.prepare(
    `select
       sum(case when attendance_records.status = 'present' then 1 else 0 end) as present,
       sum(case when attendance_records.status = 'absent' then 1 else 0 end) as absent
     from attendance_records
     join batch_memberships on batch_memberships.id = attendance_records.batch_membership_id
      and batch_memberships.organisation_id = attendance_records.organisation_id
     join class_sessions on class_sessions.id = attendance_records.class_session_id
      and class_sessions.organisation_id = attendance_records.organisation_id
      and class_sessions.status = 'completed'
      and date(batch_memberships.joined_at) <= date(class_sessions.session_date)
      and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(class_sessions.session_date))
     join enrolments on enrolments.id = attendance_records.enrolment_id
     join students on students.id = enrolments.student_id
     where attendance_records.organisation_id = ?
       and attendance_records.enrolment_id = ?
       and attendance_records.person_id = ?
       and students.person_id = ?`,
  )
    .bind(ORG_ID, enrolmentId, personId, personId)
    .first<{ present: number | null; absent: number | null }>();
  const present = Number(row?.present || 0);
  const absent = Number(row?.absent || 0);
  const total = present + absent;
  return { present, absent, totalClasses: total, attendancePercent: total ? Math.round((present / total) * 100) : null };
}

async function isStudentEligibleForSession(c: AppContext, personId: string, sessionId: string) {
  const row = await c.env.DB.prepare(
    `select 1 as allowed
     from session_materials
     join class_sessions on class_sessions.id = session_materials.class_session_id
      and class_sessions.organisation_id = session_materials.organisation_id
      and class_sessions.status = 'completed'
     join batch_memberships on batch_memberships.organisation_id = class_sessions.organisation_id
      and batch_memberships.batch_id = class_sessions.batch_id
      and date(batch_memberships.joined_at) <= date(class_sessions.session_date)
      and (batch_memberships.left_at is null or date(batch_memberships.left_at) >= date(class_sessions.session_date))
     join enrolments on enrolments.id = batch_memberships.enrolment_id
     join students on students.id = enrolments.student_id
     where session_materials.organisation_id = ?
       and session_materials.class_session_id = ?
       and session_materials.deleted_at is null
       and students.person_id = ?
     limit 1`,
  )
    .bind(ORG_ID, sessionId, personId)
    .first<{ allowed: number }>();
  return Boolean(row);
}

async function materialsForSessions(c: AppContext, sessionIds: string[]) {
  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `select id, class_session_id, material_type, title, size_bytes, original_filename, created_at
     from session_materials
     where organisation_id = ?
       and deleted_at is null
       and class_session_id in (${placeholders})
     order by created_at asc, id asc`,
  )
    .bind(ORG_ID, ...sessionIds)
    .all<MaterialSummaryRow>();
  const bySession = new Map<string, ReturnType<typeof publicMaterial>[]>();
  for (const row of rows.results || []) {
    const list = bySession.get(row.class_session_id) || [];
    list.push(publicMaterial(row));
    bySession.set(row.class_session_id, list);
  }
  return bySession;
}

async function activeMaterialsForSession(c: AppContext, sessionId: string) {
  const rows = await c.env.DB.prepare(
    `select id, class_session_id, material_type, title, size_bytes, original_filename, created_at
     from session_materials
     where organisation_id = ? and class_session_id = ? and deleted_at is null
     order by created_at asc, id asc`,
  )
    .bind(ORG_ID, sessionId)
    .all<MaterialSummaryRow>();
  return (rows.results || []).map(publicMaterial);
}

async function activeMaterialCount(c: AppContext, sessionId: string) {
  const row = await c.env.DB.prepare("select count(*) as count from session_materials where organisation_id = ? and class_session_id = ? and deleted_at is null")
    .bind(ORG_ID, sessionId)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

async function loadTrainerOwnedSession(c: AppContext, trainerPersonId: string, sessionId: string) {
  return c.env.DB.prepare(
    `select id, organisation_id, branch_id, batch_id, trainer_person_id, session_date, status
     from class_sessions
     where id = ? and organisation_id = ? and trainer_person_id = ?
     limit 1`,
  )
    .bind(sessionId, ORG_ID, trainerPersonId)
    .first<SessionRecord>();
}

async function loadMaterial(c: AppContext, materialId: string) {
  return c.env.DB.prepare("select * from session_materials where id = ? and organisation_id = ? limit 1")
    .bind(materialId, ORG_ID)
    .first<SessionMaterialRecord>();
}

async function materialContent(c: AppContext, material: SessionMaterialRecord) {
  const storage = sessionMaterialStorageFromEnv(c.env);
  if (!storage) return { ok: false as const, status: 503, code: "material_storage_unavailable", message: "Session material storage is not configured." };
  const object = await storage.get(material.r2_object_key);
  if (!object?.body) return { ok: false as const, status: 503, code: "material_missing", message: "PDF is temporarily unavailable." };
  return { ok: true as const, body: object.body, filename: material.original_filename, sizeBytes: object.contentLength || material.size_bytes };
}

function validatePdfFile(file: MaterialFileInput) {
  if (file.bytes.byteLength <= 0) return { ok: false as const, status: 400, code: "file_required", message: "Choose a PDF file." };
  if (file.bytes.byteLength > MAX_SESSION_MATERIAL_BYTES) {
    return { ok: false as const, status: 413, code: "file_too_large", message: "PDF must be 10 MB or smaller." };
  }
  if (file.contentType.toLowerCase() !== "application/pdf") {
    return { ok: false as const, status: 400, code: "invalid_mime_type", message: "Only PDF files are supported." };
  }
  const header = new TextDecoder().decode(file.bytes.slice(0, 5));
  if (header !== "%PDF-") {
    return { ok: false as const, status: 400, code: "invalid_pdf", message: "The selected file is not a valid PDF." };
  }
  return { ok: true as const };
}

function publicMaterial(row: Pick<SessionMaterialRecord | MaterialSummaryRow, "id" | "material_type" | "title" | "size_bytes" | "original_filename" | "created_at">) {
  return {
    id: row.id,
    materialType: row.material_type,
    title: row.title,
    sizeBytes: Number(row.size_bytes),
    originalFilename: row.original_filename,
    createdAt: row.created_at,
  };
}

function mapLearningEnrolment(row: LearningEnrolmentRow) {
  return {
    enrolmentId: row.enrolment_id,
    enrolmentNumber: row.enrolment_number,
    status: row.enrolment_status,
    joiningDate: row.joining_date,
    completionDate: row.actual_completion_date,
    studentId: row.student_id,
    studentNumber: row.student_number,
    courseId: row.course_id,
    courseCode: row.course_code,
    courseName: row.course_name,
    branchName: row.branch_name,
    currentBatch: row.current_batch_id
      ? {
          id: row.current_batch_id,
          name: row.current_batch_name || "",
          trainerName: row.current_trainer_name || "",
          daysOfWeek: parseDays(row.current_days_json || "[]"),
          startTime: row.current_start_time || "",
          endTime: row.current_end_time || "",
          joinedAt: row.current_joined_at || row.joining_date,
        }
      : null,
  };
}

function mapStudentSession(row: StudentSessionRow, materials: ReturnType<typeof publicMaterial>[]) {
  return {
    id: row.session_id,
    sessionDate: row.session_date,
    scheduledStartTime: row.scheduled_start_time,
    scheduledEndTime: row.scheduled_end_time,
    batchId: row.batch_id,
    batchName: row.batch_name,
    trainerName: row.trainer_name,
    teachingNote: row.teaching_note,
    attendanceStatus: row.attendance_status,
    status: row.status,
    materialCount: Number(row.material_count || materials.length),
    materials,
  };
}

function auditStatement(c: AppContext, branchId: string, trainer: TrainerMaterialContext, action: string, materialId: string, metadata: unknown) {
  return c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, 'session_material', ?, ?, ?)`,
  ).bind(createOpaqueId("audit"), ORG_ID, branchId, trainer.loginAccountId, trainer.activeTrainer.personId, action, materialId, JSON.stringify(metadata), new Date().toISOString());
}

type SessionMaterialStoragePutInput = {
  key: string;
  bytes: Uint8Array;
  title: string;
  originalFilename: string;
  materialId: string;
};

type SessionMaterialStorage = {
  put(input: SessionMaterialStoragePutInput): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentLength?: number; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

function createR2SessionMaterialStorage(bucket: R2Bucket): SessionMaterialStorage {
  return {
    async put(input) {
      await bucket.put(input.key, input.bytes, {
        httpMetadata: {
          contentType: "application/pdf",
          contentDisposition: `inline; filename="${contentDispositionFilename(input.originalFilename)}"`,
        },
        customMetadata: {
          materialId: input.materialId,
          title: input.title.slice(0, 120),
        },
      });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object?.body) return null;
      return {
        body: object.body,
        contentLength: object.size,
        arrayBuffer: () => object.arrayBuffer(),
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

function materialNotFound() {
  return { ok: false as const, status: 404, code: "material_not_found", message: "Material was not found." };
}

function safePathSegment(value: string, fallback: string) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

function contentDispositionFilename(value: string) {
  return sanitizeMaterialFilename(value).replace(/["\\]/g, "-");
}

function parseDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

type D1RunResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

function changed(result: D1RunResult) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 1) > 0;
}
