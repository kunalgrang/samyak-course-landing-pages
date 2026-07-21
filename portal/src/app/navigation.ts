import type { AppRoute } from "../routes/types";

export const appNavigation: Array<{
  path: AppRoute;
  label: string;
  shortLabel: string;
}> = [
  { path: "/app", label: "Overview", shortLabel: "Home" },
  { path: "/app/referrals", label: "Referrals", shortLabel: "Refer" },
  { path: "/app/rules", label: "Rules", shortLabel: "Rules" },
  { path: "/app/profile", label: "Profile", shortLabel: "Profile" },
];
