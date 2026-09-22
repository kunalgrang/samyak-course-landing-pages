import type { WorkerBindings } from "../bindings";

export class PlatformConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformConfigurationError";
  }
}

export type PublicPlatformConfig = {
  referralPublicOrigin: string;
  certificateVerificationOrigin: string;
};

export function publicPlatformConfig(env: Pick<WorkerBindings, "REFERRAL_PUBLIC_ORIGIN" | "CERTIFICATE_VERIFICATION_ORIGIN">): PublicPlatformConfig {
  return {
    referralPublicOrigin: requiredOrigin(env.REFERRAL_PUBLIC_ORIGIN, "REFERRAL_PUBLIC_ORIGIN"),
    certificateVerificationOrigin: requiredOrigin(env.CERTIFICATE_VERIFICATION_ORIGIN, "CERTIFICATE_VERIFICATION_ORIGIN"),
  };
}

export function referralPublicOrigin(env: Pick<WorkerBindings, "REFERRAL_PUBLIC_ORIGIN">) {
  return requiredOrigin(env.REFERRAL_PUBLIC_ORIGIN, "REFERRAL_PUBLIC_ORIGIN");
}

export function certificateVerificationOrigin(env: Pick<WorkerBindings, "CERTIFICATE_VERIFICATION_ORIGIN">) {
  return requiredOrigin(env.CERTIFICATE_VERIFICATION_ORIGIN, "CERTIFICATE_VERIFICATION_ORIGIN");
}

function requiredOrigin(value: string | undefined, bindingName: string) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) throw new PlatformConfigurationError(`${bindingName} is not configured.`);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PlatformConfigurationError(`${bindingName} must be a valid origin.`);
  }
  if (url.origin !== text || !["https:", "http:"].includes(url.protocol)) {
    throw new PlatformConfigurationError(`${bindingName} must be an origin URL.`);
  }
  return text;
}
