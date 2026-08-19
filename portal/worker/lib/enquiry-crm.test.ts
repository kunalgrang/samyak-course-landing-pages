import { describe, expect, it } from "vitest";
import { calculateLeadTemperature, coldStreak, validatePipelineUpdate, type EnquiryCrmRow, type FollowUpEventRecord } from "./enquiry-crm";

const NOW = "2026-08-19T10:00:00.000Z";

describe("enquiry CRM lead temperature", () => {
  it("classifies normal new Google Ads enquiries as warm", () => {
    expect(temp(enquiry({ source: "Google Ads" }))).toMatchObject({
      leadTemperature: "warm",
      leadTemperatureReason: "New enquiry, no strong buying signal yet",
    });
  });

  it("starts new referral and walk-in enquiries as hot urgent", () => {
    expect(temp(enquiry({ source: "referral", created_at: NOW })).leadTemperature).toBe("hot_urgent");
    expect(temp(enquiry({ source: "Walk-in", created_at: NOW })).leadTemperature).toBe("hot_urgent");
  });

  it("does not let referral source permanently override cold non-response", () => {
    const events = unsuccessfulAttempts(10, "2026-08-01T10:00:00.000Z");

    expect(temp(enquiry({ source: "referral", created_at: "2026-08-01T09:00:00.000Z" }), events)).toMatchObject({
      leadTemperature: "cold",
      leadTemperatureReason: "10 consecutive unsuccessful attempts over 18 days",
    });
  });

  it("requires both attempt count and elapsed days for cold", () => {
    expect(coldStreak(unsuccessfulAttempts(9, "2026-08-01T10:00:00.000Z"), NOW)).toMatchObject({ count: 9, isCold: false });
    expect(temp(enquiry(), unsuccessfulAttempts(10, "2026-08-16T10:00:00.000Z")).leadTemperature).not.toBe("cold");
    expect(coldStreak(unsuccessfulAttempts(10, "2026-08-05T10:00:01.000Z"), NOW)).toMatchObject({ count: 10, elapsedDays: 13, isCold: false });
    expect(coldStreak(unsuccessfulAttempts(10, "2026-08-05T10:00:00.000Z"), NOW)).toMatchObject({ count: 10, elapsedDays: 14, isCold: true });
    expect(temp(enquiry(), unsuccessfulAttempts(10, "2026-08-01T10:00:00.000Z")).leadTemperature).toBe("cold");
  });

  it("resets cold streak after meaningful engagement", () => {
    const events = [
      event("whatsapp_replied", "2026-08-18T10:00:00.000Z"),
      ...unsuccessfulAttempts(10, "2026-08-01T10:00:00.000Z"),
    ];

    expect(coldStreak(events, NOW)).toMatchObject({ count: 0, isCold: false });
    expect(temp(enquiry(), events)).toMatchObject({ leadTemperature: "hot" });
  });

  it("classifies recent fee discussion and recent demo completion strongly", () => {
    expect(temp(enquiry(), [event("fee_discussed", "2026-08-17T10:00:00.000Z")])).toMatchObject({ leadTemperature: "hot" });
    expect(temp(enquiry(), [event("demo_completed", "2026-08-18T10:00:00.000Z")])).toMatchObject({ leadTemperature: "hot_urgent" });
  });

  it("does not count busy calls, sent WhatsApps or admin-only notes as cold attempts", () => {
    const events = [
      ...unsuccessfulAttempts(9, "2026-08-01T10:00:00.000Z"),
      event("call_busy", "2026-08-10T10:00:00.000Z"),
      event("whatsapp_sent", "2026-08-11T10:00:00.000Z"),
      event("other", "2026-08-12T10:00:00.000Z"),
    ];

    expect(coldStreak(events, NOW)).toMatchObject({ count: 9, isCold: false });
  });

  it("decays old demo completion and handles admission ready, deferred and terminal states", () => {
    expect(temp(enquiry(), [event("demo_completed", "2026-08-01T10:00:00.000Z")])).toMatchObject({ leadTemperature: "hot" });
    expect(temp(enquiry({ pipeline_stage: "admission_ready" }))).toMatchObject({ leadTemperature: "hot_urgent" });
    expect(temp(enquiry({ pipeline_stage: "deferred", preferred_joining_date: "2026-09-10", next_follow_up_at: "2026-09-01T10:00:00.000Z" }))).toMatchObject({ leadTemperature: "warm" });
    expect(temp(enquiry({ pipeline_stage: "converted" }))).toMatchObject({ leadTemperature: null });
    expect(temp(enquiry({ pipeline_stage: "lost" }))).toMatchObject({ leadTemperature: null });
  });
});

describe("enquiry CRM pipeline validation", () => {
  it("keeps conversion admission-derived and requires deferred dates", () => {
    expect(validatePipelineUpdate(update({ nextStage: "converted" }))).toMatch("admission-derived");
    expect(validatePipelineUpdate(update({ nextStage: "deferred", outcome: "deferred_joining" }))).toMatch("Deferred enquiries require");
    expect(validatePipelineUpdate(update({
      nextStage: "deferred",
      outcome: "deferred_joining",
      preferredJoiningDate: "2026-09-10",
      nextFollowUpAt: "2026-09-01T10:00:00.000Z",
    }))).toBeNull();
  });

  it("rejects invalid or past dates", () => {
    expect(validatePipelineUpdate(update({ nextStage: "engaged", nextFollowUpAt: "not-a-date" }))).toMatch("date/time is invalid");
    expect(validatePipelineUpdate(update({ nextStage: "engaged", nextFollowUpAt: "2026-08-18T10:00:00.000Z" }))).toMatch("must be in the future");
    expect(validatePipelineUpdate(update({ nextStage: "deferred", outcome: "deferred_joining", preferredJoiningDate: "2026-02-30", nextFollowUpAt: "2026-09-01T10:00:00.000Z" }))).toMatch("Expected joining date is invalid");
    expect(validatePipelineUpdate(update({ nextStage: "deferred", outcome: "deferred_joining", preferredJoiningDate: "2026-08-01", nextFollowUpAt: "2026-09-01T10:00:00.000Z" }))).toMatch("cannot be in the past");
  });

  it("rejects contradictory outcome and pipeline combinations", () => {
    expect(validatePipelineUpdate(update({ nextStage: "engaged", outcome: "not_interested" }))).toMatch("must close");
    expect(validatePipelineUpdate(update({ nextStage: "considering", outcome: "invalid_contact" }))).toMatch("Invalid contact");
    expect(validatePipelineUpdate(update({ nextStage: "considering", outcome: "deferred_joining" }))).toMatch("Deferred joining");
    expect(validatePipelineUpdate(update({ nextStage: "admission_ready", outcome: "call_connected" }))).toMatch("high-intent");
    expect(validatePipelineUpdate(update({ currentStage: "considering", nextStage: "admission_ready", outcome: "fee_discussed", nextFollowUpAt: "2026-08-20T10:00:00.000Z" }))).toBeNull();
    expect(validatePipelineUpdate(update({ nextStage: "lost", outcome: "not_interested", closedReason: "not_interested" }))).toBeNull();
  });
});

function temp(enq: EnquiryCrmRow, events: FollowUpEventRecord[] = []) {
  return calculateLeadTemperature(enq, events, NOW);
}

function enquiry(overrides: Partial<EnquiryCrmRow> = {}): EnquiryCrmRow {
  return {
    id: "enq_1",
    organisation_id: "org_samyak",
    branch_id: "branch_sion",
    person_id: null,
    enquiry_number: "ENQ-SION-2026-1",
    mobile_used: "mobile_hash",
    course_interest_id: "course_full_stack",
    source: "Google Ads",
    source_detail: null,
    counsellor_login_account_id: null,
    preferred_timing: null,
    preferred_joining_date: null,
    status: "new",
    pipeline_stage: "new",
    next_follow_up_at: null,
    assigned_at: null,
    last_contacted_at: null,
    lost_reason: null,
    closed_reason: null,
    converted_enrolment_id: null,
    converted_at: null,
    created_at: "2026-08-19T09:00:00.000Z",
    updated_at: "2026-08-19T09:00:00.000Z",
    full_name: "Asha Prospect",
    course_name: "Full Stack",
    course_interest_text: null,
    branch_name: "Sion",
    branch_code: "SION",
    referral_id: null,
    referral_status: null,
    referrer_name: null,
    prospect_name: null,
    prospect_mobile_hash: null,
    prospect_mobile_ciphertext: null,
    prospect_mobile_last_four: null,
    referral_link_id: null,
    enrolment_id: null,
    enrolment_number: null,
    enrolment_status: null,
    student_id: null,
    student_number: null,
    ...overrides,
  };
}

function event(outcome: FollowUpEventRecord["outcome"], occurredAt: string): FollowUpEventRecord {
  return {
    id: `evt_${outcome}_${occurredAt}`,
    enquiry_id: "enq_1",
    organisation_id: "org_samyak",
    branch_id: "branch_sion",
    actor_login_account_id: "acct_staff",
    channel: outcome.startsWith("whatsapp") ? "whatsapp" : "call",
    outcome,
    note: null,
    occurred_at: occurredAt,
    next_follow_up_at_snapshot: null,
    pipeline_stage_snapshot: "contacting",
    created_at: occurredAt,
  };
}

function unsuccessfulAttempts(count: number, startIso: string) {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_value, index) => event(index % 2 ? "whatsapp_no_response" : "call_no_answer", new Date(start + index * 24 * 60 * 60 * 1000).toISOString()));
}

function update(overrides: Partial<Parameters<typeof validatePipelineUpdate>[0]> = {}): Parameters<typeof validatePipelineUpdate>[0] {
  return {
    currentStage: "new",
    nextStage: "engaged",
    outcome: "call_connected",
    nowIso: NOW,
    ...overrides,
  };
}
