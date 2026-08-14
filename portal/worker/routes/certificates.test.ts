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

vi.mock("../lib/certificate-qr", () => ({
  generateCertificateQrSvg: vi.fn(() => "<svg></svg>"),
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
      certificate: { id: "cert_1", certificate_number: "SYK-SION-CERT-2026-000001", verification_code: "SYK-CODE" },
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
    expect(JSON.stringify(body)).not.toContain("revocation_reason");
  });
});
