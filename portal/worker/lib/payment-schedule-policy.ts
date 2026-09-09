export function maximumInstallmentsForCourse(course: { duration_months?: number | null } | null | undefined) {
  const durationMonths = Number(course?.duration_months);
  return Number.isInteger(durationMonths) && durationMonths >= 1 ? durationMonths : 3;
}
