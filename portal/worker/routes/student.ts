import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { fetchDashboardForActiveProfile, getSessionFromRequest, sessionView } from "../lib/auth-store";
import { jsonError, jsonPlain } from "../lib/json-response";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

export function registerStudentRoutes(app: PortalHono) {
  app.get("/api/student/referrals", async (c) => {
    const session = await getSessionFromRequest(c);
    if (!session) {
      return jsonError(c, { status: 401, code: "unauthenticated", message: "Please sign in again." });
    }
    const view = await sessionView(c, session.record.login_account_id, session.record.active_person_id);
    if (!view.activeProfile) {
      return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
    }
    try {
      return jsonPlain(c, await fetchDashboardForActiveProfile(c, view.activeProfile.personId));
    } catch {
      return jsonError(c, { status: 503, code: "dashboard_unavailable", message: "Referral dashboard is temporarily unavailable." });
    }
  });
}
