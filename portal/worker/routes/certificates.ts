import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID } from "../lib/auth-store";
import { createOpaqueId, hmacHex } from "../lib/crypto";
import { getClientIp } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { getSessionFromRequest, hasSessionCookie, clearSessionCookie, sessionView } from "../lib/auth-store";
import { requireStaffRoles, type StaffContext } from "../lib/staff-auth";
import {
  buildVerificationUrl,
  getCertificatePdf,
  issueCertificate,
  listCertificates,
  listEligibleCertificates,
  revokeCertificate,
  verifyCertificate,
} from "../lib/certificate-service";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const CERTIFICATE_STAFF_ROLES = ["owner", "system_admin", "admin", "counsellor", "admission_admin"] as const;
const CERTIFICATE_OWNER_ROLES = ["owner"] as const;
const PUBLIC_VERIFY_LIMIT = { count: 120, windowSeconds: 60 };

const issueSchema = z.object({
  enrolmentId: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const revokeSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export function registerCertificateRoutes(app: PortalHono) {
  app.get("/api/staff/certificates/eligible", async (c) => {
    const staff = await requireCertificateStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
    return jsonPlain(c, await listEligibleCertificates(c, listQuery(c)));
  });

  app.get("/api/staff/certificates", async (c) => {
    const staff = await requireCertificateStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
    return jsonPlain(c, await listCertificates(c, { ...listQuery(c), status: statusQuery(c) }));
  });

  app.post("/api/staff/certificates/issue", async (c) => {
    const staff = await requireCertificateStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
    const parsed = issueSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_request", message: "Please check the certificate details." });
    const result = await issueCertificate(c, staff, parsed.data.enrolmentId, parsed.data.issueDate);
    if (!result.ok) return jsonError(c, { status: httpStatus(result.status), code: result.code, message: result.message });
    return jsonPlain(c, { success: true, certificate: publicStaffCertificate(c, result.certificate), idempotent: result.idempotent }, { status: result.idempotent ? 200 : 201 });
  });

  app.post("/api/staff/certificates/:certificateId/revoke", async (c) => {
    const staff = await requireStaffRoles(c, CERTIFICATE_OWNER_ROLES);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Owner access is required." });
    const parsed = revokeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_request", message: "Revocation reason is required." });
    const result = await revokeCertificate(c, staff, c.req.param("certificateId"), parsed.data.reason);
    if (!result.ok) return jsonError(c, { status: httpStatus(result.status), code: result.code, message: result.message });
    return jsonPlain(c, { success: true });
  });

  app.get("/api/staff/certificates/:certificateId/pdf", async (c) => {
    const staff = await requireCertificateStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
    const pdf = await getCertificatePdf(c, c.req.param("certificateId"));
    if (!pdf.ok) return jsonError(c, { status: httpStatus(pdf.status), code: pdf.code, message: pdf.message });
    return pdfResponse(pdf.bytes, pdf.filename);
  });

  app.get("/api/student/certificates", async (c) => {
    const profile = await authenticatedStudentProfile(c);
    if (profile instanceof Response) return profile;
    return jsonPlain(c, await listCertificates(c, { personId: profile.personId, limit: clamp(c.req.query("limit"), 25, 1, 50), offset: clamp(c.req.query("offset"), 0, 0, 5000) }));
  });

  app.get("/api/student/certificates/:certificateId/pdf", async (c) => {
    const profile = await authenticatedStudentProfile(c);
    if (profile instanceof Response) return profile;
    const pdf = await getCertificatePdf(c, c.req.param("certificateId"), profile.personId);
    if (!pdf.ok) return jsonError(c, { status: httpStatus(pdf.status), code: pdf.code, message: pdf.message });
    return pdfResponse(pdf.bytes, pdf.filename);
  });

  app.get("/api/public/certificates/verify/:code", async (c) => {
    const limited = await enforcePublicVerifyLimit(c);
    if (limited) return limited;
    const result = await verifyCertificate(c, c.req.param("code"));
    return jsonPlain(c, {
      success: true,
      verification: {
        status: result.status,
        issuer: "Samyak Computer Classes, Sion",
        certificate: result.certificate,
      },
    });
  });

}

async function requireCertificateStaff(c: Parameters<typeof requireStaffRoles>[0]): Promise<StaffContext | null> {
  return requireStaffRoles(c, CERTIFICATE_STAFF_ROLES);
}

async function authenticatedStudentProfile(c: Parameters<typeof getSessionFromRequest>[0]) {
  const session = await getSessionFromRequest(c);
  if (!session) {
    const response = jsonError(c, { status: 401, code: "unauthenticated", message: "Please sign in again." });
    if (hasSessionCookie(c)) response.headers.append("Set-Cookie", clearSessionCookie(c));
    return response;
  }
  const view = await sessionView(c, session.record.login_account_id, session.record.active_person_id);
  if (!view.activeProfile) return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
  if (!view.activeProfile.effectiveRoles?.some((role) => role === "student" || role === "alumni")) {
    return jsonError(c, { status: 403, code: "student_profile_required", message: "This profile is not available." });
  }
  return { personId: view.activeProfile.personId };
}

function publicStaffCertificate(c: Parameters<typeof buildVerificationUrl>[0], certificate: Record<string, unknown>) {
  return {
    ...certificate,
    verification_url: buildVerificationUrl(c, String(certificate.verification_code)),
    pdf_storage_key: undefined,
    revocation_reason: undefined,
  };
}

function listQuery(c: Parameters<typeof getSessionFromRequest>[0]) {
  return {
    q: c.req.query("q")?.trim() || undefined,
    courseId: c.req.query("courseId")?.trim() || undefined,
    limit: clamp(c.req.query("limit"), 25, 1, 50),
    offset: clamp(c.req.query("offset"), 0, 0, 5000),
  };
}

function statusQuery(c: Parameters<typeof getSessionFromRequest>[0]) {
  const status = c.req.query("status");
  return status === "issued" || status === "revoked" || status === "superseded" ? status : undefined;
}

function clamp(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9_.-]/g, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function httpStatus(status: number) {
  if (status === 400) return 400;
  if (status === 401) return 401;
  if (status === 403) return 403;
  if (status === 404) return 404;
  if (status === 409) return 409;
  return 500;
}

async function enforcePublicVerifyLimit(c: Parameters<typeof getSessionFromRequest>[0]) {
  if (!c.env?.DB || !c.env.SESSION_PEPPER) return null;
  const eventType = "public_certificate_verify_ip";
  const keyHash = await hmacHex(c.env.SESSION_PEPPER, "public-certificate-ip", getClientIp(c));
  const since = new Date(Date.now() - PUBLIC_VERIFY_LIMIT.windowSeconds * 1000).toISOString();
  const count = await c.env.DB.prepare(
    `select count(*) as count
     from auth_events
     where organisation_id = ?
       and event_type = ?
       and ip_hash = ?
       and result_code <> 'RATE_LIMITED'
       and created_at >= ?`,
  )
    .bind(ORG_ID, eventType, keyHash, since)
    .first<{ count: number }>();
  if (Number(count?.count || 0) >= PUBLIC_VERIFY_LIMIT.count) {
    await recordPublicVerifyEvent(c, eventType, "RATE_LIMITED", keyHash);
    return jsonError(c, { status: 429, code: "rate_limited", message: "Please wait before trying again." });
  }
  await recordPublicVerifyEvent(c, eventType, "ALLOWED", keyHash);
  return null;
}

async function recordPublicVerifyEvent(c: Parameters<typeof getSessionFromRequest>[0], eventType: string, resultCode: string, keyHash: string) {
  await c.env.DB.prepare(
    `insert into auth_events
      (id, organisation_id, login_account_id, event_type, result_code, mobile_hash, mobile_last_four, ip_hash, user_agent_hash, created_at)
     values (?, ?, null, ?, ?, null, null, ?, ?, ?)`,
  )
    .bind(createOpaqueId("authevt"), ORG_ID, eventType, resultCode, keyHash, await hmacHex(c.env.SESSION_PEPPER, "public-certificate-ua", c.req.header("User-Agent") || ""), new Date().toISOString())
    .run();
}
