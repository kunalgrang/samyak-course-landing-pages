import { z } from "zod";
import type { WorkerBindings } from "../bindings";

export type OtpProviderName = "msg91" | "development";

export type OtpSendResult = {
  ok: boolean;
  providerRequestId?: string;
  resultCode: string;
};

export interface OtpProvider {
  readonly name: OtpProviderName;
  sendOtp(mobile: string): Promise<OtpSendResult>;
  resendOtp(mobile: string): Promise<OtpSendResult>;
  verifyOtp(mobile: string, otp: string): Promise<OtpSendResult>;
}

type Fetcher = typeof fetch;

const msg91ResponseSchema = z
  .object({
    type: z.string().optional(),
    message: z.union([z.string(), z.number()]).optional(),
    request_id: z.string().optional(),
  })
  .passthrough();

export class Msg91OtpProvider implements OtpProvider {
  readonly name = "msg91" as const;

  constructor(
    private readonly config: {
      authKey: string;
      templateId: string;
      senderId?: string;
      fetcher?: Fetcher;
      timeoutMs?: number;
    },
  ) {}

  async sendOtp(mobile: string) {
    const url = new URL("https://control.msg91.com/api/v5/otp");
    url.searchParams.set("template_id", this.config.templateId);
    url.searchParams.set("mobile", `91${mobile}`);
    url.searchParams.set("authkey", this.config.authKey);
    if (this.config.senderId) url.searchParams.set("sender", this.config.senderId);

    return this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  async resendOtp(mobile: string) {
    const url = new URL("https://control.msg91.com/api/v5/otp/retry");
    url.searchParams.set("authkey", this.config.authKey);
    url.searchParams.set("retrytype", "text");
    url.searchParams.set("mobile", `91${mobile}`);
    return this.request(url, { method: "GET", headers: { Accept: "application/json" } });
  }

  async verifyOtp(mobile: string, otp: string) {
    const url = new URL("https://control.msg91.com/api/v5/otp/verify");
    url.searchParams.set("otp", otp);
    url.searchParams.set("mobile", `91${mobile}`);
    return this.request(url, { method: "GET", headers: { Accept: "application/json", authkey: this.config.authKey } });
  }

  private async request(url: URL, init: RequestInit): Promise<OtpSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8000);
    try {
      const response = await (this.config.fetcher ?? fetch)(url.toString(), { ...init, signal: controller.signal });
      const data = msg91ResponseSchema.safeParse(await response.json().catch(() => ({})));
      if (!response.ok || !data.success) {
        return { ok: false, resultCode: "MSG91_HTTP_ERROR" };
      }
      const type = data.data.type?.toLowerCase();
      const message = String(data.data.message || "").toLowerCase();
      const ok = type === "success" || message.includes("success") || message.includes("verified");
      return {
        ok,
        providerRequestId: data.data.request_id || String(data.data.message || "") || undefined,
        resultCode: ok ? "MSG91_OK" : "MSG91_REJECTED",
      };
    } catch {
      return { ok: false, resultCode: "MSG91_UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class DevelopmentOtpProvider implements OtpProvider {
  readonly name = "development" as const;

  constructor(private readonly devOtp: string) {}

  async sendOtp() {
    return { ok: true, providerRequestId: "development", resultCode: "DEV_OTP_READY" };
  }

  async resendOtp() {
    return { ok: true, providerRequestId: "development", resultCode: "DEV_OTP_READY" };
  }

  async verifyOtp(_mobile: string, otp: string) {
    return { ok: otp === this.devOtp, providerRequestId: "development", resultCode: otp === this.devOtp ? "DEV_OK" : "DEV_INVALID" };
  }
}

export function hasMsg91Config(env: WorkerBindings) {
  return Boolean(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID);
}

export function canUseDevelopmentOtp(env: WorkerBindings, hostname: string) {
  return (
    env.ENVIRONMENT === "development" &&
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    Boolean(env.DEV_OTP) &&
    !hasMsg91Config(env)
  );
}

export function getOtpProvider(env: WorkerBindings, hostname: string, fetcher?: Fetcher): OtpProvider | null {
  if (hasMsg91Config(env)) {
    return new Msg91OtpProvider({
      authKey: env.MSG91_AUTH_KEY || "",
      templateId: env.MSG91_TEMPLATE_ID || "",
      senderId: env.MSG91_SENDER_ID,
      fetcher,
    });
  }

  if (canUseDevelopmentOtp(env, hostname) && env.DEV_OTP) {
    return new DevelopmentOtpProvider(env.DEV_OTP);
  }

  return null;
}
