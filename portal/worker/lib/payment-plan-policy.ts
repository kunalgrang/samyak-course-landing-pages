import type { AppContext } from "./http";
import { z } from "zod";
import { createOpaqueId } from "./crypto";
import { staffOrganisationId, type StaffContext } from "./staff-auth";

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
export const MIN_PAYMENT_PLAN_DURATION_MONTHS = 0.5;

const submittedDuration = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid duration." });
    return z.NEVER;
  }
  return parsed;
});

const optionalPlanUpdateSchema = z.object({
  enabled: z.boolean(),
  minimumCourseDurationMonths: submittedDuration,
}).strict();

const OPTIONAL_PLAN_MINIMUMS = {
  twoInstalments: 2,
  threeInstalments: 3,
  flexibleInstalments: 4,
} as const;

export const paymentPlanPolicyUpdateSchema = z.object({
  twoInstalments: optionalPlanUpdateSchema,
  threeInstalments: optionalPlanUpdateSchema,
  flexibleInstalments: optionalPlanUpdateSchema,
}).strict();

export type PaymentPlanPolicyUpdateInput = z.infer<typeof paymentPlanPolicyUpdateSchema>;

export type OrganisationPaymentPlanPolicyRule = {
  enabled: boolean;
  minimumCourseDurationMonths: number;
};

export type OrganisationPaymentPlanPolicy = {
  fullPayment: {
    enabled: true;
    minimumCourseDurationMonths: 0.5;
  };
  twoInstalments: OrganisationPaymentPlanPolicyRule;
  threeInstalments: OrganisationPaymentPlanPolicyRule;
  flexibleInstalments: OrganisationPaymentPlanPolicyRule;
};

type PaymentPlanRuleRow = {
  id: string;
  organisation_id: string;
  min_duration_months: number;
  max_duration_months: number | null;
  plan_type: PaymentPlanType;
  fixed_instalments: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export async function resolvePaymentPlanPolicy(c: AppContext, organisationId: string, course: { duration_months?: number | null }): Promise<PaymentPlanPolicy> {
  const durationMonths = Number(course.duration_months);
  if (!Number.isFinite(durationMonths) || durationMonths < MIN_PAYMENT_PLAN_DURATION_MONTHS) {
    return { ok: false, code: "invalid_course_duration", message: "Selected course must have a duration of at least 0.5 months." };
  }

  const rows = await c.env.DB.prepare(
    `select plan_type, fixed_instalments, min_duration_months, max_duration_months
     from payment_plan_rules
     where organisation_id = ?
       and is_active = 1
     order by min_duration_months, coalesce(max_duration_months, 999999), plan_type, fixed_instalments`,
  )
    .bind(organisationId)
    .all<Record<string, unknown>>();

  const rules = (rows.results || []).map((row) => ({
    planType: String(row.plan_type) as PaymentPlanType,
    fixedInstalments: row.fixed_instalments == null ? null : Number(row.fixed_instalments),
    minDurationMonths: Number(row.min_duration_months),
    maxDurationMonths: row.max_duration_months == null ? null : Number(row.max_duration_months),
  })).filter((rule) => durationMonths >= rule.minDurationMonths);
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

export async function getOrganisationPaymentPlanPolicy(c: AppContext, organisationId: string): Promise<OrganisationPaymentPlanPolicy> {
  const rows = await loadPaymentPlanRuleRows(c, organisationId);
  return policyFromRows(rows.filter((row) => Boolean(row.is_active)));
}

export async function updateOrganisationPaymentPlanPolicy(c: AppContext, staff: StaffContext, input: PaymentPlanPolicyUpdateInput) {
  const organisationId = staffOrganisationId(staff);
  const existingRows = await loadPaymentPlanRuleRows(c, organisationId);
  const current = policyFromRows(existingRows.filter((row) => Boolean(row.is_active)));

  const validation = canonicalPolicyRules(input);
  if (!validation.ok) {
    return { ok: false as const, status: 400 as const, code: validation.code, message: validation.message, fieldErrors: validation.fieldErrors };
  }

  const nextRules = validation.rules;
  if (policySignature(summaryForPolicy(current)) === policySignature(summaryForRules(nextRules))) {
    return { ok: true as const, policy: current, changedRuleIds: [] };
  }

  const now = new Date().toISOString();
  const activeExisting = existingRows.filter((row) => Boolean(row.is_active));
  const statements = [];
  const changedRuleIds: string[] = [];
  const matchedActiveIds = new Set<string>();

  for (const rule of nextRules) {
    const existing = findMatchingRule(existingRows, rule);
    if (existing) {
      matchedActiveIds.add(existing.id);
      changedRuleIds.push(existing.id);
      statements.push(c.env.DB.prepare(
        `update payment_plan_rules
         set fixed_instalments = ?, is_active = 1, updated_at = ?
         where id = ? and organisation_id = ?`,
      ).bind(rule.fixedInstalments, now, existing.id, organisationId));
    } else {
      const id = createOpaqueId("payrule");
      changedRuleIds.push(id);
      statements.push(c.env.DB.prepare(
        `insert into payment_plan_rules
           (id, organisation_id, min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(id, organisationId, rule.minDurationMonths, rule.maxDurationMonths, rule.planType, rule.fixedInstalments, now, now));
    }
  }

  for (const row of activeExisting) {
    if (matchedActiveIds.has(row.id)) continue;
    changedRuleIds.push(row.id);
    statements.push(c.env.DB.prepare("update payment_plan_rules set is_active = 0, updated_at = ? where id = ? and organisation_id = ?").bind(now, row.id, organisationId));
  }

  const afterSummary = summaryForRules(nextRules);
  statements.push(c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, null, ?, ?, 'payment_plan_policy_updated', 'payment_plan_policy', ?, ?, ?)`,
  ).bind(
    createOpaqueId("audit"),
    organisationId,
    staff.loginAccountId,
    staff.activePersonId,
    organisationId,
    JSON.stringify({
      before: summaryForPolicy(current),
      after: afterSummary,
      changedRuleIds: [...new Set(changedRuleIds)].sort(),
    }),
    now,
  ));

  await c.env.DB.batch(statements);
  const updated = await getOrganisationPaymentPlanPolicy(c, organisationId);
  return { ok: true as const, policy: updated, changedRuleIds: [...new Set(changedRuleIds)].sort() };
}

function loadPaymentPlanRuleRows(c: AppContext, organisationId: string) {
  return c.env.DB.prepare(
    `select id, organisation_id, min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active, created_at, updated_at
     from payment_plan_rules
     where organisation_id = ?
     order by is_active desc, min_duration_months, coalesce(max_duration_months, 999999), plan_type, id`,
  ).bind(organisationId).all<PaymentPlanRuleRow>().then((result) => result.results || []);
}

function policyFromRows(rows: PaymentPlanRuleRow[]): OrganisationPaymentPlanPolicy {
  const active = rows.filter((row) => Boolean(row.is_active));
  const two = active.find((row) => row.plan_type === "two_instalments");
  const three = active.find((row) => row.plan_type === "three_instalments");
  const flexible = active.find((row) => row.plan_type === "custom");
  return {
    fullPayment: { enabled: true, minimumCourseDurationMonths: 0.5 },
    twoInstalments: { enabled: Boolean(two), minimumCourseDurationMonths: two ? Number(two.min_duration_months) : 2 },
    threeInstalments: { enabled: Boolean(three), minimumCourseDurationMonths: three ? Number(three.min_duration_months) : 3 },
    flexibleInstalments: { enabled: Boolean(flexible), minimumCourseDurationMonths: flexible ? Number(flexible.min_duration_months) : 4 },
  };
}

function canonicalPolicyRules(input: PaymentPlanPolicyUpdateInput) {
  const fieldErrors: Record<string, string[]> = {};
  const twoMin = normalizedDuration(input.twoInstalments.minimumCourseDurationMonths);
  const threeMin = normalizedDuration(input.threeInstalments.minimumCourseDurationMonths);
  const flexibleMin = normalizedDuration(input.flexibleInstalments.minimumCourseDurationMonths);
  const optional = [
    { key: "twoInstalments" as const, path: "twoInstalments", planType: "two_instalments" as const, min: twoMin, fixedInstalments: 2, lowerBound: OPTIONAL_PLAN_MINIMUMS.twoInstalments, label: "2 instalments" },
    { key: "threeInstalments" as const, path: "threeInstalments", planType: "three_instalments" as const, min: threeMin, fixedInstalments: 3, lowerBound: OPTIONAL_PLAN_MINIMUMS.threeInstalments, label: "3 instalments" },
    { key: "flexibleInstalments" as const, path: "flexibleInstalments", planType: "custom" as const, min: flexibleMin, fixedInstalments: null, lowerBound: OPTIONAL_PLAN_MINIMUMS.flexibleInstalments, label: "Flexible instalments" },
  ];
  for (const rule of optional) {
    if (input[rule.key].enabled && rule.min < rule.lowerBound) {
      fieldErrors[`${rule.path}.minimumCourseDurationMonths`] = [`${rule.label} can start only from Courses of at least ${rule.lowerBound} months.`];
    }
  }
  if (input.threeInstalments.enabled && !input.twoInstalments.enabled) {
    fieldErrors["threeInstalments.enabled"] = ["Enable 2 instalments before enabling 3 instalments."];
  }
  if (input.flexibleInstalments.enabled && (!input.twoInstalments.enabled || !input.threeInstalments.enabled)) {
    fieldErrors["flexibleInstalments.enabled"] = ["Enable 2 and 3 instalments before enabling flexible instalments."];
  }
  if (input.twoInstalments.enabled && input.threeInstalments.enabled && twoMin > threeMin) {
    fieldErrors["threeInstalments.minimumCourseDurationMonths"] = ["3 instalments must start at the same or a longer Course duration than 2 instalments."];
  }
  if (input.threeInstalments.enabled && input.flexibleInstalments.enabled && threeMin > flexibleMin) {
    fieldErrors["flexibleInstalments.minimumCourseDurationMonths"] = ["Flexible instalments must start at the same or a longer Course duration than 3 instalments."];
  }
  if (Object.keys(fieldErrors).length) {
    return { ok: false as const, code: "invalid_policy", message: "Please correct the highlighted payment plan rules.", fieldErrors };
  }
  const active = [
    { planType: "full" as const, minDurationMonths: MIN_PAYMENT_PLAN_DURATION_MONTHS, maxDurationMonths: null, fixedInstalments: 1 },
    ...optional.filter((rule) => input[rule.key].enabled).map((rule) => ({
      planType: rule.planType,
      minDurationMonths: rule.min,
      maxDurationMonths: null,
      fixedInstalments: rule.fixedInstalments,
    })),
  ];
  return {
    ok: true as const,
    rules: active.sort((a, b) => a.minDurationMonths - b.minDurationMonths || a.planType.localeCompare(b.planType)),
  };
}

function findMatchingRule(rows: PaymentPlanRuleRow[], rule: { planType: PaymentPlanType; minDurationMonths: number; maxDurationMonths: number | null }) {
  return rows.find((row) =>
    row.plan_type === rule.planType &&
    Number(row.min_duration_months) === rule.minDurationMonths &&
    (row.max_duration_months == null ? null : Number(row.max_duration_months)) === rule.maxDurationMonths
  ) || null;
}

function normalizedDuration(value: number) {
  return Number(value.toFixed(2));
}

function summaryForPolicy(policy: OrganisationPaymentPlanPolicy) {
  return summaryForRules([
    { planType: "full", minDurationMonths: 0.5, maxDurationMonths: null, fixedInstalments: 1 },
    ...(policy.twoInstalments.enabled ? [{ planType: "two_instalments" as const, minDurationMonths: policy.twoInstalments.minimumCourseDurationMonths, maxDurationMonths: null, fixedInstalments: 2 }] : []),
    ...(policy.threeInstalments.enabled ? [{ planType: "three_instalments" as const, minDurationMonths: policy.threeInstalments.minimumCourseDurationMonths, maxDurationMonths: null, fixedInstalments: 3 }] : []),
    ...(policy.flexibleInstalments.enabled ? [{ planType: "custom" as const, minDurationMonths: policy.flexibleInstalments.minimumCourseDurationMonths, maxDurationMonths: null, fixedInstalments: null }] : []),
  ]);
}

function summaryForRules(rules: Array<{ planType: PaymentPlanType; minDurationMonths: number; maxDurationMonths: number | null; fixedInstalments: number | null }>) {
  return rules.map((rule) => ({
    planType: rule.planType,
    minDurationMonths: rule.minDurationMonths,
    maxDurationMonths: rule.maxDurationMonths,
    fixedInstalments: rule.fixedInstalments,
  }));
}

function policySignature(summary: Array<{ planType: PaymentPlanType; minDurationMonths: number; maxDurationMonths: number | null; fixedInstalments: number | null }>) {
  return JSON.stringify([...summary].sort((a, b) => a.planType.localeCompare(b.planType) || a.minDurationMonths - b.minDurationMonths || (a.maxDurationMonths ?? 999999) - (b.maxDurationMonths ?? 999999)));
}
