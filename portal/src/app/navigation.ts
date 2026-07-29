import type { AppRoute } from "../routes/types";

export const appNavigation: Array<{
  path: AppRoute;
  label: string;
  shortLabel: string;
}> = [
  { path: "/app", label: "Overview", shortLabel: "Overview" },
  { path: "/app/referrals", label: "My Referrals", shortLabel: "My Referrals" },
  { path: "/app/rules", label: "Rewards & Benefits", shortLabel: "Rewards" },
  { path: "/app/profile", label: "My Profile", shortLabel: "My Profile" },
];
