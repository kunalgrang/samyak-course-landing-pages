import { z } from "zod";
import type { WorkerBindings } from "../bindings";

const turnstileResponseSchema = z
  .object({
    success: z.boolean(),
    hostname: z.string().optional(),
    action: z.string().optional(),
    "error-codes": z.array(z.string()).optional(),
  })
  .passthrough();

export async function validateTurnstile({
  env,
  token,
  expectedAction,
  hostname,
  remoteIp,
  fetcher = fetch,
}: {
  env: WorkerBindings;
  token: string;
  expectedAction: string;
  hostname: string;
  remoteIp?: string;
  fetcher?: typeof fetch;
}) {
  if (!env.TURNSTILE_SECRET_KEY || !token) return { ok: false, resultCode: "TURNSTILE_MISSING" };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = turnstileResponseSchema.safeParse(await response.json().catch(() => ({})));
    if (!response.ok || !parsed.success || !parsed.data.success) return { ok: false, resultCode: "TURNSTILE_REJECTED" };
    if (parsed.data.action && parsed.data.action !== expectedAction) return { ok: false, resultCode: "TURNSTILE_ACTION_MISMATCH" };
    if (env.ENVIRONMENT === "production" && parsed.data.hostname && parsed.data.hostname !== hostname) {
      return { ok: false, resultCode: "TURNSTILE_HOSTNAME_MISMATCH" };
    }
    return { ok: true, resultCode: "TURNSTILE_OK" };
  } catch {
    return { ok: false, resultCode: "TURNSTILE_UNAVAILABLE" };
  }
}
