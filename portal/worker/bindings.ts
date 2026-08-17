export type WorkerBindings = {
  DB: D1Database;
  ENVIRONMENT: "development" | "preview" | "staging" | "production";
  REFERRAL_PUBLIC_ALLOWED_ORIGINS?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  MSG91_AUTH_KEY?: string;
  MSG91_TEMPLATE_ID?: string;
  MSG91_SENDER_ID?: string;
  SESSION_PEPPER: string;
  REFERRAL_TOKEN_PEPPER?: string;
  CERTIFICATE_VERIFICATION_ORIGIN?: string;
  CERTIFICATE_PDFS?: R2Bucket;
  DEV_OTP?: string;
};

export type WorkerVariables = {
  requestId: string;
};
