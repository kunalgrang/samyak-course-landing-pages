import { hmacHex, randomBase64Url } from "./crypto";

export const REFERRAL_TOKEN_VERSION = 1;
export const REFERRAL_TOKEN_BYTES = 32;
const REFERRAL_TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;

export class ReferralTokenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralTokenConfigurationError";
  }
}

export function requireReferralTokenPepper(pepper: string) {
  if (typeof pepper !== "string" || pepper.trim().length < 16) {
    throw new ReferralTokenConfigurationError("REFERRAL_TOKEN_PEPPER is not configured.");
  }
  return pepper;
}

export function generateReferralToken() {
  return randomBase64Url(REFERRAL_TOKEN_BYTES);
}

export function validateReferralTokenFormat(rawToken: string) {
  return REFERRAL_TOKEN_FORMAT.test(rawToken.trim());
}

export async function hashReferralToken(rawToken: string, pepper: string, version = REFERRAL_TOKEN_VERSION) {
  const token = rawToken.trim();
  if (!validateReferralTokenFormat(token)) throw new Error("Invalid referral token shape");
  const scopedInput = `samyak-referral-link:v${version}:${token}`;
  return hmacHex(requireReferralTokenPepper(pepper), "referral-token-lookup", scopedInput);
}

export function referralTokenLastFour(rawToken: string) {
  return rawToken.trim().slice(-4);
}

export function maskReferralToken(rawToken: string) {
  return `...${referralTokenLastFour(rawToken)}`;
}
