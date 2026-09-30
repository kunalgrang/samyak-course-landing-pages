import type { AppContext } from "./http";
import { createOpaqueId } from "./crypto";

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

type SyncActor = {
  loginAccountId: string;
  activePersonId: string | null;
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

export async function syncCoursesOnboardingStep(c: AppContext, organisationId: string, actor?: SyncActor) {
  return syncCourseBackedOnboardingStep(c, organisationId, "courses", "course_state", actor, {
    andWhere: "and admission_configuration_complete = 1",
    missingReason: "no_qualifying_course",
    missingStepReason: "courses_step_missing",
  });
}

export async function syncFeesOnboardingStep(c: AppContext, organisationId: string, actor?: SyncActor) {
  return syncCourseBackedOnboardingStep(c, organisationId, "fees", "course_pricing", actor, {
    andWhere: "and default_fee_paise > 0",
    missingReason: "no_active_priced_course",
    missingStepReason: "fees_step_missing",
  });
}

async function syncCourseBackedOnboardingStep(
  c: AppContext,
  organisationId: string,
  step: "courses" | "fees",
  source: "course_state" | "course_pricing",
  actor: SyncActor | undefined,
  options: { andWhere: string; missingReason: string; missingStepReason: string },
) {
  try {
    const qualifyingCourse = await c.env.DB.prepare(
      `select id
       from courses
       where organisation_id = ?
         and status = 'active'
         ${options.andWhere}
       limit 1`,
    ).bind(organisationId).first<{ id: string }>();
    if (!qualifyingCourse) return { completed: false as const, reason: options.missingReason };

    const onboarding = await c.env.DB.prepare(
      `select status, completed_steps_json, checklist_json, reported_centre_count
       from organisation_onboarding_progress
       where organisation_id = ?
       limit 1`,
    ).bind(organisationId).first<OnboardingRow>();
    if (!onboarding) return { completed: false as const, reason: "onboarding_not_found" as const };

    const completedSteps = parseCompletedSteps(onboarding.completed_steps_json);
    const checklist = parseChecklist(onboarding.checklist_json);
    if (!completedSteps || !checklist) return { completed: false as const, reason: "onboarding_state_invalid" as const };
    if (completedSteps.includes(step)) return { completed: false as const, reason: "already_complete" as const };

    let foundStep = false;
    const nextChecklist = checklist.map((item) => {
      if (item.code !== step) return item;
      foundStep = true;
      return { ...item, done: true };
    });
    if (!foundStep) return { completed: false as const, reason: options.missingStepReason };

    const nextCompletedSteps = [...completedSteps, step];
    const nextStatus = nextChecklist.every((item) => item.done) ? "complete" : "in_progress";
    const now = new Date().toISOString();
    const progressUpdate = c.env.DB.prepare(
      `update organisation_onboarding_progress
       set status = ?, completed_steps_json = ?, checklist_json = ?, updated_at = ?
       where organisation_id = ?`,
    ).bind(nextStatus, JSON.stringify(nextCompletedSteps), JSON.stringify(nextChecklist), now, organisationId);

    if (actor) {
      const auditMetadata = JSON.stringify({ step, source });
      const auditInsert = c.env.DB.prepare(
        `insert into audit_logs
           (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
         select ?, ?, ?, ?, ?, ?, ?, ?, ?
         where not exists (
           select 1
           from audit_logs
           where organisation_id = ?
             and action = 'onboarding_step_completed'
             and entity_type = 'organisation_onboarding_progress'
             and entity_id = ?
             and metadata_json = ?
         )`,
      )
        .bind(
          createOpaqueId("audit"),
          organisationId,
          actor.loginAccountId,
          actor.activePersonId,
          "onboarding_step_completed",
          "organisation_onboarding_progress",
          organisationId,
          auditMetadata,
          now,
          organisationId,
          organisationId,
          auditMetadata,
        );
      await c.env.DB.batch([progressUpdate, auditInsert]);
    } else {
      await progressUpdate.run();
    }

    return { completed: true as const, status: nextStatus };
  } catch {
    return { completed: false as const, reason: "sync_failed" as const };
  }
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
