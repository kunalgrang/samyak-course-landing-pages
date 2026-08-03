import type { AppContext } from "./http";
import { getAccountRoles, getSessionFromRequest } from "./auth-store";

export const COURSE_ADMIN_ROLES = ["owner", "system_admin", "admin"] as const;
export const DISCOUNT_APPROVER_ROLES = ["owner"] as const;
export const ADMISSION_STAFF_ROLES = ["owner", "system_admin", "admin", "counsellor", "admission_admin"] as const;
export const SENSITIVE_ADMISSION_ROLES = ["owner", "system_admin", "admission_admin"] as const;

export type StaffContext = {
  loginAccountId: string;
  activePersonId: string | null;
  roles: string[];
};

export async function requireStaffRoles(c: AppContext, allowedRoles: readonly string[]): Promise<StaffContext | null> {
  const session = await getSessionFromRequest(c);
  if (!session) return null;
  const roles = await getAccountRoles(c, session.record.login_account_id);
  if (!roles.some((role) => allowedRoles.includes(role))) return null;
  return {
    loginAccountId: session.record.login_account_id,
    activePersonId: session.record.active_person_id,
    roles,
  };
}
