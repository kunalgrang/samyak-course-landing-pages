export type WorkerBindings = {
  DB: D1Database;
  ENVIRONMENT: "development" | "preview" | "production";
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  PORTAL_APPS_SCRIPT_URL: string;
  PORTAL_APPS_SCRIPT_SECRET: string;
  MSG91_AUTH_KEY?: string;
  MSG91_TEMPLATE_ID?: string;
  MSG91_SENDER_ID?: string;
  SESSION_PEPPER: string;
  DEV_OTP?: string;
};

export type WorkerVariables = {
  requestId: string;
};
