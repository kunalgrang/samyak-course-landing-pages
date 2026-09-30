import type { AppContext } from "./http";

type OnboardingRow = {
  status: string;
  completed_steps_json: string;
  checklist_json: string;
  reported_centre_count: number | null;
};

type TrialRow = {
  state: string;
  trial_started_at: string;
  trial_ends_at: string;
};

type ChecklistItem = {
  code: string;
  label: string;
  done: boolean;
};

export type OrganisationOnboardingSnapshot = {
  onboarding: {
    status: string;
    reportedCentreCount: number | null;
    completedSteps: string[];
    checklist: ChecklistItem[];
  };
  trial: {
    state: string;
    startedAt: string;
    endsAt: string;
  };
};

export async function getOrganisationOnboardingSnapshot(c: AppContext, organisationId: string) {
  const onboarding = await c.env.DB.prepare(
    `select status, completed_steps_json, checklist_json, reported_centre_count
     from organisation_onboarding_progress
     where organisation_id = ?
     limit 1`,
  ).bind(organisationId).first<OnboardingRow>();
  if (!onboarding) {
    return { ok: false as const, status: 404 as const, code: "onboarding_not_found", message: "Organisation onboarding progress was not found." };
  }

  const trial = await c.env.DB.prepare(
    `select state, trial_started_at, trial_ends_at
     from organisation_commercial_access
     where organisation_id = ?
     limit 1`,
  ).bind(organisationId).first<TrialRow>();
  if (!trial) {
    return { ok: false as const, status: 404 as const, code: "trial_not_found", message: "Organisation commercial trial was not found." };
  }

  const completedSteps = parseCompletedSteps(onboarding.completed_steps_json);
  const checklist = parseChecklist(onboarding.checklist_json);
  if (!completedSteps || !checklist) {
    return { ok: false as const, status: 500 as const, code: "onboarding_state_invalid", message: "Organisation onboarding progress is temporarily unavailable." };
  }

  return {
    ok: true as const,
    snapshot: {
      onboarding: {
        status: onboarding.status,
        reportedCentreCount: onboarding.reported_centre_count,
        completedSteps,
        checklist,
      },
      trial: {
        state: trial.state,
        startedAt: trial.trial_started_at,
        endsAt: trial.trial_ends_at,
      },
    } satisfies OrganisationOnboardingSnapshot,
  };
}

function parseCompletedSteps(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseChecklist(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const checklist = parsed.map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.code !== "string" || typeof row.label !== "string" || typeof row.done !== "boolean") return null;
      return { code: row.code, label: row.label, done: row.done };
    });
    if (checklist.some((item) => !item)) return null;
    return checklist as ChecklistItem[];
  } catch {
    return null;
  }
}
