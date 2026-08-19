import { describe, expect, it } from "vitest";
import { calculateLeadTemperature, coldStreak, type EnquiryCrmRow, type FollowUpEventRecord } from "./enquiry-crm";

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
    expect(temp(enquiry(), unsuccessfulAttempts(10, "2026-08-16T10:00:00.000Z")).leadTemperature).not.toBe("cold");
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

  it("decays old demo completion and handles admission ready, deferred and terminal states", () => {
    expect(temp(enquiry(), [event("demo_completed", "2026-08-01T10:00:00.000Z")])).toMatchObject({ leadTemperature: "hot" });
    expect(temp(enquiry({ pipeline_stage: "admission_ready" }))).toMatchObject({ leadTemperature: "hot_urgent" });
    expect(temp(enquiry({ pipeline_stage: "deferred", preferred_joining_date: "2026-09-10", next_follow_up_at: "2026-09-01T10:00:00.000Z" }))).toMatchObject({ leadTemperature: "warm" });
    expect(temp(enquiry({ pipeline_stage: "converted" }))).toMatchObject({ leadTemperature: null });
    expect(temp(enquiry({ pipeline_stage: "lost" }))).toMatchObject({ leadTemperature: null });
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
