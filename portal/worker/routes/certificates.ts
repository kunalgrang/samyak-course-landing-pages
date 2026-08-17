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

  app.get("/verify/:code", async (c) => {
    const result = await verifyCertificate(c, c.req.param("code"));
    return certificateVerifyHtmlResponse(result);
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

function certificateVerifyHtmlResponse(result: Awaited<ReturnType<typeof verifyCertificate>>) {
  const status = result.status;
  const certificate = result.certificate || {};
  const isFound = status !== "not_found" && result.certificate;
  const title = isFound ? "Certificate Verification" : "Certificate Not Found";
  const statusLabel = statusTitle(status);
  const statusClass = status === "valid" ? "valid" : status === "revoked" ? "revoked" : status === "superseded" ? "superseded" : "not-found";
  const rows = isFound
    ? [
        ["Student", certificate.student_name_snapshot],
        ["Student ID", certificate.student_id_snapshot],
        ["Course", certificate.course_name_snapshot],
        ["Certificate No.", certificate.certificate_number],
        ["Issue Date", formatPublicDate(certificate.issue_date)],
        ...(certificate.completion_date_snapshot ? [["Completion Date", formatPublicDate(certificate.completion_date_snapshot)] as const] : []),
      ]
    : [];
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)} | Samyak Computer Classes</title>
  <style>
    :root { color-scheme: light; --ink: #15212f; --muted: #5d6875; --line: #d7dee8; --gold: #b78b2a; --green: #147a43; --red: #a83232; --amber: #946200; --bg: #f6f8fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: Arial, Helvetica, sans-serif; background: var(--bg); color: var(--ink); }
    main { width: min(100%, 760px); margin: 0 auto; padding: 28px 16px; }
    .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 28px; box-shadow: 0 14px 40px rgba(21, 33, 47, 0.08); }
    .brand { text-align: center; border-bottom: 1px solid var(--line); padding-bottom: 18px; margin-bottom: 22px; }
    .brand strong { display: block; font-size: 19px; letter-spacing: 0; }
    .brand span { display: block; color: var(--muted); margin-top: 5px; font-size: 14px; }
    h1 { margin: 0 0 14px; text-align: center; font-size: 26px; line-height: 1.2; }
    .status { margin: 0 auto 22px; width: fit-content; max-width: 100%; border-radius: 999px; padding: 10px 16px; font-weight: 700; letter-spacing: 0; }
    .status.valid { color: var(--green); background: #eaf7ef; }
    .status.revoked { color: var(--red); background: #fdecec; }
    .status.superseded { color: var(--amber); background: #fff6df; }
    .status.not-found { color: var(--muted); background: #eef2f6; }
    dl { margin: 0; border-top: 1px solid var(--line); }
    .row { display: grid; grid-template-columns: minmax(112px, 190px) 1fr; gap: 16px; border-bottom: 1px solid var(--line); padding: 14px 0; }
    dt { color: var(--muted); font-size: 14px; }
    dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
    .message { color: var(--muted); text-align: center; line-height: 1.55; margin: 0 0 20px; }
    footer { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); text-align: center; font-size: 14px; line-height: 1.6; }
    footer strong { color: var(--ink); }
    @media (max-width: 480px) {
      main { padding: 16px 12px; }
      .panel { padding: 22px 18px; }
      h1 { font-size: 23px; }
      .row { grid-template-columns: 1fr; gap: 5px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel" aria-labelledby="verify-title">
      <div class="brand">
        <strong>SAMYAK COMPUTER CLASSES</strong>
        <span>Certificate Verification</span>
      </div>
      <h1 id="verify-title">${isFound ? "Certificate Verified" : "Certificate Not Found"}</h1>
      <p class="status ${statusClass}">${escapeHtml(statusLabel)}</p>
      ${isFound ? `<dl>${rows.map(([label, value]) => `<div class="row"><dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value || ""))}</dd></div>`).join("")}</dl>` : `<p class="message">We could not verify this certificate. Please check the QR code or contact Samyak Computer Classes for support.</p>`}
      <footer>
        <strong>Samyak Computer Classes</strong><br>
        Sion West, Mumbai<br>
        A Unit of Shree Services<br>
        info@samyaksion.com<br>
        +91 8422969307
      </footer>
    </section>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store, no-transform",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function statusTitle(status: string) {
  if (status === "valid") return "VALID";
  if (status === "revoked") return "REVOKED";
  if (status === "superseded") return "SUPERSEDED";
  return "NOT FOUND";
}

function formatPublicDate(value: unknown) {
  if (!value || typeof value !== "string") return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : value;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
