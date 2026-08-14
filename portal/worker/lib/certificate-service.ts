import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { createOpaqueId, randomBase64Url } from "./crypto";
import type { StaffContext } from "./staff-auth";
import { generateCertificatePdf } from "./certificate-pdf";
import {
  buildCertificatePdfKey,
  certificatePdfFilename,
  certificatePdfStorageFromEnv,
  type CertificatePdfStorage,
} from "./certificate-storage";

export const CERTIFICATE_TEMPLATE_CODE = "SAMYAK_COMPLETION_V1";
export const CERTIFICATE_VERIFICATION_ORIGIN = "https://go.samyaksion.com";

export type CertificateRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  certificate_number: string;
  verification_code: string;
  person_id: string;
  student_id: string;
  enrolment_id: string;
  course_id: string;
  student_name_snapshot: string;
  student_id_snapshot: string;
  course_name_snapshot: string;
  course_code_snapshot: string;
  course_duration_months_snapshot: number | null;
  course_duration_label_snapshot: string | null;
  joining_date_snapshot: string;
  completion_date_snapshot: string | null;
  issue_date: string;
  template_id: string;
  template_version_snapshot: number;
  status: "issued" | "revoked" | "superseded";
  pdf_storage_key: string | null;
  pdf_sha256: string | null;
  issued_by_actor_id: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_by_actor_id: string | null;
  revocation_reason: string | null;
  supersedes_certificate_id: string | null;
  superseded_by_certificate_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CertificatePdfResult =
  | { ok: true; bytes: Uint8Array; filename: string; sha256: string | null; storageKey: string | null }
  | { ok: false; status: number; code: string; message: string };

type EligibilityRow = {
  enrolment_id: string;
  enrolment_status: string;
  branch_id: string;
  branch_code: string;
  organisation_id: string;
  person_id: string | null;
  person_status: string | null;
  person_name: string | null;
  official_full_name: string | null;
  student_id: string | null;
  student_number: string | null;
  student_status: string | null;
  course_id: string | null;
  course_code: string | null;
  course_name: string | null;
  course_status: string | null;
  duration_months: number | null;
  duration_label: string | null;
  joining_date: string;
  actual_completion_date: string | null;
};

export async function certificateEligibility(c: AppContext, enrolmentId: string) {
  const row = await loadEligibilityRow(c, enrolmentId);
  const reasons: string[] = [];
  if (!row) reasons.push("enrolment_not_found");
  if (row && row.organisation_id !== ORG_ID) reasons.push("wrong_organisation");
  if (row && !row.person_id) reasons.push("person_missing");
  if (row && row.person_status && row.person_status !== "active") reasons.push("person_inactive");
  if (row && !row.student_id) reasons.push("student_missing");
  if (row && row.student_status === "archived") reasons.push("student_archived");
  if (row && !row.course_id) reasons.push("course_missing");
  if (row && row.course_status !== "active") reasons.push("course_inactive");
  if (row && row.enrolment_status !== "completed") reasons.push(`enrolment_${row.enrolment_status}`);
  const existingCertificate = row ? await activeCertificateForEnrolment(c, row.enrolment_id) : null;
  if (existingCertificate) reasons.push("certificate_already_issued");
  return { eligible: reasons.length === 0, reasons, existingCertificate, enrolment: row };
}

export async function listEligibleCertificates(c: AppContext, input: { q?: string; courseId?: string; limit: number; offset: number }) {
  const params: unknown[] = [ORG_ID];
  const filters = [
    "students.organisation_id = ?",
    "enrolments.status = 'completed'",
    "people.status = 'active'",
    "courses.status = 'active'",
    "certificates.id is null",
  ];
  if (input.q) {
    filters.push("(people.full_name like ? or person_identity_details.official_full_name like ? or students.student_number like ? or courses.name like ?)");
    const q = `%${input.q}%`;
    params.push(q, q, q, q);
  }
  if (input.courseId) {
    filters.push("courses.id = ?");
    params.push(input.courseId);
  }
  params.push(input.limit + 1, input.offset);
  const rows = await c.env.DB.prepare(
    `select
       enrolments.id as enrolment_id,
       coalesce(person_identity_details.official_full_name, people.full_name) as student_name,
       students.student_number,
       courses.id as course_id,
       courses.name as course_name,
       courses.code as course_code,
       courses.duration_label,
       enrolments.joining_date,
       enrolments.actual_completion_date,
       enrolments.status
     from enrolments
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     join courses on courses.id = enrolments.course_id
     left join certificates on certificates.organisation_id = students.organisation_id
       and certificates.enrolment_id = enrolments.id
       and certificates.status = 'issued'
     where ${filters.join(" and ")}
     order by enrolments.actual_completion_date desc, enrolments.joining_date desc, enrolments.id desc
     limit ? offset ?`,
  )
    .bind(...params)
    .all();
  const results = rows.results || [];
  return { items: results.slice(0, input.limit), pagination: { limit: input.limit, offset: input.offset, hasMore: results.length > input.limit } };
}

export async function listCertificates(c: AppContext, input: { q?: string; courseId?: string; status?: string; personId?: string; limit: number; offset: number }) {
  const params: unknown[] = [ORG_ID];
  const filters = ["certificates.organisation_id = ?"];
  if (input.status) {
    filters.push("certificates.status = ?");
    params.push(input.status);
  }
  if (input.personId) {
    filters.push("certificates.person_id = ?");
    params.push(input.personId);
  }
  if (input.courseId) {
    filters.push("certificates.course_id = ?");
    params.push(input.courseId);
  }
  if (input.q) {
    filters.push("(certificates.certificate_number like ? or certificates.student_id_snapshot like ? or certificates.student_name_snapshot like ? or certificates.course_name_snapshot like ?)");
    const q = `%${input.q}%`;
    params.push(q, q, q, q);
  }
  params.push(input.limit + 1, input.offset);
  const rows = await c.env.DB.prepare(
    `select
       id, certificate_number, verification_code, person_id, student_id_snapshot, student_name_snapshot,
       course_id, course_name_snapshot, course_code_snapshot, issue_date, completion_date_snapshot,
       status, pdf_storage_key, template_version_snapshot
     from certificates
     where ${filters.join(" and ")}
     order by issue_date desc, created_at desc
     limit ? offset ?`,
  )
    .bind(...params)
    .all();
  const results = rows.results || [];
  return { items: results.slice(0, input.limit), pagination: { limit: input.limit, offset: input.offset, hasMore: results.length > input.limit } };
}

export async function issueCertificate(c: AppContext, staff: StaffContext, enrolmentId: string, issueDate: string, options: { storage?: CertificatePdfStorage | null } = {}) {
  const eligibility = await certificateEligibility(c, enrolmentId);
  if (eligibility.existingCertificate) return { ok: true as const, certificate: eligibility.existingCertificate, idempotent: true };
  if (!eligibility.eligible || !eligibility.enrolment) {
    return { ok: false as const, status: 409, code: "not_eligible", message: "This enrolment is not eligible for certificate issuance.", reasons: eligibility.reasons };
  }
  const row = eligibility.enrolment;
  const now = new Date().toISOString();
  const template = await activeTemplate(c);
  if (!template) return { ok: false as const, status: 500, code: "template_missing", message: "Certificate template is not configured.", reasons: ["template_missing"] };
  const storage = options.storage ?? certificatePdfStorageFromEnv(c.env);
  if (!storage && c.env.ENVIRONMENT === "production") {
    return { ok: false as const, status: 500, code: "certificate_storage_unavailable", message: "Certificate PDF storage is not configured.", reasons: ["certificate_storage_unavailable"] };
  }
  const certificateId = createOpaqueId("cert");
  const certificateNumber = await allocateCertificateNumber(c, row.branch_id, row.branch_code, issueDate);
  const verificationCode = await uniqueVerificationCode(c);
  const verificationUrl = buildVerificationUrl(c, verificationCode);
  const certificate: CertificateRecord = {
    id: certificateId,
    organisation_id: ORG_ID,
    branch_id: row.branch_id,
    certificate_number: certificateNumber,
    verification_code: verificationCode,
    person_id: row.person_id!,
    student_id: row.student_id!,
    enrolment_id: row.enrolment_id,
    course_id: row.course_id!,
    student_name_snapshot: row.official_full_name || row.person_name || "Student",
    student_id_snapshot: row.student_number!,
    course_name_snapshot: row.course_name!,
    course_code_snapshot: row.course_code!,
    course_duration_months_snapshot: row.duration_months,
    course_duration_label_snapshot: row.duration_label,
    joining_date_snapshot: row.joining_date,
    completion_date_snapshot: row.actual_completion_date,
    issue_date: issueDate,
    template_id: template.id,
    template_version_snapshot: template.version,
    status: "issued",
    pdf_storage_key: null,
    pdf_sha256: null,
    issued_by_actor_id: staff.loginAccountId,
    issued_at: now,
    revoked_at: null,
    revoked_by_actor_id: null,
    revocation_reason: null,
    supersedes_certificate_id: null,
    superseded_by_certificate_id: null,
    created_at: now,
    updated_at: now,
  };
  const pdf = await generateCertificatePdf({ certificate, verificationUrl });
  certificate.pdf_sha256 = pdf.sha256;
  certificate.pdf_storage_key = buildCertificatePdfKey(certificate);
  if (storage) {
    try {
      await storage.put({
        key: certificate.pdf_storage_key,
        bytes: pdf.bytes,
        certificateId: certificate.id,
        certificateNumber: certificate.certificate_number,
        sha256: pdf.sha256,
      });
    } catch {
      return { ok: false as const, status: 500, code: "certificate_pdf_storage_failed", message: "Certificate PDF could not be stored.", reasons: ["certificate_pdf_storage_failed"] };
    }
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `insert into certificates
          (id, organisation_id, branch_id, certificate_number, verification_code, person_id, student_id, enrolment_id, course_id,
           student_name_snapshot, student_id_snapshot, course_name_snapshot, course_code_snapshot, course_duration_months_snapshot,
           course_duration_label_snapshot, joining_date_snapshot, completion_date_snapshot, issue_date, template_id,
           template_version_snapshot, status, pdf_storage_key, pdf_sha256, issued_by_actor_id, issued_at,
           created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        certificate.id, certificate.organisation_id, certificate.branch_id, certificate.certificate_number, certificate.verification_code,
        certificate.person_id, certificate.student_id, certificate.enrolment_id, certificate.course_id, certificate.student_name_snapshot,
        certificate.student_id_snapshot, certificate.course_name_snapshot, certificate.course_code_snapshot, certificate.course_duration_months_snapshot,
        certificate.course_duration_label_snapshot, certificate.joining_date_snapshot, certificate.completion_date_snapshot, certificate.issue_date,
        certificate.template_id, certificate.template_version_snapshot, certificate.pdf_storage_key, certificate.pdf_sha256,
        certificate.issued_by_actor_id, certificate.issued_at, certificate.created_at, certificate.updated_at,
      ),
      statusEvent(c, certificate, staff, "issued", null, "issued", null, now),
    ]);
  } catch (error) {
    const existing = await activeCertificateForEnrolment(c, row.enrolment_id);
    if (existing) {
      if (storage && certificate.pdf_storage_key && certificate.pdf_storage_key !== existing.pdf_storage_key) {
        await storage.delete(certificate.pdf_storage_key).catch(() => undefined);
      }
      return { ok: true as const, certificate: existing, idempotent: true };
    }
    if (storage && certificate.pdf_storage_key) await storage.delete(certificate.pdf_storage_key).catch(() => undefined);
    throw error;
  }
  return { ok: true as const, certificate, idempotent: false };
}

export async function revokeCertificate(c: AppContext, staff: StaffContext, certificateId: string, reason: string) {
  const current = await getCertificateById(c, certificateId);
  if (!current) return { ok: false as const, status: 404, code: "certificate_not_found", message: "Certificate was not found." };
  if (current.status !== "issued") return { ok: false as const, status: 409, code: "not_issued", message: "Only issued certificates can be revoked." };
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `update certificates
       set status = 'revoked', revoked_at = ?, revoked_by_actor_id = ?, revocation_reason = ?, updated_at = ?
       where id = ? and status = 'issued'`,
    ).bind(now, staff.loginAccountId, reason, now, certificateId),
    statusEvent(c, current, staff, "revoked", "issued", "revoked", reason, now),
  ]);
  return { ok: true as const };
}

export async function verifyCertificate(c: AppContext, code: string) {
  if (!/^SYK-[A-Z0-9_-]{16,64}$/.test(code)) return { status: "not_found" as const, certificate: null };
  const certificate = await c.env.DB.prepare(
    `select certificate_number, verification_code, student_name_snapshot, student_id_snapshot,
            course_name_snapshot, issue_date, completion_date_snapshot, status
     from certificates
     where organisation_id = ? and verification_code = ?
     limit 1`,
  )
    .bind(ORG_ID, code)
    .first<Record<string, unknown>>();
  if (!certificate) return { status: "not_found" as const, certificate: null };
  const status = certificate.status === "issued" ? "valid" : certificate.status === "revoked" ? "revoked" : "superseded";
  return { status, certificate };
}

export async function getCertificatePdf(c: AppContext, certificateId: string, personId?: string, options: { storage?: CertificatePdfStorage | null } = {}): Promise<CertificatePdfResult> {
  const certificate = await getCertificateById(c, certificateId);
  if (!certificate) return { ok: false, status: 404, code: "certificate_not_found", message: "Certificate was not found." };
  if (personId && certificate.person_id !== personId) return { ok: false, status: 404, code: "certificate_not_found", message: "Certificate was not found." };
  const storage = options.storage ?? certificatePdfStorageFromEnv(c.env);
  if (storage && certificate.pdf_storage_key) {
    const object = await storage.get(certificate.pdf_storage_key);
    if (!object) return { ok: false, status: 503, code: "certificate_pdf_missing", message: "Certificate PDF is temporarily unavailable." };
    return {
      ok: true,
      bytes: new Uint8Array(await object.arrayBuffer()),
      filename: certificatePdfFilename(certificate),
      sha256: certificate.pdf_sha256,
      storageKey: certificate.pdf_storage_key,
    };
  }
  if (c.env.ENVIRONMENT === "production") {
    return { ok: false, status: 503, code: "certificate_storage_unavailable", message: "Certificate PDF storage is not configured." };
  }
  const pdf = await generateCertificatePdf({ certificate, verificationUrl: buildVerificationUrl(c, certificate.verification_code) });
  return { ok: true, bytes: pdf.bytes, filename: certificatePdfFilename(certificate), sha256: pdf.sha256, storageKey: certificate.pdf_storage_key };
}

export async function getCertificateById(c: AppContext, certificateId: string) {
  return c.env.DB.prepare("select * from certificates where organisation_id = ? and id = ?")
    .bind(ORG_ID, certificateId)
    .first<CertificateRecord>();
}

export function buildVerificationUrl(c: AppContext, code: string) {
  const envOrigin = String(c.env.CERTIFICATE_VERIFICATION_ORIGIN || "").replace(/\/$/, "");
  return `${envOrigin || CERTIFICATE_VERIFICATION_ORIGIN}/verify/${encodeURIComponent(code)}`;
}

async function loadEligibilityRow(c: AppContext, enrolmentId: string) {
  return c.env.DB.prepare(
    `select
       enrolments.id as enrolment_id,
       enrolments.status as enrolment_status,
       enrolments.branch_id,
       branches.code as branch_code,
       students.organisation_id,
       people.id as person_id,
       people.status as person_status,
       people.full_name as person_name,
       person_identity_details.official_full_name,
       students.id as student_id,
       students.student_number,
       students.current_status as student_status,
       courses.id as course_id,
       courses.code as course_code,
       courses.name as course_name,
       courses.status as course_status,
       courses.duration_months,
       courses.duration_label,
       enrolments.joining_date,
       enrolments.actual_completion_date
     from enrolments
     left join students on students.id = enrolments.student_id
     left join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     left join courses on courses.id = enrolments.course_id
     left join branches on branches.id = enrolments.branch_id
     where enrolments.id = ?
     limit 1`,
  )
    .bind(enrolmentId)
    .first<EligibilityRow>();
}

async function activeCertificateForEnrolment(c: AppContext, enrolmentId: string) {
  return c.env.DB.prepare("select * from certificates where organisation_id = ? and enrolment_id = ? and status = 'issued' limit 1")
    .bind(ORG_ID, enrolmentId)
    .first<CertificateRecord>();
}

async function activeTemplate(c: AppContext) {
  const existing = await c.env.DB.prepare(
    "select id, version from certificate_templates where organisation_id = ? and code = ? and status = 'active' and is_active = 1 order by version desc limit 1",
  )
    .bind(ORG_ID, CERTIFICATE_TEMPLATE_CODE)
    .first<{ id: string; version: number }>();
  if (existing) return existing;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `insert into certificate_templates
       (id, organisation_id, code, name, version, status, is_active, created_at, updated_at)
     values ('ctpl_samyak_completion_v1', ?, ?, 'Samyak Completion Certificate', 1, 'active', 1, ?, ?)
     on conflict(organisation_id, code, version) do update set
       status = 'active',
       is_active = 1,
       updated_at = excluded.updated_at`,
  )
    .bind(ORG_ID, CERTIFICATE_TEMPLATE_CODE, now, now)
    .run();
  return c.env.DB.prepare(
    "select id, version from certificate_templates where organisation_id = ? and code = ? and status = 'active' and is_active = 1 order by version desc limit 1",
  )
    .bind(ORG_ID, CERTIFICATE_TEMPLATE_CODE)
    .first<{ id: string; version: number }>();
}

async function allocateCertificateNumber(c: AppContext, branchId: string, branchCode: string, issueDate: string) {
  const year = issueDate.slice(0, 4);
  const sequence = await allocateSequence(c, ORG_ID, branchId, `certificate:${year}`);
  return `SYK-${branchCode.toUpperCase()}-CERT-${year}-${String(sequence).padStart(6, "0")}`;
}

async function allocateSequence(c: AppContext, organisationId: string, branchId: string, sequenceKey: string) {
  const now = new Date().toISOString();
  const id = `seq_${organisationId}_${branchId}_${sequenceKey}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
  await c.env.DB.prepare(
    `insert or ignore into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at)
     values (?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, organisationId, branchId, sequenceKey, now, now)
    .run();
  const row = await c.env.DB.prepare(
    `update number_sequences
     set next_sequence = next_sequence + 1, updated_at = ?
     where organisation_id = ? and branch_id = ? and sequence_key = ?
     returning next_sequence - 1 as sequence`,
  )
    .bind(now, organisationId, branchId, sequenceKey)
    .first<{ sequence: number }>();
  if (!row) throw new Error("Could not allocate certificate number");
  return Number(row.sequence);
}

async function uniqueVerificationCode(c: AppContext) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `SYK-${randomBase64Url(18).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
    const existing = await c.env.DB.prepare("select 1 from certificates where verification_code = ? limit 1").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("Could not allocate verification code");
}

function statusEvent(
  c: AppContext,
  certificate: Pick<CertificateRecord, "id" | "organisation_id">,
  staff: StaffContext,
  action: "issued" | "revoked" | "superseded" | "reissued",
  fromStatus: string | null,
  toStatus: string,
  reason: string | null,
  now: string,
) {
  return c.env.DB.prepare(
    `insert into certificate_status_events
       (id, organisation_id, certificate_id, actor_login_account_id, actor_person_id, action, from_status, to_status, reason, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(createOpaqueId("certevt"), certificate.organisation_id, certificate.id, staff.loginAccountId, staff.activePersonId, action, fromStatus, toStatus, reason, now);
}
