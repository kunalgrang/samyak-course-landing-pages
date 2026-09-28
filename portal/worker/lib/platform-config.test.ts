import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PlatformConfigurationError,
  certificateVerificationOriginForOrganisation,
  certificateVerificationUrl,
  certificateVerificationOrigin,
  publicPlatformConfig,
  referralPublicOrigin,
} from "./platform-config";

describe("platform public config", () => {
  it("reads current public origins through Worker config", () => {
    const config = publicPlatformConfig({
      REFERRAL_PUBLIC_ORIGIN: "https://go.samyaksion.com/",
      CERTIFICATE_VERIFICATION_ORIGIN: "https://edu.rememo.in/",
    });

    expect(config).toEqual({
      referralPublicOrigin: "https://go.samyaksion.com",
      certificateVerificationOrigin: "https://edu.rememo.in",
    });
    expect(referralPublicOrigin({ REFERRAL_PUBLIC_ORIGIN: "https://refer.samyaksion.com" })).toBe("https://refer.samyaksion.com");
    expect(certificateVerificationOrigin({ CERTIFICATE_VERIFICATION_ORIGIN: "https://edu.rememo.in" })).toBe("https://edu.rememo.in");
    expect(certificateVerificationOriginForOrganisation(
      { CERTIFICATE_VERIFICATION_ORIGIN: "https://edu.rememo.in" },
      { organisationId: "org_demo" },
    )).toBe("https://edu.rememo.in");
    expect(certificateVerificationUrl(
      { CERTIFICATE_VERIFICATION_ORIGIN: "https://edu.rememo.in" },
      { organisationId: "org_demo", code: "CERT-ABC 123" },
    )).toBe("https://edu.rememo.in/verify/CERT-ABC%20123");
  });

  it("fails safely when required origins are missing or invalid", () => {
    expect(() => referralPublicOrigin({})).toThrow(PlatformConfigurationError);
    expect(() => certificateVerificationOrigin({ CERTIFICATE_VERIFICATION_ORIGIN: "go.samyaksion.com" })).toThrow(PlatformConfigurationError);
    expect(() => referralPublicOrigin({ REFERRAL_PUBLIC_ORIGIN: "https://go.samyaksion.com/path" })).toThrow(PlatformConfigurationError);
  });

  it("keeps the neutral canonical certificate origin and legacy verification routes in Worker config", () => {
    const wrangler = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");

    expect(wrangler).toContain('"CERTIFICATE_VERIFICATION_ORIGIN": "https://edu.rememo.in"');
    expect(wrangler).toContain('"pattern": "go.samyaksion.com/verify/*"');
    expect(wrangler).toContain('"pattern": "go.samyaksion.com/api/public/certificates/verify/*"');
    expect(wrangler).toContain('"run_worker_first": ["/api/*", "/verify/*"]');
  });
});
