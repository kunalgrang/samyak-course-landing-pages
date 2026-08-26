import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaffAdmissionRoutes } from "./staff-admissions";
import * as admissionService from "../lib/admission-service";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  getAccountRoles: vi.fn(),
  listDiscountApprovals: vi.fn(),
  decideDiscountApproval: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  ORG_ID: "org_samyak",
  getSessionFromRequest: mocks.getSessionFromRequest,
  getAccountRoles: mocks.getAccountRoles,
  mobileHash: vi.fn(),
}));

type SqlValue = string | number | bigint | Uint8Array | null;

vi.mock("../lib/admission-service", () => ({
  confirmAdmission: vi.fn(),
  decideDiscountApproval: mocks.decideDiscountApproval,
  fieldErrorsFromIssues: vi.fn(() => ({ payload: ["Expected object"] })),
  getAdmissionConfiguration: vi.fn(),
  getAdmissionDraft: vi.fn(),
  getAdmissionReceiptSummary: vi.fn(),
  listDiscountApprovals: mocks.listDiscountApprovals,
  recordAdmissionReceipt: vi.fn(),
  recordAdmissionReceiptSchema: { safeParse: vi.fn(() => ({ success: true, data: { admissionDraftId: "draft_1", amountPaise: 50000, paymentMode: "cash", idempotencyKey: "receipt_test" } })) },
  requestDiscountApproval: vi.fn(),
  saveAdmissionDraft: vi.fn(),
  saveAdmissionDraftSchema: { safeParse: vi.fn(() => ({ success: true, data: { payload: {}, currentStep: "review" } })) },
}));

function routeApp() {
  const app = new Hono();
  registerStaffAdmissionRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[]) {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: { login_account_id: "acct_test", active_person_id: "person_test" },
  });
  mocks.getAccountRoles.mockResolvedValue(roles);
}

async function postDecision(app: Hono, approvalId = "approval_1") {
  return app.request(`/api/staff/discount-approvals/${approvalId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approved" }),
  });
}

describe("staff admission discount approval routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDiscountApprovals.mockResolvedValue([{ id: "approval_1", status: "pending" }]);
    mocks.decideDiscountApproval.mockResolvedValue({ ok: true, approvalId: "approval_1", status: "approved" });
  });

  it("allows owners to list and decide discount approvals", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const list = await app.request("/api/staff/discount-approvals");
    const decision = await postDecision(app);

    expect(list.status).toBe(200);
    expect(decision.status).toBe(200);
    expect(mocks.listDiscountApprovals).toHaveBeenCalledTimes(1);
    expect(mocks.decideDiscountApproval).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["owner"] }), "approval_1", "approved");
  });

  it.each(["admin", "system_admin", "admission_admin", "counsellor", "student", "alumni"])("returns 403 to %s approval access", async (role) => {
    const app = routeApp();
    authenticateAs([role]);

    expect((await app.request("/api/staff/discount-approvals")).status).toBe(403);
    expect((await postDecision(app)).status).toBe(403);
    expect(mocks.listDiscountApprovals).not.toHaveBeenCalled();
    expect(mocks.decideDiscountApproval).not.toHaveBeenCalled();
  });
});

describe("staff admission draft routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured field errors when route-level draft parsing fails", async () => {
    const app = routeApp();
    authenticateAs(["admission_admin"]);
    vi.mocked(admissionService.saveAdmissionDraftSchema.safeParse).mockReturnValueOnce({
      success: false,
      error: { issues: [{ path: ["payload"], message: "Expected object" }] },
    } as never);

    const response = await app.request("/api/staff/enquiries/enq_first/admission-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: null, currentStep: "identity" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "invalid_draft",
        message: "Please correct the highlighted fields.",
        fieldErrors: { payload: ["Expected object"] },
      },
    });
  });

  it("passes service field errors through on draft save failures", async () => {
    const app = routeApp();
    authenticateAs(["admission_admin"]);
    vi.mocked(admissionService.saveAdmissionDraft).mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: "invalid_mobile",
      message: "Please correct the highlighted fields.",
      fieldErrors: { "contact.primaryMobile": ["Enter a valid Indian primary mobile number."] },
    } as never);

    const response = await app.request("/api/staff/enquiries/enq_first/admission-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: {}, currentStep: "identity" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "invalid_mobile",
        fieldErrors: { "contact.primaryMobile": ["Enter a valid Indian primary mobile number."] },
      },
    });
  });
});

describe("staff student directory routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies unauthenticated direct student directory access", async () => {
    const app = routeApp();
    mocks.getSessionFromRequest.mockResolvedValue(null);

    const response = await app.request("/api/staff/students");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "forbidden" },
    });
  });

  it("denies direct student profile reads outside staff branch scope", async () => {
    const app = routeApp();
    authenticateAs(["counsellor"]);
    const db = studentProfileDb();

    const response = await app.request("/api/staff/students/student_bandra", {}, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(404);
  });

  it("allows direct student profile reads inside staff branch scope", async () => {
    const app = routeApp();
    authenticateAs(["counsellor"]);
    const db = studentProfileDb();

    const response = await app.request("/api/staff/students/student_sion", {}, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      student: {
        id: "student_sion",
        student_number: "SYK-SION-0001",
      },
      canMaintainContact: false,
    });
  });

  it("denies archived Person direct student profile reads", async () => {
    const app = routeApp();
    authenticateAs(["counsellor"]);
    const db = studentProfileDb();

    const response = await app.request("/api/staff/students/student_archived", {}, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(404);
  });
});

function studentProfileDb() {
  const db = new DatabaseSync(":memory:");
  installStudentProfileSchema(db);
  db.exec(`
    insert into roles values ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '2026-08-22T00:00:00.000Z');
    insert into login_account_roles values ('acct_test', 'role_counsellor', 'branch_sion', '2026-08-22T00:00:00.000Z');
    insert into people values ('person_sion', 'org_samyak', 'branch_sion', 'Sion Student', 'Sion Student', null, 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into students values ('student_sion', 'org_samyak', 'person_sion', 'branch_sion', 'SYK-SION-0001', 1, '2026-01-01', 'active', 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into people values ('person_bandra', 'org_samyak', 'branch_bandra', 'Band Stand Student', 'Band Student', null, 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into students values ('student_bandra', 'org_samyak', 'person_bandra', 'branch_bandra', 'SYK-BANDRA-0001', 1, '2026-01-01', 'active', 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into people values ('person_archived', 'org_samyak', 'branch_sion', 'Archived Student', 'Archived Student', null, 'archived', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into students values ('student_archived', 'org_samyak', 'person_archived', 'branch_sion', 'SYK-SION-ARCHIVED', 2, '2026-01-01', 'active', 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
  `);
  return db;
}

function installStudentProfileSchema(db: DatabaseSync) {
  db.exec(`
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table person_localities (id text primary key, person_id text, locality text, city text, status text, created_at text);
    create table education_records (id text primary key, person_id text, qualification_level text, created_at text);
    create table enrolments (id text primary key, student_id text, course_id text, enrolment_number text, joining_date text, created_at text);
    create table courses (id text primary key, name text);
    create table fee_agreements (id text primary key, enrolment_id text, final_agreed_fee_paise integer, payment_plan_type text);
    create table nsdc_profiles (id text primary key, enrolment_id text, status text);
    create table enquiries (id text primary key, person_id text, enquiry_number text, status text, created_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, display_value text, last_four text, is_primary integer, is_verified integer, verified_at text, created_at text, updated_at text);
    create table person_contact_details (contact_id text primary key, belongs_to text, contact_label text, is_whatsapp integer, valid_from text, valid_until text, status text, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table referrer_profiles (id text primary key, organisation_id text, person_id text, external_referrer_id text, referral_token text, personal_link text, active integer, created_at text, updated_at text);
    create table referral_links (id text primary key, organisation_id text, referral_programme_id text, referrer_profile_id text, token_hash text, token_last_four text, link_version integer, status text, activated_at text, expires_at text, revoked_at text, last_used_at text, created_at text, updated_at text);
    create table referral_link_secrets (referral_link_id text primary key, token_ciphertext text, encryption_version text, created_at text, updated_at text);
  `);
}

class D1Adapter {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new D1Statement(this.db, sql);
  }
}

class D1Statement {
  private values: SqlValue[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) ?? null) as T | null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) } as T;
  }
}
