import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffEnquiryCrmRoutes } from "./staff-enquiry-crm";
import type { EnquiryCrmRow } from "../lib/enquiry-crm";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  decryptText: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
}));

vi.mock("../lib/crypto", () => ({
  createOpaqueId: vi.fn((prefix: string) => `${prefix}_test`),
  decryptText: mocks.decryptText,
}));

function routeApp() {
  const app = new Hono();
  registerStaffEnquiryCrmRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[]) {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_owner", active_person_id: "person_owner" },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

describe("staff enquiry CRM route contact exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateAs(["owner"]);
    mocks.decryptText.mockImplementation(async (_secret: string, context: string) => {
      if (context.startsWith("referral-mobile:")) return "9876543210";
      if (context === "contact:contact_person_asha") return "9123456789";
      if (context === "contact:contact_person_bina") return "9123456789";
      return null;
    });
  });

  it("exposes only the operational mobile object for unlinked referral enquiries", async () => {
    const app = routeApp();
    const db = crmDb([enquiry({ person_id: null, referral_id: "ref_1", referral_link_id: "reflink_1", prospect_mobile_hash: "hash_secret", prospect_mobile_ciphertext: "v1:cipher_secret" })]);

    const response = await app.request("/api/staff/enquiries/crm", {}, env(db));
    const body = await response.json() as { items: Array<{ contact: unknown; prospectContact: unknown }> };
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.items[0].contact).toMatchObject({
      mobile: "9876543210",
      mobileDisplay: "+91 98765 43210",
      callUrl: "tel:+919876543210",
    });
    expect(body.items[0].prospectContact).toEqual(body.items[0].contact);
    expect(text).not.toContain("hash_secret");
    expect(text).not.toContain("cipher_secret");
    expect(text).not.toContain("person_");
    expect(text).not.toContain("contact_");
    expect(text).not.toContain("secret_id");
    expect(text).not.toContain("normalized_value");
  });

  it("resolves linked Person contacts by enquiry context without exposing contact storage details", async () => {
    const app = routeApp();
    const db = crmDb([
      enquiry({ id: "enq_asha", person_id: "person_asha", full_name: "Asha" }),
      enquiry({ id: "enq_bina", person_id: "person_bina", full_name: "Bina" }),
    ]);

    const response = await app.request("/api/staff/enquiries/crm", {}, env(db));
    const body = await response.json() as { items: Array<{ contact: { mobile: string } }> };
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item: { contact: { mobile: string } }) => item.contact.mobile)).toEqual(["9123456789", "9123456789"]);
    expect(text).not.toContain("contact_person_asha");
    expect(text).not.toContain("contact_person_bina");
    expect(text).not.toContain("person_asha");
    expect(text).not.toContain("person_bina");
    expect(text).not.toContain("cipher_person");
  });

  it("returns unavailable contact state when no safe mobile can be resolved", async () => {
    const app = routeApp();
    const db = crmDb([enquiry({ person_id: null, referral_link_id: null, prospect_mobile_hash: null, prospect_mobile_ciphertext: null })]);

    const response = await app.request("/api/staff/enquiries/enq_1/crm", {}, env(db));
    const body = await response.json() as { crm: { contact: unknown } };

    expect(response.status).toBe(200);
    expect(body.crm.contact).toEqual({ mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null });
  });

  it("denies unauthenticated CRM requests before contact resolution", async () => {
    mocks.getSessionFromRequest.mockResolvedValue(null);
    const app = routeApp();
    const response = await app.request("/api/staff/enquiries/crm", {}, env(crmDb([enquiry()])));

    expect(response.status).toBe(403);
    expect(mocks.decryptText).not.toHaveBeenCalled();
  });
});

function crmDb(rows: EnquiryCrmRow[]) {
  return {
    prepare(sql: string) {
      return statement(sql, rows);
    },
  };
}

function statement(sql: string, rows: EnquiryCrmRow[]) {
  let values: unknown[] = [];
  return {
    bind(...params: unknown[]) {
      values = params;
      return this;
    },
    async all() {
      if (sql.includes("from person_contacts")) {
        return {
          results: values.map((personId) => ({
            person_id: String(personId),
            id: `contact_${String(personId)}`,
            value_ciphertext: `cipher_${String(personId)}`,
          })),
        };
      }
      if (sql.includes("from enquiry_follow_up_events")) return { results: [] };
      if (sql.includes("from login_accounts")) return { results: [{ id: "acct_owner", label: "Owner" }] };
      if (sql.includes("from enquiries")) return { results: rows };
      return { results: [] };
    },
    async first() {
      if (sql.includes("from person_contacts")) {
        const personId = String(values[0] || "");
        return { id: `contact_${personId}`, value_ciphertext: `cipher_${personId}` };
      }
      if (sql.includes("from enquiries")) return rows.find((row) => row.id === values[0]) || rows[0] || null;
      return null;
    },
    async run() {
      return { success: true, meta: { changes: 1 } };
    },
  };
}

function env(DB: unknown) {
  return { DB, SESSION_PEPPER: "test-pepper" } as never;
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
    source: "referral",
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
