import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { jsonPlain } from "../lib/json-response";
import { canUseDevelopmentOtp, hasMsg91Config } from "../lib/otp-provider";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function registerConfigRoutes(app: PortalHono) {
  app.get("/api/public-config", (c) => {
    const hostname = new URL(c.req.url).hostname;
    return jsonPlain(c, {
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || "",
      otpEnabled: hasMsg91Config(c.env) || canUseDevelopmentOtp(c.env, hostname),
      googleReviewUrl: safeHttpsUrl(c.env.GOOGLE_REVIEW_URL),
    });
  });
}

function safeHttpsUrl(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
