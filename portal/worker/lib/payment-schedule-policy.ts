export function maximumInstallmentsForCourse(course: { duration_months?: number | null } | null | undefined) {
  const durationMonths = Number(course?.duration_months);
  if (!Number.isFinite(durationMonths) || durationMonths < 0.5) return 0;
  return Math.min(24, Math.max(1, Math.floor(durationMonths)));
}
