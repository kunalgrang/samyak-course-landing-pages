import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffEnquiryCrmRoutes } from "./staff-enquiry-crm";
import type { EnquiryCrmRow } from "../lib/enquiry-crm";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  mobileHash: vi.fn(),
  decryptText: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
  mobileHash: mocks.mobileHash,
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
    mocks.mobileHash.mockImplementation(async (_c: unknown, mobile: string) => `hash_${mobile}`);
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

  it("returns a human-readable assigned counsellor label without using the raw account id as display text", async () => {
    const app = routeApp();
    const db = crmDb([enquiry({
      counsellor_login_account_id: "acct_04176173eb024647afbc0f9c8f693d88",
      assigned_counsellor_display_name: "Kunal",
    })]);

    const response = await app.request("/api/staff/enquiries/crm", {}, env(db));
    const body = await response.json() as {
      items: Array<{
        assignedCounsellor: { accountId: string; displayName: string };
        assignedCounsellorLoginAccountId: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.items[0].assignedCounsellor).toEqual({
      accountId: "acct_04176173eb024647afbc0f9c8f693d88",
      displayName: "Kunal",
    });
    expect(body.items[0].assignedCounsellor.displayName).not.toContain("acct_");
    expect(body.items[0].assignedCounsellorLoginAccountId).toBe("acct_04176173eb024647afbc0f9c8f693d88");
  });

  it("falls back to Unknown staff for assigned accounts missing a display name", async () => {
    const app = routeApp();
    const db = crmDb([enquiry({
      counsellor_login_account_id: "acct_missing_name",
      assigned_counsellor_display_name: null,
    })]);

    const response = await app.request("/api/staff/enquiries/crm", {}, env(db));
    const body = await response.json() as { items: Array<{ assignedCounsellor: { displayName: string } }> };

    expect(response.status).toBe(200);
    expect(body.items[0].assignedCounsellor.displayName).toBe("Unknown staff");
  });

  it("denies unauthenticated CRM requests before contact resolution", async () => {
    mocks.getSessionFromRequest.mockResolvedValue(null);
    const app = routeApp();
    const response = await app.request("/api/staff/enquiries/crm", {}, env(crmDb([enquiry()])));

    expect(response.status).toBe(403);
    expect(mocks.decryptText).not.toHaveBeenCalled();
  });

  it("defaults the operational queue to combined hot enquiries", async () => {
    const app = routeApp();
    const db = crmDb([
      enquiry({ id: "enq_hot_urgent", pipeline_stage: "admission_ready", status: "admission_pending" }),
      enquiry({ id: "enq_hot", source: "referral", created_at: "2026-08-16T09:00:00.000Z" }),
      enquiry({ id: "enq_warm", source: "Google Ads", created_at: "2026-08-19T09:00:00.000Z" }),
    ]);

    const response = await app.request("/api/staff/enquiries/crm", {}, env(db));
    const body = await response.json() as { filters: { queue: string }; queues: string[]; items: Array<{ enquiry: { id: string }; leadTemperature: string }> };

    expect(response.status).toBe(200);
    expect(body.filters.queue).toBe("hot");
    expect(body.queues[0]).toBe("hot");
    expect(body.items.map((item) => item.enquiry.id).sort()).toEqual(["enq_hot", "enq_hot_urgent"]);
    expect(body.items.map((item) => item.leadTemperature).sort()).toEqual(["hot", "hot_urgent"]);
  });

  it("keeps All branch-scoped and includes authorized converted enquiries", async () => {
    authenticateAs(["counsellor"]);
    const app = routeApp();
    const db = crmDb([
      enquiry({ id: "enq_sion", branch_id: "branch_sion", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_sion", enrolment_id: "enrol_sion", student_id: "student_sion", student_number: "SYK-SION-000057" }),
      enquiry({ id: "enq_dadar", branch_id: "branch_dadar", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_dadar", enrolment_id: "enrol_dadar", student_id: "student_dadar", student_number: "SYK-DADAR-000001" }),
    ]);

    const response = await app.request("/api/staff/enquiries/crm?queue=all", {}, env(db));
    const body = await response.json() as { filters: { queue: string }; items: Array<{ enquiry: { id: string }; admission: { convertedEnrolmentId: string | null; studentId: string | null } }> };

    expect(response.status).toBe(200);
    expect(body.filters.queue).toBe("all");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].enquiry.id).toBe("enq_sion");
    expect(body.items[0].admission).toMatchObject({ convertedEnrolmentId: "enrol_sion", studentId: "student_sion" });
  });

  it("marks the converted payment ledger available only for the exact converted enrolment with an active fee agreement", async () => {
    const app = routeApp();
    const db = crmDb([
      enquiry({ id: "enq_exact", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_converted", enrolment_id: "enrol_converted", enrolment_number: "ENR-SION-2026-000060", fee_agreement_id: "fee_active", student_id: "student_aman", student_number: "SYK-SION-000057" }),
      enquiry({ id: "enq_other_enrolment", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_converted", enrolment_id: "enrol_latest", enrolment_number: "ENR-SION-2026-000061", fee_agreement_id: "fee_latest", student_id: "student_aman", student_number: "SYK-SION-000057" }),
    ]);

    const response = await app.request("/api/staff/enquiries/crm?queue=all", {}, env(db));
    const body = await response.json() as { items: Array<{ enquiry: { id: string }; admission: { convertedEnrolmentId: string | null; paymentLedgerAvailable: boolean; enrolmentNumber: string | null } }> };

    expect(response.status).toBe(200);
    expect(body.items.find((item) => item.enquiry.id === "enq_exact")?.admission).toMatchObject({
      convertedEnrolmentId: "enrol_converted",
      enrolmentNumber: "ENR-SION-2026-000060",
      paymentLedgerAvailable: true,
    });
    expect(body.items.find((item) => item.enquiry.id === "enq_other_enrolment")?.admission).toMatchObject({
      convertedEnrolmentId: null,
      paymentLedgerAvailable: false,
    });
  });

  it("searches All by student name, Student ID and mobile hash", async () => {
    const app = routeApp();
    const db = crmDb([
      enquiry({ id: "enq_name", full_name: "Aman Sharma", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_name", enrolment_id: "enrol_name", student_id: "student_name", student_number: "SYK-SION-000057" }),
      enquiry({ id: "enq_mobile", full_name: "Bina", mobile_used: "hash_9876543210", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_mobile", enrolment_id: "enrol_mobile", student_id: "student_mobile", student_number: "SYK-SION-000058" }),
    ]);

    const byName = await app.request("/api/staff/enquiries/crm?queue=all&search=Aman", {}, env(db));
    const byStudentId = await app.request("/api/staff/enquiries/crm?queue=all&search=SYK-SION-000057", {}, env(db));
    const byMobile = await app.request("/api/staff/enquiries/crm?queue=all&search=9876543210", {}, env(db));
    const nameBody = await byName.json() as { items: Array<{ enquiry: { id: string } }> };
    const studentBody = await byStudentId.json() as { items: Array<{ enquiry: { id: string } }> };
    const mobileBody = await byMobile.json() as { items: Array<{ enquiry: { id: string } }> };

    expect(nameBody.items.map((item) => item.enquiry.id)).toEqual(["enq_name"]);
    expect(studentBody.items.map((item) => item.enquiry.id)).toEqual(["enq_name"]);
    expect(mobileBody.items.map((item) => item.enquiry.id)).toEqual(["enq_mobile"]);
    expect(mocks.mobileHash).toHaveBeenCalledWith(expect.anything(), "9876543210");
    expect(db.seenSql.some((sql) => sql.includes("students.student_number like ?"))).toBe(true);
    expect(db.seenSql.some((sql) => sql.includes("person_contacts.normalized_value = ?"))).toBe(true);
    expect(db.seenSql.some((sql) => sql.includes("person_contact_details.status"))).toBe(true);
  });

  it("keeps shared-mobile CRM search branch-scoped and does not duplicate returned enquiries", async () => {
    authenticateAs(["counsellor"]);
    const app = routeApp();
    const db = crmDb([
      enquiry({ id: "enq_sion_mobile", branch_id: "branch_sion", mobile_used: "hash_9876543210", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_sion", enrolment_id: "enrol_sion", fee_agreement_id: "fee_sion", student_id: "student_sion", student_number: "SYK-SION-000057" }),
      enquiry({ id: "enq_dadar_mobile", branch_id: "branch_dadar", mobile_used: "hash_9876543210", pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_dadar", enrolment_id: "enrol_dadar", fee_agreement_id: "fee_dadar", student_id: "student_dadar", student_number: "SYK-DADAR-000057" }),
    ]);

    const response = await app.request("/api/staff/enquiries/crm?queue=all&search=9876543210", {}, env(db));
    const body = await response.json() as { items: Array<{ enquiry: { id: string } }> };

    expect(response.status).toBe(200);
    expect(body.items.map((item) => item.enquiry.id)).toEqual(["enq_sion_mobile"]);
    expect(new Set(body.items.map((item) => item.enquiry.id)).size).toBe(body.items.length);
  });

  it("does not return converted navigation data when the canonical converted enrolment join is unavailable", async () => {
    const app = routeApp();
    const db = crmDb([enquiry({ pipeline_stage: "converted", status: "converted", converted_enrolment_id: "enrol_cross_branch", enrolment_id: null, student_id: null, student_number: null })]);

    const response = await app.request("/api/staff/enquiries/crm?queue=all", {}, env(db));
    const body = await response.json() as { items: Array<{ admission: { convertedEnrolmentId: string | null; paymentLedgerAvailable: boolean; studentId: string | null } }> };

    expect(response.status).toBe(200);
    expect(body.items[0].admission).toMatchObject({ convertedEnrolmentId: null, paymentLedgerAvailable: false, studentId: null });
  });

  it("executes the generated CRM SELECT against production-shaped admission tables", async () => {
    const app = routeApp();
    const db = productionShapeCrmDb();

    try {
      for (const [path, expectedId] of [
        ["/api/staff/enquiries/crm", null],
        ["/api/staff/enquiries/crm?queue=all", "enq_aman"],
        ["/api/staff/enquiries/crm?queue=all&search=Aman", "enq_aman"],
        ["/api/staff/enquiries/crm?queue=all&search=SYK-SION-000057", "enq_aman"],
        ["/api/staff/enquiries/crm?queue=all&search=ENR-SION-2026-000060", "enq_aman"],
        ["/api/staff/enquiries/crm?queue=all&search=9876543210", "enq_aman"],
      ] as const) {
        const response = await app.request(path, {}, env(db));
        const body = await response.json() as { items: Array<{ enquiry: { id: string }; admission: { convertedEnrolmentId: string | null; paymentLedgerAvailable: boolean } }> };

        expect(response.status, path).toBe(200);
        if (expectedId) expect(body.items.map((item) => item.enquiry.id), path).toContain(expectedId);
      }

      expect(db.seenSql.some((sql) => sql.includes("enrolments.organisation_id"))).toBe(false);
      expect(db.seenSql.some((sql) => sql.includes("students.id = enrolments.student_id and students.organisation_id = enquiries.organisation_id"))).toBe(true);
    } finally {
      db.close();
    }
  });
});

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(private readonly db: ProductionShapeCrmDb, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.db.database.prepare(this.sql).get(...(this.values as never[])) ?? null) as T;
  }

  async all<T>() {
    return { results: this.db.database.prepare(this.sql).all(...(this.values as never[])) } as T;
  }

  async run() {
    const result = this.db.database.prepare(this.sql).run(...(this.values as never[]));
    return { success: true, meta: { changes: result.changes, rows_written: result.changes } };
  }
}

class ProductionShapeCrmDb {
  readonly database = new DatabaseSync(":memory:");
  readonly seenSql: string[] = [];

  prepare(sql: string) {
    this.seenSql.push(sql);
    return new SqliteD1Statement(this, sql);
  }

  close() {
    this.database.close();
  }
}

function productionShapeCrmDb() {
  const db = new ProductionShapeCrmDb();
  db.database.exec(`
    create table enquiries (
      id text primary key,
      organisation_id text not null,
      branch_id text not null,
      person_id text,
      enquiry_number text not null,
      mobile_used text not null,
      course_interest_id text,
      source text not null,
      source_detail text,
      campaign_data_json text,
      counsellor_login_account_id text,
      preferred_timing text,
      preferred_joining_date text,
      status text not null,
      next_follow_up_at text,
      lost_reason text,
      converted_enrolment_id text,
      converted_at text,
      created_at text not null,
      updated_at text not null,
      pipeline_stage text not null,
      assigned_at text,
      last_contacted_at text,
      closed_reason text
    );
    create table people (id text primary key, organisation_id text not null, home_branch_id text, full_name text not null, public_name text, status text not null, created_at text not null, updated_at text not null);
    create table person_identity_details (person_id text primary key, official_full_name text not null, date_of_birth text not null, identity_verified integer not null default 0, created_at text not null, updated_at text not null);
    create table branches (id text primary key, name text not null, code text not null);
    create table courses (id text primary key, name text not null);
    create table enquiry_course_interests (enquiry_id text primary key, course_interest_text text);
    create table referrals (
      id text primary key,
      organisation_id text not null,
      branch_id text not null,
      referral_programme_id text not null,
      referral_link_id text,
      referrer_profile_id text not null,
      prospect_person_id text,
      enquiry_id text,
      course_interest_id text,
      source text not null,
      status text not null,
      submitted_at text not null,
      valid_until text not null,
      prospect_mobile_hash text not null,
      prospect_mobile_last_four text,
      prospect_mobile_ciphertext text,
      prospect_name text not null default ''
    );
    create table referrer_profiles (id text primary key, person_id text not null);
    create table enrolments (
      id text primary key,
      student_id text not null,
      branch_id text not null,
      course_id text not null,
      enquiry_id text,
      enrolment_number text not null,
      training_mode text not null,
      admission_date text not null,
      joining_date text not null,
      status text not null,
      nsdc_preference text not null,
      created_at text not null,
      updated_at text not null
    );
    create table students (id text primary key, organisation_id text not null, person_id text not null, home_branch_id text not null, student_number text not null, sequence_number integer not null, student_since text not null, current_status text not null, portal_status text not null, created_at text not null, updated_at text not null);
    create table fee_agreements (id text primary key, enrolment_id text not null, standard_fee_paise integer not null, final_agreed_fee_paise integer not null, payment_plan_type text not null, status text not null, created_at text not null, updated_at text not null);
    create table login_accounts (id text primary key);
    create table login_account_people (login_account_id text not null, person_id text not null, is_default integer not null);
    create table person_contacts (id text primary key, person_id text not null, contact_type text not null, normalized_value text not null, display_value text, last_four text, is_primary integer not null, is_verified integer not null, created_at text not null, updated_at text not null);
    create table person_contact_details (contact_id text primary key, status text not null);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text);
    create table enquiry_follow_up_events (id text primary key, enquiry_id text not null, organisation_id text not null, branch_id text not null, actor_login_account_id text not null, channel text not null, outcome text not null, note text, occurred_at text not null, next_follow_up_at_snapshot text, pipeline_stage_snapshot text not null, created_at text not null);

    insert into branches (id, name, code) values ('branch_sion', 'Sion', 'SION');
    insert into courses (id, name) values ('course_full_stack', 'Full Stack');
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
      values ('person_aman', 'org_samyak', 'branch_sion', 'Aman Sharma', 'Aman', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into person_identity_details (person_id, official_full_name, date_of_birth, created_at, updated_at)
      values ('person_aman', 'Aman Sharma', '2000-01-01', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
      values ('student_aman', 'org_samyak', 'person_aman', 'branch_sion', 'SYK-SION-000057', 57, '2026-08-20', 'active', 'not_invited', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into enquiries (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id, source, source_detail, counsellor_login_account_id, preferred_timing, preferred_joining_date, status, next_follow_up_at, lost_reason, converted_enrolment_id, converted_at, created_at, updated_at, pipeline_stage, assigned_at, last_contacted_at, closed_reason)
      values ('enq_aman', 'org_samyak', 'branch_sion', 'person_aman', 'ENQ-SION-2026-1', 'hash_9876543210', 'course_full_stack', 'referral', null, null, null, null, 'converted', null, null, 'enrol_aman', '2026-08-20T01:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 'converted', null, null, null);
    insert into enrolments (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, admission_date, joining_date, status, nsdc_preference, created_at, updated_at)
      values ('enrol_aman', 'student_aman', 'branch_sion', 'course_full_stack', 'enq_aman', 'ENR-SION-2026-000060', 'offline', '2026-08-20', '2026-08-20', 'active', 'decide_later', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    insert into fee_agreements (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, payment_plan_type, status, created_at, updated_at)
      values ('fee_aman', 'enrol_aman', 1000000, 1000000, 'full', 'active', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
  `);
  return db;
}

function crmDb(rows: EnquiryCrmRow[]) {
  return {
    seenSql: [] as string[],
    prepare(sql: string) {
      this.seenSql.push(sql);
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
      if (sql.includes("from enquiries")) return { results: filterRows(rows, sql, values) };
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
      if (sql.includes("from login_account_roles")) return { results: [{ branch_id: "branch_sion" }] };
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

function filterRows(rows: EnquiryCrmRow[], sql: string, values: unknown[]) {
  let filtered = rows;
  if (sql.includes("enquiries.branch_id in")) {
    const branchIds = values.filter((value) => typeof value === "string" && String(value).startsWith("branch_"));
    filtered = filtered.filter((row) => branchIds.includes(row.branch_id));
  }
  if (sql.includes("students.student_number like ?")) {
    const searchValue = values.find((value) => typeof value === "string" && String(value).startsWith("%") && String(value).endsWith("%"));
    const term = String(searchValue || "").replace(/^%|%$/g, "").toLowerCase();
    const mobileHashValue = values.find((value) => typeof value === "string" && String(value).startsWith("hash_"));
    filtered = filtered.filter((row) =>
      [
        row.enquiry_number,
        row.full_name,
        row.official_full_name,
        row.prospect_name,
        row.course_name,
        row.course_interest_text,
        row.student_number,
        row.enrolment_number,
      ].some((value) => String(value || "").toLowerCase().includes(term)) ||
      Boolean(mobileHashValue && [row.mobile_used, row.prospect_mobile_hash].includes(String(mobileHashValue))),
    );
  }
  return filtered;
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
    official_full_name: null,
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
    fee_agreement_id: null,
    student_id: null,
    student_number: null,
    assigned_counsellor_display_name: null,
    ...overrides,
  };
}
