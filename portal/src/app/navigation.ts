import type { RoutePath } from "../routes/types";

export type NavigationItem = {
  path: RoutePath;
  label: string;
  shortLabel: string;
};

export const studentNavigation: NavigationItem[] = [
  { path: "/student/dashboard", label: "Overview", shortLabel: "Overview" },
  { path: "/student/certificates", label: "Certificates", shortLabel: "Certs" },
  { path: "/student/referrals", label: "My Referrals", shortLabel: "Referrals" },
  { path: "/student/rules", label: "Rewards & Benefits", shortLabel: "Rewards" },
  { path: "/student/profile", label: "My Profile", shortLabel: "Profile" },
];

// Backward-compatible export used by student-facing tests and existing imports.
export const appNavigation: NavigationItem[] = [
  { path: "/app", label: "Overview", shortLabel: "Overview" },
  { path: "/app/referrals", label: "My Referrals", shortLabel: "Referrals" },
  { path: "/app/rules", label: "Rewards & Benefits", shortLabel: "Rewards" },
  { path: "/app/profile", label: "My Profile", shortLabel: "Profile" },
];

export const staffNavigation: NavigationItem[] = [
  { path: "/app/enquiries", label: "Enquiries", shortLabel: "Enquiries" },
  { path: "/app/students", label: "Students", shortLabel: "Students" },
  { path: "/app/batches", label: "Batches", shortLabel: "Batches" },
  { path: "/app/education-partners", label: "Education Partners", shortLabel: "Partners" },
  { path: "/app/referral-operations", label: "Referral Operations", shortLabel: "Ref Ops" },
  { path: "/app/courses", label: "Course Master", shortLabel: "Courses" },
  { path: "/app/certificates", label: "Certificates", shortLabel: "Certs" },
  { path: "/app/discount-approvals", label: "Discount Approvals", shortLabel: "Approvals" },
];
