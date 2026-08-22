import type { AppContext } from "./http";
import { getAccountRoles, getSessionFromRequest } from "./auth-store";

export const COURSE_ADMIN_ROLES = ["owner", "system_admin", "admin"] as const;
export const DISCOUNT_APPROVER_ROLES = ["owner"] as const;
export const OWNER_STUDENT_MAINTENANCE_ROLES = ["owner"] as const;
export const ADMISSION_STAFF_ROLES = ["owner", "system_admin", "admin", "counsellor", "admission_admin"] as const;
export const SENSITIVE_ADMISSION_ROLES = ["owner", "system_admin", "admission_admin"] as const;
export const RECEIPT_RECORDER_ROLES = ["owner", "system_admin", "admin", "admission_admin", "counsellor"] as const;
export const RECEIPT_BACKDATE_ROLES = ["owner", "system_admin", "admin", "admission_admin"] as const;

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

export function canRecordReceipts(staff: Pick<StaffContext, "roles">) {
  return staff.roles.some((role) => RECEIPT_RECORDER_ROLES.includes(role as (typeof RECEIPT_RECORDER_ROLES)[number]));
}

export function canBackdateReceipts(staff: Pick<StaffContext, "roles">) {
  return staff.roles.some((role) => RECEIPT_BACKDATE_ROLES.includes(role as (typeof RECEIPT_BACKDATE_ROLES)[number]));
}
