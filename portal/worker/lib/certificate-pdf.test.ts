import { describe, expect, it } from "vitest";
import { generateCertificatePdf } from "./certificate-pdf";
import type { CertificateRecord } from "./certificate-service";

describe("certificate PDF generation", () => {
  it("uses certificate snapshots and omits unknown completion dates and private data", async () => {
    const certificate = sampleCertificate({ completion_date_snapshot: null });
    const result = await generateCertificatePdf({
      certificate,
      verificationUrl: "https://go.samyaksion.com/verify/SYK-ABC1234567890XYZ",
    });
    const text = new TextDecoder().decode(result.bytes);

    expect(text).toContain("CERTIFICATE OF COMPLETION");
    expect(text).toContain("SAMYAK COMPUTER CLASSES");
    expect(text).not.toContain("SAMYAK COMPUTER CLASSES, SION");
    expect(text).toContain("Asha Shah");
    expect(text).toContain("SYK-SION-CERT-2026-000001");
    expect(text).not.toContain("Course Code");
    expect(text).not.toContain("SYK-WDD-001");
    expect(text).toContain("/Sig Do");
    expect(text).toContain("Branch Director");
    expect(text).toContain("info@samyaksion.com");
    expect(text.match(/A unit of Shree Services/g)).toHaveLength(1);
    expect(text).not.toContain("Unknown");
    expect(text).not.toContain("Grade");
    expect(text).not.toContain("Aadhaar");
    expect(text).not.toContain("fees");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("includes completion date only when the snapshot has one", async () => {
    const result = await generateCertificatePdf({
      certificate: sampleCertificate({ completion_date_snapshot: "2026-08-10" }),
      verificationUrl: "https://go.samyaksion.com/verify/SYK-ABC1234567890XYZ",
    });

    expect(new TextDecoder().decode(result.bytes)).toContain("Completion Date: 10-08-2026");
  });
});

function sampleCertificate(overrides: Partial<CertificateRecord> = {}): CertificateRecord {
  return {
    id: "cert_1",
    organisation_id: "org_samyak",
    branch_id: "branch_sion",
    certificate_number: "SYK-SION-CERT-2026-000001",
    verification_code: "SYK-ABC1234567890XYZ",
    person_id: "person_1",
    student_id: "student_1",
    enrolment_id: "enrol_1",
    course_id: "course_1",
    student_name_snapshot: "Asha Shah",
    student_id_snapshot: "SYK-SION-2026-000123",
    course_name_snapshot: "FULL STACK COURSE - 6 MONTHS",
    course_code_snapshot: "SYK-WDD-001",
    course_duration_months_snapshot: 6,
    course_duration_label_snapshot: "6 months",
    joining_date_snapshot: "2026-02-01",
    completion_date_snapshot: null,
    issue_date: "2026-08-14",
    template_id: "ctpl_samyak_completion_v1",
    template_version_snapshot: 1,
    status: "issued",
    pdf_storage_key: null,
    pdf_sha256: null,
    issued_by_actor_id: "acct_staff",
    issued_at: "2026-08-14T00:00:00.000Z",
    revoked_at: null,
    revoked_by_actor_id: null,
    revocation_reason: null,
    supersedes_certificate_id: null,
    superseded_by_certificate_id: null,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}
