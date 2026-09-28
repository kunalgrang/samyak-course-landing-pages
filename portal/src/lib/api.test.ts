import { describe, expect, it, vi } from "vitest";
import { ApiError, getHealth, getSession, requestOtp } from "./api";

describe("getHealth", () => {
  it("parses the health response contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          service: "samyak-student-portal",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual({
      success: true,
      service: "samyak-student-portal",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });
  });
});

describe("getSession", () => {
  it("accepts account roles and effective roles from the Worker session response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          authenticated: true,
          activeProfile: {
            personId: "person_stu1",
            publicName: "Asha",
            accessType: "self",
            roles: ["student"],
            effectiveRoles: ["student", "counsellor"],
          },
          profiles: [
            {
              personId: "person_stu1",
              publicName: "Asha",
              accessType: "self",
              roles: ["student"],
            },
          ],
          mobileLastFour: "3210",
          accountRoles: ["counsellor"],
          requestId: "req_test",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSession()).resolves.toMatchObject({
      authenticated: true,
      accountRoles: ["counsellor"],
      activeProfile: expect.objectContaining({ effectiveRoles: ["student", "counsellor"] }),
      profiles: [expect.objectContaining({ effectiveRoles: [] })],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });
});

describe("API errors", () => {
  it("preserves top-level Worker error code and message for OTP calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ success: false, code: "RATE_LIMITED", message: "Please wait before requesting another OTP." }),
      }),
    );

    await expect(requestOtp("9876543210", "turnstile-token")).rejects.toMatchObject({
      message: "Please wait before requesting another OTP.",
      code: "RATE_LIMITED",
    });
    await expect(requestOtp("9876543210", "turnstile-token")).rejects.toBeInstanceOf(ApiError);
  });
});
