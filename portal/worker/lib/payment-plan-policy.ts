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

const PAYMENT_PLAN_TYPES = ["full", "two_instalments", "three_instalments", "custom"] as const;

const submittedDuration = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid duration." });
    return z.NEVER;
  }
  return parsed;
});

const submittedMaxDuration = z.union([z.number(), z.string(), z.null()]).optional().transform((value, ctx) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid upper duration." });
    return z.NEVER;
  }
  return parsed;
});

export const paymentPlanPolicyUpdateSchema = z.object({
  rules: z.array(z.object({
    planType: z.enum(PAYMENT_PLAN_TYPES),
    minDurationMonths: submittedDuration,
    maxDurationMonths: submittedMaxDuration,
    isActive: z.boolean().default(true),
    fixedInstalments: z.union([z.number(), z.string(), z.null()]).optional(),
  }).strict()).min(1),
}).strict();

export type PaymentPlanPolicyUpdateInput = z.infer<typeof paymentPlanPolicyUpdateSchema>;

export type OrganisationPaymentPlanPolicyRule = {
  id: string | null;
  planType: PaymentPlanType;
  fixedInstalments: number | null;
  minDurationMonths: number;
  maxDurationMonths: number | null;
  isActive: boolean;
};

export type OrganisationPaymentPlanPolicy = {
  rules: OrganisationPaymentPlanPolicyRule[];
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

export async function getOrganisationPaymentPlanPolicy(c: AppContext, organisationId: string): Promise<OrganisationPaymentPlanPolicy> {
  const rows = await loadPaymentPlanRuleRows(c, organisationId);
  return policyFromRows(rows.filter((row) => Boolean(row.is_active)));
}

export async function updateOrganisationPaymentPlanPolicy(c: AppContext, staff: StaffContext, input: PaymentPlanPolicyUpdateInput) {
  const organisationId = staffOrganisationId(staff);
  const existingRows = await loadPaymentPlanRuleRows(c, organisationId);
  const current = policyFromRows(existingRows.filter((row) => Boolean(row.is_active)));

  const validation = canonicalPolicyRules(input.rules);
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
  const rules = rows.map((row) => ({
    id: row.id,
    planType: row.plan_type,
    fixedInstalments: row.fixed_instalments == null ? null : Number(row.fixed_instalments),
    minDurationMonths: Number(row.min_duration_months),
    maxDurationMonths: row.max_duration_months == null ? null : Number(row.max_duration_months),
    isActive: Boolean(row.is_active),
  }));
  return { rules };
}

function canonicalPolicyRules(inputRules: PaymentPlanPolicyUpdateInput["rules"]) {
  const active = inputRules.filter((rule) => rule.isActive).map((rule, index) => ({
    planType: rule.planType,
    minDurationMonths: normalizedDuration(rule.minDurationMonths),
    maxDurationMonths: rule.maxDurationMonths == null ? null : normalizedDuration(rule.maxDurationMonths),
    fixedInstalments: FIXED_PLAN_COUNTS[rule.planType] ?? null,
    index,
  }));

  const fieldErrors: Record<string, string[]> = {};
  for (const rule of active) {
    if (rule.minDurationMonths < MIN_PAYMENT_PLAN_DURATION_MONTHS) {
      fieldErrors[`rules.${rule.index}.minDurationMonths`] = ["Minimum duration must be at least 0.5 months."];
    }
    if (rule.maxDurationMonths != null && rule.maxDurationMonths < rule.minDurationMonths) {
      fieldErrors[`rules.${rule.index}.maxDurationMonths`] = ["Available until must be greater than or equal to available from."];
    }
  }
  if (Object.keys(fieldErrors).length) {
    return { ok: false as const, code: "invalid_policy", message: "Please correct the highlighted payment plan rules.", fieldErrors };
  }
  if (!active.length) {
    return { ok: false as const, code: "empty_policy", message: "At least one active payment plan rule is required.", fieldErrors: null };
  }
  const full = active.find((rule) => rule.planType === "full" && rule.minDurationMonths === MIN_PAYMENT_PLAN_DURATION_MONTHS && rule.maxDurationMonths === null);
  if (!full) {
    return { ok: false as const, code: "full_payment_required", message: "Full payment must remain available for every course duration from 0.5 months upward.", fieldErrors: null };
  }
  const repeated = repeatedPlanType(active);
  if (repeated) {
    return { ok: false as const, code: "ambiguous_policy", message: `${labelForPlan(repeated)} can have only one active duration range.`, fieldErrors: null };
  }
  const ambiguous = overlappingPlanType(active);
  if (ambiguous) {
    return { ok: false as const, code: "ambiguous_policy", message: `${labelForPlan(ambiguous)} has overlapping active duration ranges.`, fieldErrors: null };
  }
  return {
    ok: true as const,
    rules: active.map(({ index: _index, ...rule }) => rule).sort((a, b) => a.minDurationMonths - b.minDurationMonths || (a.maxDurationMonths ?? 999999) - (b.maxDurationMonths ?? 999999) || a.planType.localeCompare(b.planType)),
  };
}

function repeatedPlanType(rules: Array<{ planType: PaymentPlanType }>) {
  const seen = new Set<PaymentPlanType>();
  for (const rule of rules) {
    if (seen.has(rule.planType)) return rule.planType;
    seen.add(rule.planType);
  }
  return null;
}

function overlappingPlanType(rules: Array<{ planType: PaymentPlanType; minDurationMonths: number; maxDurationMonths: number | null }>) {
  for (const planType of PAYMENT_PLAN_TYPES) {
    const matching = rules.filter((rule) => rule.planType === planType).sort((a, b) => a.minDurationMonths - b.minDurationMonths);
    for (let index = 1; index < matching.length; index += 1) {
      const previous = matching[index - 1];
      const current = matching[index];
      if ((previous.maxDurationMonths ?? Infinity) >= current.minDurationMonths) return planType;
    }
  }
  return null;
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
  return summaryForRules(policy.rules.filter((rule) => rule.isActive));
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

function labelForPlan(planType: PaymentPlanType) {
  switch (planType) {
    case "full": return "Full payment";
    case "two_instalments": return "2 instalments";
    case "three_instalments": return "3 instalments";
    case "custom": return "Custom payment plan";
  }
}
