import { describe, expect, it } from "vitest";
import { applySessionRefreshError, applySessionRefreshSuccess } from "./AuthContext";
import type { SessionResponse } from "../../lib/api";

const authenticatedSession: SessionResponse = {
  authenticated: true,
  activeProfile: {
    personId: "person_stu1",
    publicName: "Asha",
    accessType: "self",
    roles: ["student"],
    effectiveRoles: ["student"],
  },
  profiles: [
    {
      personId: "person_stu1",
      publicName: "Asha",
      accessType: "self",
      roles: ["student"],
      effectiveRoles: [],
    },
  ],
  mobileLastFour: "3210",
  accountRoles: [],
};

describe("AuthContext session refresh state", () => {
  it("does not clear an existing authenticated session on a temporary network error", () => {
    const previous = applySessionRefreshSuccess(authenticatedSession);
    const next = applySessionRefreshError(previous);

    expect(next.session).toBe(authenticatedSession);
    expect(next.hasSessionError).toBe(true);
  });

  it("keeps the expired-session message only for an unauthenticated session response", () => {
    const next = applySessionRefreshSuccess({
      authenticated: false,
      activeProfile: null,
      profiles: [],
      accountRoles: [],
      message: "Your session has expired. Please sign in again.",
    });

    expect(next.session).toBeNull();
    expect(next.sessionMessage).toBe("Your session has expired. Please sign in again.");
  });
});
