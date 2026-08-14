import { describe, expect, it } from "vitest";
import { generateCertificateQrSvg } from "./certificate-qr";

describe("certificate QR", () => {
  it("round-trips the canonical verification URL without private identifiers", async () => {
    const url = "https://go.samyaksion.com/verify/SYK-7Q4M9PVK3X82AAAA";
    const svg = await generateCertificateQrSvg(url);

    expect(svg).toContain("<svg");
    expect(svg).toContain("Certificate verification QR");
    expect(svg).toContain(`data-verification-url="${url}"`);
    expect(svg).toContain(`<metadata>${url}</metadata>`);
    expect(svg).not.toContain("+918422969307");
    expect(svg).not.toContain("person_");
    expect(svg).not.toContain("student_");
    expect(svg).not.toContain("enrol_");
    expect(svg).not.toContain("Aadhaar");
  });
});
