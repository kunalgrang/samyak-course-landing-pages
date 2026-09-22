import { describe, expect, it } from "vitest";
import {
  PlatformConfigurationError,
  certificateVerificationOrigin,
  publicPlatformConfig,
  referralPublicOrigin,
} from "./platform-config";

describe("platform public config", () => {
  it("reads current public origins through Worker config", () => {
    const config = publicPlatformConfig({
      REFERRAL_PUBLIC_ORIGIN: "https://go.samyaksion.com/",
      CERTIFICATE_VERIFICATION_ORIGIN: "https://go.samyaksion.com/",
    });

    expect(config).toEqual({
      referralPublicOrigin: "https://go.samyaksion.com",
      certificateVerificationOrigin: "https://go.samyaksion.com",
    });
    expect(referralPublicOrigin({ REFERRAL_PUBLIC_ORIGIN: "https://refer.samyaksion.com" })).toBe("https://refer.samyaksion.com");
    expect(certificateVerificationOrigin({ CERTIFICATE_VERIFICATION_ORIGIN: "https://go.samyaksion.com" })).toBe("https://go.samyaksion.com");
  });

  it("fails safely when required origins are missing or invalid", () => {
    expect(() => referralPublicOrigin({})).toThrow(PlatformConfigurationError);
    expect(() => certificateVerificationOrigin({ CERTIFICATE_VERIFICATION_ORIGIN: "go.samyaksion.com" })).toThrow(PlatformConfigurationError);
    expect(() => referralPublicOrigin({ REFERRAL_PUBLIC_ORIGIN: "https://go.samyaksion.com/path" })).toThrow(PlatformConfigurationError);
  });
});
