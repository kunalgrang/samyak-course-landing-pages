import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCertificateRoutes } from "./certificates";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  listEligibleCertificates: vi.fn(),
  listCertificates: vi.fn(),
  issueCertificate: vi.fn(),
  revokeCertificate: vi.fn(),
  verifyCertificate: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
  hasSessionCookie: vi.fn(() => false),
  clearSessionCookie: vi.fn(() => ""),
  sessionView: vi.fn(() => ({
    activeProfile: { personId: "person_1", effectiveRoles: ["student"] },
  })),
}));

vi.mock("../lib/certificate-service", () => ({
  buildVerificationUrl: vi.fn((_c, code: string) => `https://go.samyaksion.com/verify/${code}`),
  getCertificateById: vi.fn(),
  getCertificatePdf: vi.fn(),
  issueCertificate: mocks.issueCertificate,
  listCertificates: mocks.listCertificates,
  listEligibleCertificates: mocks.listEligibleCertificates,
  revokeCertificate: mocks.revokeCertificate,
  verifyCertificate: mocks.verifyCertificate,
}));

function routeApp() {
  const app = new Hono();
  registerCertificateRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[]) {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: "person_test" },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("certificate routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listEligibleCertificates.mockResolvedValue({ items: [], pagination: { limit: 25, offset: 0, hasMore: false } });
    mocks.listCertificates.mockResolvedValue({ items: [], pagination: { limit: 25, offset: 0, hasMore: false } });
    mocks.issueCertificate.mockResolvedValue({
      ok: true,
      idempotent: false,
      certificate: {
        id: "cert_1",
        certificate_number: "SYK-SION-CERT-2026-000001",
        verification_code: "SYK-CODE",
        pdf_storage_key: "certificates/org_samyak/branch_sion/2026/cert.pdf",
        revocation_reason: "internal note",
      },
    });
    mocks.revokeCertificate.mockResolvedValue({ ok: true });
  });

  it.each(["owner", "admin", "system_admin", "counsellor", "admission_admin"])("allows %s to read and issue", async (role) => {
    const app = routeApp();
    authenticateAs([role]);

    const list = await app.request("/api/staff/certificates/eligible");
    const issue = await app.request("/api/staff/certificates/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrolmentId: "enrol_1", issueDate: "2026-08-14" }),
    });

    expect(list.status).toBe(200);
    expect(issue.status).toBe(201);
    await expect(issue.json()).resolves.not.toMatchObject({ certificate: { pdf_storage_key: expect.any(String), revocation_reason: expect.any(String) } });
    expect(mocks.issueCertificate).toHaveBeenCalledTimes(1);
  });

  it("denies staff revocation and allows owner revocation", async () => {
    const app = routeApp();
    authenticateAs(["admin"]);
    const denied = await app.request("/api/staff/certificates/cert_1/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Incorrect student name" }),
    });
    authenticateAs(["owner"]);
    const allowed = await app.request("/api/staff/certificates/cert_1/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Incorrect student name" }),
    });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(mocks.revokeCertificate).toHaveBeenCalledTimes(1);
  });

  it("returns privacy-safe public verification responses", async () => {
    const app = routeApp();
    mocks.verifyCertificate.mockResolvedValue({
      status: "valid",
      certificate: {
        certificate_number: "SYK-SION-CERT-2026-000001",
        student_name_snapshot: "Asha Shah",
        student_id_snapshot: "SYK-SION-2026-000123",
        course_name_snapshot: "Full Stack",
        issue_date: "2026-08-14",
      },
    });

    const response = await app.request("/api/public/certificates/verify/SYK-7Q4M9PVK3X82AAAA");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("mobile");
    expect(JSON.stringify(body)).not.toContain("aadhaar");
    expect(JSON.stringify(body)).not.toContain("verification_code");
    expect(JSON.stringify(body)).not.toContain("revocation_reason");
  });

  it("returns a self-contained valid public verification HTML page", async () => {
    const app = routeApp();
    mocks.verifyCertificate.mockResolvedValue({
      status: "valid",
      certificate: {
        certificate_number: "SYK-SION-CERT-2026-000001",
        student_name_snapshot: "Shahid Khan",
        student_id_snapshot: "SYK-SION-000002",
        course_name_snapshot: "ADOBE PHOTOSHOP",
        issue_date: "2026-08-17",
        completion_date_snapshot: null,
      },
    });

    const response = await app.request("/verify/SYK-7Q4M9PVK3X82AAAA");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html; charset=UTF-8");
    expect(html).toContain("Certificate Verified");
    expect(html).toContain("VALID");
    expect(html).toContain("Shahid Khan");
    expect(html).toContain("SYK-SION-000002");
    expect(html).toContain("ADOBE PHOTOSHOP");
    expect(html).toContain("SYK-SION-CERT-2026-000001");
    expect(html).toContain("17 Aug 2026");
    expect(html).not.toContain("Completion Date");
    expect(html).not.toContain("SYK-7Q4M9PVK3X82AAAA");
    expect(html).not.toContain("<script");
  });

  it.each([
    ["revoked", "REVOKED"],
    ["superseded", "SUPERSEDED"],
  ])("renders %s public verification state", async (status, label) => {
    const app = routeApp();
    mocks.verifyCertificate.mockResolvedValue({
      status,
      certificate: {
        certificate_number: "SYK-SION-CERT-2026-000001",
        student_name_snapshot: "Asha Shah",
        student_id_snapshot: "SYK-SION-000123",
        course_name_snapshot: "Full Stack",
        issue_date: "2026-08-17",
        completion_date_snapshot: "2026-08-10",
      },
    });

    const response = await app.request("/verify/SYK-7Q4M9PVK3X82AAAA");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(label);
    expect(html).toContain("Completion Date");
  });

  it.each(["SYK-UNKNOWNUNKNOWN1", "bad-code"])("renders generic not-found HTML for %s", async (code) => {
    const app = routeApp();
    mocks.verifyCertificate.mockResolvedValue({ status: "not_found", certificate: null });

    const response = await app.request(`/verify/${code}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Certificate Not Found");
    expect(html).toContain("NOT FOUND");
    expect(html).not.toContain("database");
    expect(html).not.toContain(code);
  });

  it("escapes certificate snapshot values and only renders approved public fields", async () => {
    const app = routeApp();
    mocks.verifyCertificate.mockResolvedValue({
      status: "valid",
      certificate: {
        certificate_number: "SYK-SION-CERT-2026-000001",
        student_name_snapshot: "Asha <script>alert(1)</script> & Shah",
        student_id_snapshot: "SYK-SION-000123",
        course_name_snapshot: "Design <b>Pro</b>",
        issue_date: "2026-08-17",
        completion_date_snapshot: null,
        verification_code: "SYK-SECRETSECRET12",
        person_id: "person_secret",
        student_id: "student_secret",
        enrolment_id: "enrol_secret",
        course_id: "course_secret",
        pdf_storage_key: "certificates/org/branch/file.pdf",
        pdf_sha256: "sha_secret",
        mobile: "9876543210",
        email: "student@example.com",
        aadhaar: "123412341234",
        fee: "FEE_SECRET",
      },
    });

    const response = await app.request("/verify/SYK-7Q4M9PVK3X82AAAA");
    const html = await response.text();

    expect(html).toContain("Asha &lt;script&gt;alert(1)&lt;/script&gt; &amp; Shah");
    expect(html).toContain("Design &lt;b&gt;Pro&lt;/b&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("SYK-SECRETSECRET12");
    expect(html).not.toContain("person_secret");
    expect(html).not.toContain("student_secret");
    expect(html).not.toContain("enrol_secret");
    expect(html).not.toContain("course_secret");
    expect(html).not.toContain("certificates/org/branch/file.pdf");
    expect(html).not.toContain("sha_secret");
    expect(html).not.toContain("9876543210");
    expect(html).not.toContain("student@example.com");
    expect(html).not.toContain("123412341234");
    expect(html).not.toContain("FEE_SECRET");
  });

  it("sets noindex and self-contained security headers on the public verification page", async () => {
    const app = routeApp();
    mocks.verifyCertificate.mockResolvedValue({ status: "not_found", certificate: null });

    const response = await app.request("/verify/SYK-7Q4M9PVK3X82AAAA");
    const html = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/html; charset=UTF-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("script-src");
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it("does not expose public QR lookup by internal certificate id", async () => {
    const app = routeApp();

    const response = await app.request("/api/public/certificates/cert_1/qr.svg");

    expect(response.status).toBe(404);
  });

  it("rate limits public verification by hashed client ip", async () => {
    const app = routeApp();
    const db = rateLimitDb(120);

    const response = await app.request(
      "/api/public/certificates/verify/SYK-7Q4M9PVK3X82AAAA",
      { headers: { "CF-Connecting-IP": "203.0.113.10" } },
      { DB: db, SESSION_PEPPER: "test-session-pepper" } as never,
    );

    expect(response.status).toBe(429);
    expect(mocks.verifyCertificate).not.toHaveBeenCalled();
    expect(db.inserted).toBe(1);
  });
});

function rateLimitDb(count: number) {
  return {
    inserted: 0,
    prepare(sql: string) {
      return {
        bind: (..._params: unknown[]) => ({
          first: async () => ({ count }),
          run: async () => {
            this.inserted += sql.includes("insert into auth_events") ? 1 : 0;
            return { success: true };
          },
        }),
      };
    },
  };
}
