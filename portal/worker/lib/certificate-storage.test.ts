import { describe, expect, it } from "vitest";
import { buildCertificatePdfKey, certificatePdfFilename, createMemoryCertificatePdfStorage } from "./certificate-storage";

const certificate = {
  id: "cert_123",
  organisation_id: "org_samyak",
  branch_id: "branch_sion",
  certificate_number: "SYK-SION-CERT-2026-000001",
  issue_date: "2026-08-14",
};

describe("certificate PDF storage", () => {
  it("builds deterministic private object keys without PII", () => {
    expect(buildCertificatePdfKey(certificate)).toBe("certificates/org_samyak/branch_sion/2026/syk-sion-cert-2026-000001.pdf");
    expect(buildCertificatePdfKey({ ...certificate, certificate_number: "SYK-SION-CERT-2026-../../1" })).toBe("certificates/org_samyak/branch_sion/2026/syk-sion-cert-2026-_1.pdf");
  });

  it("uses safe certificate-number filenames", () => {
    expect(certificatePdfFilename(certificate)).toBe("syk-sion-cert-2026-000001.pdf");
  });

  it("supports local/test memory storage round trips", async () => {
    const storage = createMemoryCertificatePdfStorage();
    const bytes = new TextEncoder().encode("%PDF-test");
    const key = buildCertificatePdfKey(certificate);

    await storage.put({ key, bytes, certificateId: certificate.id, certificateNumber: certificate.certificate_number, sha256: "abc123" });
    const stored = await storage.get(key);

    expect(stored?.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(await stored!.arrayBuffer())).toBe("%PDF-test");

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });
});
