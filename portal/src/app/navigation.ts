import type { AppRoute } from "../routes/types";

export type NavigationItem = {
  path: AppRoute;
  label: string;
  shortLabel: string;
};

export const studentNavigation: NavigationItem[] = [
  { path: "/app", label: "Overview", shortLabel: "Overview" },
  { path: "/app/referrals", label: "My Referrals", shortLabel: "Referrals" },
  { path: "/app/rules", label: "Rewards & Benefits", shortLabel: "Rewards" },
  { path: "/app/profile", label: "My Profile", shortLabel: "Profile" },
];

// Backward-compatible export used by student-facing tests and existing imports.
export const appNavigation = studentNavigation;

export const staffNavigation: NavigationItem[] = [
  { path: "/app/enquiries", label: "Students & Enquiries", shortLabel: "Enquiries" },
  { path: "/app/courses", label: "Course Master", shortLabel: "Courses" },
  { path: "/app/discount-approvals", label: "Discount Approvals", shortLabel: "Approvals" },
  ...studentNavigation,
];
