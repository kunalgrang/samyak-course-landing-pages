export type WorkerBindings = {
  DB: D1Database;
  MSG91_AUTH_KEY: string;
  MSG91_TEMPLATE_ID: string;
  TURNSTILE_SECRET_KEY: string;
  REFERRAL_APPS_SCRIPT_URL: string;
  REFERRAL_API_SECRET: string;
  SESSION_PEPPER: string;
};

export type WorkerVariables = {
  requestId: string;
};
