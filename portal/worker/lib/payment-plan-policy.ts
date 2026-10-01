import type { AppContext } from "./http";

export type PaymentPlanType = "full" | "two_instalments" | "three_instalments" | "custom";

export type PaymentPlanPolicyRule = {
  planType: PaymentPlanType;
  fixedInstalments: number | null;
  minDurationMonths: number;
  maxDurationMonths: number | null;
};

export type PaymentPlanPolicy =
  | {
      ok: true;
      durationMonths: number;
      rules: PaymentPlanPolicyRule[];
      plans: Map<PaymentPlanType, PaymentPlanPolicyRule>;
    }
  | {
      ok: false;
      code: "invalid_course_duration" | "payment_plan_policy_missing" | "payment_plan_policy_ambiguous";
      message: string;
    };

const FIXED_PLAN_COUNTS: Partial<Record<PaymentPlanType, number>> = {
  full: 1,
  two_instalments: 2,
  three_instalments: 3,
};
export const MAX_PAYMENT_PLAN_INSTALMENTS = 24;

export async function resolvePaymentPlanPolicy(c: AppContext, organisationId: string, course: { duration_months?: number | null }): Promise<PaymentPlanPolicy> {
  const durationMonths = Number(course.duration_months);
  if (!Number.isFinite(durationMonths) || durationMonths < 0.5) {
    return { ok: false, code: "invalid_course_duration", message: "Selected course must have a duration of at least 0.5 months." };
  }

  const rows = await c.env.DB.prepare(
    `select plan_type, fixed_instalments, min_duration_months, max_duration_months
     from payment_plan_rules
     where organisation_id = ?
       and is_active = 1
       and ? >= min_duration_months
       and (max_duration_months is null or ? <= max_duration_months)
     order by min_duration_months, coalesce(max_duration_months, 999999), plan_type, fixed_instalments`,
  )
    .bind(organisationId, durationMonths, durationMonths)
    .all<Record<string, unknown>>();

  const rules = (rows.results || []).map((row) => ({
    planType: String(row.plan_type) as PaymentPlanType,
    fixedInstalments: row.fixed_instalments == null ? null : Number(row.fixed_instalments),
    minDurationMonths: Number(row.min_duration_months),
    maxDurationMonths: row.max_duration_months == null ? null : Number(row.max_duration_months),
  }));
  if (!rules.length) {
    return { ok: false, code: "payment_plan_policy_missing", message: "No payment plan policy is configured for this course duration." };
  }

  const plans = new Map<PaymentPlanType, PaymentPlanPolicyRule>();
  for (const rule of rules) {
    if (plans.has(rule.planType)) {
      return { ok: false, code: "payment_plan_policy_ambiguous", message: "Payment plan policy has overlapping active rules for this course duration." };
    }
    plans.set(rule.planType, rule);
  }
  return { ok: true, durationMonths, rules, plans };
}

export function fixedInstalmentsForRule(rule: PaymentPlanPolicyRule) {
  return FIXED_PLAN_COUNTS[rule.planType] ?? rule.fixedInstalments ?? null;
}
