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
  getAdmissionReceiptCorrectionCapability: vi.fn(() => ({ canReverse: false, reasonRequired: true, ownerOnly: true })),
  getAdmissionReceiptSummary: vi.fn(),
  listDiscountApprovals: mocks.listDiscountApprovals,
  recordAdmissionReceipt: vi.fn(),
  recordAdmissionReceiptSchema: { safeParse: vi.fn(() => ({ success: true, data: { admissionDraftId: "draft_1", amountPaise: 50000, paymentMode: "cash", idempotencyKey: "receipt_test" } })) },
  requestDiscountApproval: vi.fn(),
  reverseAdmissionReceipt: vi.fn(),
  saveAdmissionDraft: vi.fn(),
  saveAdmissionDraftSchema: { safeParse: vi.fn(() => ({ success: true, data: { payload: {}, currentStep: "review" } })) },
}));

function routeApp() {
  const app = new Hono();
  registerStaffAdmissionRoutes(app as never);
  return app;
}

function authenticateAs(roles: string[], organisationId = "org_samyak") {
  mocks.getSessionFromRequest.mockResolvedValue({
    record: {
      login_account_id: organisationId === "org_samyak" ? "acct_test" : `acct_${organisationId}`,
      active_person_id: organisationId === "org_samyak" ? "person_test" : `person_${organisationId}`,
      organisation_id: organisationId,
    },
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

describe("staff admission enquiry detail routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(admissionService.getAdmissionDraft).mockResolvedValue(null);
  });

  it("uses the authenticated Organisation for enquiry detail reads", async () => {
    const app = routeApp();
    const db = admissionDetailDb();
    authenticateAs(["owner"], "org_rememo");

    const response = await app.request("/api/staff/enquiries/enq_rememo", undefined, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enquiry: {
        id: "enq_rememo",
        organisation_id: "org_rememo",
        enquiry_number: "RMO-001",
        branch_name: "Demo Branch",
        course_name: "Demo Course",
      },
      personLinkCandidate: {
        displayName: "Demo Prospect",
        enquiryNumber: "RMO-001",
      },
    });
    const draftContext = vi.mocked(admissionService.getAdmissionDraft).mock.calls[0]?.[0] as { get?: (key: string) => string | undefined };
    expect(draftContext.get?.("authenticatedOrganisationId")).toBe("org_rememo");
  });

  it("does not allow an authenticated Demo owner to read Samyak enquiry detail", async () => {
    const app = routeApp();
    const db = admissionDetailDb();
    authenticateAs(["owner"], "org_rememo");

    const response = await app.request("/api/staff/enquiries/enq_samyak", undefined, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "enquiry_not_found" },
    });
  });
});

describe("staff Course Master onboarding synchronisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateAs(["owner"]);
  });

  it("completes courses and fees after creating an active priced Course", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: "FSD", status: "active" });

    expect(response.status).toBe(201);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      status: "in_progress",
      completedSteps: ["organisation_profile", "centre_profile", "owner_account", "courses", "fees"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: true },
        { code: "fees", label: "Fees", done: true },
      ]),
    });
    expect(count(db, "audit_logs where action = 'onboarding_step_completed'")).toBe(2);
    expect(metadataRows(db)).toEqual(expect.arrayContaining([{ step: "courses", source: "course_state" }, { step: "fees", source: "course_pricing" }]));
  });

  it("marks only fees when courses onboarding is already complete", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    markOnboardingCoursesComplete(db, "org_samyak");

    const response = await createCourse(app, db, { code: "FEESONLY", status: "active" });

    expect(response.status).toBe(201);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      completedSteps: ["organisation_profile", "centre_profile", "owner_account", "courses", "fees"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: true },
        { code: "fees", label: "Fees", done: true },
        { code: "staff_invitations", label: "Staff invitations", done: false },
      ]),
    });
    expect(metadataRows(db)).toEqual([{ step: "fees", source: "course_pricing" }]);
  });

  it("keeps fees onboarding atomic when the fees audit insert fails and retries exactly once", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    markOnboardingCoursesComplete(db, "org_samyak");
    db.exec(`
      create trigger reject_fees_onboarding_audit
      before insert on audit_logs
      when new.action = 'onboarding_step_completed'
       and new.metadata_json = '{"step":"fees","source":"course_pricing"}'
      begin
        select raise(abort, 'forced fees audit failure');
      end;
    `);

    const create = await createCourse(app, db, { code: "FEEFAIL", status: "active" });

    expect(create.status).toBe(201);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      completedSteps: ["organisation_profile", "centre_profile", "owner_account", "courses"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: true },
        { code: "fees", label: "Fees", done: false },
      ]),
    });
    expect(metadataRows(db)).toEqual([]);

    db.exec("drop trigger reject_fees_onboarding_audit");
    const courseId = row(db, "select id from courses where code = 'FEEFAIL'")?.id;
    const retry = await patchCourse(app, db, String(courseId), { name: "Fees Retry Course" });

    expect(retry.status).toBe(200);
    expect(onboardingState(db, "org_samyak").completedSteps.filter((step) => step === "fees")).toHaveLength(1);
    expect(metadataRows(db)).toEqual([{ step: "fees", source: "course_pricing" }]);
  });

  it("rolls back onboarding progress when the transition audit insert fails and can retry safely", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    db.exec(`
      create trigger reject_courses_onboarding_audit
      before insert on audit_logs
      when new.action = 'onboarding_step_completed'
      begin
        select raise(abort, 'forced onboarding audit failure');
      end;
    `);

    const create = await createCourse(app, db, { code: "BATCH", status: "active" });

    expect(create.status).toBe(201);
    expect(count(db, "courses where organisation_id = 'org_samyak' and code = 'BATCH'")).toBe(1);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      status: "in_progress",
      completedSteps: ["organisation_profile", "centre_profile", "owner_account"],
      checklist: expect.arrayContaining([{ code: "courses", label: "Courses", done: false }]),
    });
    expect(count(db, "audit_logs where action = 'onboarding_step_completed'")).toBe(0);

    db.exec("drop trigger reject_courses_onboarding_audit");
    const courseId = row(db, "select id from courses where code = 'BATCH'")?.id;
    const retry = await patchCourse(app, db, String(courseId), { name: "Batch Retry Course" });

    expect(retry.status).toBe(200);
    const state = onboardingState(db, "org_samyak");
    expect(state.completedSteps.filter((step) => step === "courses")).toHaveLength(1);
    expect(state.completedSteps.filter((step) => step === "fees")).toHaveLength(1);
    expect(state.checklist).toEqual(expect.arrayContaining([
      { code: "courses", label: "Courses", done: true },
      { code: "fees", label: "Fees", done: true },
    ]));
    expect(count(db, "audit_logs where action = 'onboarding_step_completed'")).toBe(2);
  });

  it.each(["inactive", "archived"] as const)("does not complete courses after creating a %s configured Course", async (status) => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: status === "inactive" ? "INA" : "ARC", status });

    expect(response.status).toBe(201);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      status: "in_progress",
      completedSteps: ["organisation_profile", "centre_profile", "owner_account"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: false },
        { code: "fees", label: "Fees", done: false },
      ]),
    });
    expect(count(db, "audit_logs where action = 'onboarding_step_completed'")).toBe(0);
  });

  it.each(["inactive", "archived"] as const)("allows a %s Course to be saved without pricing", async (status) => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, {
      code: status === "inactive" ? "DRAFT" : "ARCHDRAFT",
      status,
      standardFeePaise: null,
      lowestAcceptableFeePaise: null,
    });

    expect(response.status).toBe(201);
    expect(row(db, "select default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete from courses where status = ?", status)).toMatchObject({
      default_fee_paise: null,
      lowest_acceptable_fee_paise: null,
      admission_configuration_complete: 0,
    });
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      completedSteps: ["organisation_profile", "centre_profile", "owner_account"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: false },
        { code: "fees", label: "Fees", done: false },
      ]),
    });
  });

  it("keeps an unpriced inactive Course out of active admission choices", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    await createCourse(app, db, {
      code: "DRAFT",
      status: "inactive",
      standardFeePaise: null,
      lowestAcceptableFeePaise: null,
    });

    const activeChoices = await app.request("/api/staff/courses/active", {}, { DB: new D1Adapter(db) });

    await expect(activeChoices.json()).resolves.toMatchObject({ courses: [] });
  });

  it("rejects an active Course without a listed price", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: "NOPRICE", status: "active", standardFeePaise: null, lowestAcceptableFeePaise: null });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "invalid_course", message: "Set a listed price greater than 0 before activating this course." } });
    expect(count(db, "courses where code = 'NOPRICE'")).toBe(0);
  });

  it.each([
    ["inactive", "INAZERO"],
    ["active", "ACTZERO"],
  ] as const)("rejects a %s Course with zero listed price", async (status, code) => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code, status, standardFeePaise: 0, lowestAcceptableFeePaise: null });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "invalid_course", message: "Set a listed price greater than 0." } });
    expect(count(db, `courses where code = '${code}'`)).toBe(0);
  });

  it("defaults blank lowest acceptable fee to the listed price when saving with pricing", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: "ONEFEE", status: "active", standardFeePaise: 1, lowestAcceptableFeePaise: undefined });

    expect(response.status).toBe(201);
    expect(row(db, "select default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete from courses where code = 'ONEFEE'")).toMatchObject({
      default_fee_paise: 1,
      lowest_acceptable_fee_paise: 1,
      admission_configuration_complete: 1,
    });
  });

  it("rejects zero lowest acceptable fee", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: "ZEROFLOOR", standardFeePaise: 1000000, lowestAcceptableFeePaise: 0 });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "invalid_course", message: "Set lowest acceptable fee greater than 0." } });
  });

  it("accepts an explicit positive lower floor", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: "LOWERFLOOR", standardFeePaise: 1500000, lowestAcceptableFeePaise: 1200000 });

    expect(response.status).toBe(201);
    expect(row(db, "select default_fee_paise, lowest_acceptable_fee_paise from courses where code = 'LOWERFLOOR'")).toMatchObject({
      default_fee_paise: 1500000,
      lowest_acceptable_fee_paise: 1200000,
    });
  });

  it("requires pricing before an inactive Course can be activated", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_unpriced", status: "inactive", admissionConfigurationComplete: 0, defaultFeePaise: null, lowestAcceptableFeePaise: null });

    const withoutPrice = await patchCourse(app, db, "course_unpriced", { status: "active" });
    expect(withoutPrice.status).toBe(400);
    expect(row(db, "select status, default_fee_paise from courses where id = 'course_unpriced'")).toMatchObject({ status: "inactive", default_fee_paise: null });

    const withPrice = await patchCourse(app, db, "course_unpriced", { status: "active", standardFeePaise: 1200000, lowestAcceptableFeePaise: null });
    expect(withPrice.status).toBe(200);
    expect(row(db, "select status, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete from courses where id = 'course_unpriced'")).toMatchObject({
      status: "active",
      default_fee_paise: 1200000,
      lowest_acceptable_fee_paise: 1200000,
      admission_configuration_complete: 1,
    });
    expect(onboardingState(db, "org_samyak").completedSteps).toEqual(expect.arrayContaining(["courses", "fees"]));
  });

  it("rejects a lowest acceptable fee above listed price", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();

    const response = await createCourse(app, db, { code: "BADFLOOR", standardFeePaise: 1000000, lowestAcceptableFeePaise: 1200000 });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "invalid_course", message: "Lowest acceptable fee cannot exceed listed price." } });
  });

  it("preserves an existing explicit floor when listed price increases", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_floor", status: "inactive", admissionConfigurationComplete: 1, defaultFeePaise: 1500000, lowestAcceptableFeePaise: 1200000 });

    const response = await patchCourse(app, db, "course_floor", { standardFeePaise: 1600000 });

    expect(response.status).toBe(200);
    expect(row(db, "select default_fee_paise, lowest_acceptable_fee_paise from courses where id = 'course_floor'")).toMatchObject({
      default_fee_paise: 1600000,
      lowest_acceptable_fee_paise: 1200000,
    });
  });

  it("rejects listed price reduction below an existing explicit floor", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_floor_block", status: "inactive", admissionConfigurationComplete: 1, defaultFeePaise: 1500000, lowestAcceptableFeePaise: 1200000 });

    const response = await patchCourse(app, db, "course_floor_block", { standardFeePaise: 1000000 });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "invalid_course", message: "Lowest acceptable fee cannot exceed listed price." } });
    expect(row(db, "select default_fee_paise, lowest_acceptable_fee_paise from courses where id = 'course_floor_block'")).toMatchObject({
      default_fee_paise: 1500000,
      lowest_acceptable_fee_paise: 1200000,
    });
  });

  it("allows pricing to be cleared only after a Course is inactive", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_clear_price", status: "inactive", admissionConfigurationComplete: 1, defaultFeePaise: 1500000, lowestAcceptableFeePaise: 1200000 });

    const response = await patchCourse(app, db, "course_clear_price", { standardFeePaise: null, lowestAcceptableFeePaise: null });

    expect(response.status).toBe(200);
    expect(row(db, "select default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete from courses where id = 'course_clear_price'")).toMatchObject({
      default_fee_paise: null,
      lowest_acceptable_fee_paise: null,
      admission_configuration_complete: 0,
    });
  });

  it("rejects pricing removal from an active Course", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_active_clear", status: "active", admissionConfigurationComplete: 1, defaultFeePaise: 1500000, lowestAcceptableFeePaise: 1200000 });

    const response = await patchCourse(app, db, "course_active_clear", { standardFeePaise: null, lowestAcceptableFeePaise: null });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: "invalid_course", message: "Set a listed price greater than 0 before activating this course." } });
    expect(row(db, "select status, default_fee_paise, lowest_acceptable_fee_paise from courses where id = 'course_active_clear'")).toMatchObject({
      status: "active",
      default_fee_paise: 1500000,
      lowest_acceptable_fee_paise: 1200000,
    });
  });

  it("completes courses when an existing configured inactive Course is updated to active", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_inactive", status: "inactive", admissionConfigurationComplete: 1 });

    const response = await patchCourse(app, db, "course_inactive", { status: "active" });

    expect(response.status).toBe(200);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      completedSteps: ["organisation_profile", "centre_profile", "owner_account", "courses", "fees"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: true },
        { code: "fees", label: "Fees", done: true },
      ]),
    });
  });

  it("waits until canonical Course configuration becomes complete before completing courses", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_incomplete", status: "active", admissionConfigurationComplete: 0, defaultFeePaise: null, lowestAcceptableFeePaise: null });

    const unchanged = await patchCourse(app, db, "course_incomplete", { status: "active" });
    expect(unchanged.status).toBe(400);
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      completedSteps: ["organisation_profile", "centre_profile", "owner_account"],
      checklist: expect.arrayContaining([{ code: "courses", label: "Courses", done: false }]),
    });

    const configured = await patchCourse(app, db, "course_incomplete", {
      durationMonths: 4,
      standardFeePaise: 3200000,
      lowestAcceptableFeePaise: 2800000,
    });

    expect(configured.status).toBe(200);
    expect(row(db, "select admission_configuration_complete from courses where id = 'course_incomplete'")).toMatchObject({ admission_configuration_complete: 1 });
    expect(onboardingState(db, "org_samyak")).toMatchObject({
      completedSteps: ["organisation_profile", "centre_profile", "owner_account", "courses", "fees"],
      checklist: expect.arrayContaining([
        { code: "courses", label: "Courses", done: true },
        { code: "fees", label: "Fees", done: true },
      ]),
    });
  });

  it("keeps courses completion monotonic and does not duplicate steps or audits", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    await createCourse(app, db, { code: "FSD", status: "active" });

    const courseId = row(db, "select id from courses where code = 'FSD'")?.id;
    const response = await patchCourse(app, db, String(courseId), { status: "inactive" });

    expect(response.status).toBe(200);
    const state = onboardingState(db, "org_samyak");
    expect(state.completedSteps.filter((step) => step === "courses")).toHaveLength(1);
    expect(state.completedSteps.filter((step) => step === "fees")).toHaveLength(1);
    expect(state.checklist).toEqual(expect.arrayContaining([
      { code: "courses", label: "Courses", done: true },
      { code: "fees", label: "Fees", done: true },
    ]));
    expect(count(db, "audit_logs where action = 'onboarding_step_completed'")).toBe(2);
  });

  it("does not fabricate onboarding rows for existing Organisations without onboarding progress", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    db.prepare("delete from organisation_onboarding_progress where organisation_id = ?").run("org_samyak");
    seedCourse(db, { id: "course_no_onboarding", status: "inactive", admissionConfigurationComplete: 1 });

    const create = await createCourse(app, db, { code: "NOROW", status: "active" });
    const update = await patchCourse(app, db, "course_no_onboarding", { status: "active" });

    expect(create.status).toBe(201);
    expect(update.status).toBe(200);
    expect(count(db, "courses where organisation_id = 'org_samyak' and code = 'NOROW'")).toBe(1);
    expect(row(db, "select status from courses where id = 'course_no_onboarding'")).toMatchObject({ status: "active" });
    expect(count(db, "organisation_onboarding_progress where organisation_id = 'org_samyak'")).toBe(0);
  });

  it("uses the authenticated Organisation when synchronising onboarding", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    authenticateAs(["owner"], "org_rememo");

    const response = await createCourse(app, db, { code: "REMOTE", status: "active" });

    expect(response.status).toBe(201);
    expect(onboardingState(db, "org_rememo").completedSteps).toContain("courses");
    expect(onboardingState(db, "org_rememo").completedSteps).toContain("fees");
    expect(onboardingState(db, "org_samyak").completedSteps).not.toContain("courses");
    expect(onboardingState(db, "org_samyak").completedSteps).not.toContain("fees");
  });

  it("keeps Course mutations successful and malformed onboarding state unchanged", async () => {
    const app = routeApp();
    const db = courseOnboardingDb();
    seedCourse(db, { id: "course_bad_json", status: "inactive", admissionConfigurationComplete: 1 });
    db.prepare("update organisation_onboarding_progress set checklist_json = ? where organisation_id = ?").run("{bad", "org_samyak");

    const create = await createCourse(app, db, { code: "BADJSON", status: "active" });
    const update = await patchCourse(app, db, "course_bad_json", { status: "active" });

    expect(create.status).toBe(201);
    expect(update.status).toBe(200);
    expect(count(db, "courses where organisation_id = 'org_samyak' and code = 'BADJSON'")).toBe(1);
    expect(row(db, "select status from courses where id = 'course_bad_json'")).toMatchObject({ status: "active" });
    expect(row(db, "select checklist_json from organisation_onboarding_progress where organisation_id = 'org_samyak'")).toMatchObject({ checklist_json: "{bad" });
  });
});

describe("staff admission receipt routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(admissionService.recordAdmissionReceipt).mockResolvedValue({ ok: true, receipt: { receiptNumber: "RCP-SION-2026-000001" }, financialSummary: {} } as never);
    vi.mocked(admissionService.reverseAdmissionReceipt).mockResolvedValue({ ok: true, receipt: { receiptNumber: "RCP-SION-2026-000001" }, financialSummary: {} } as never);
  });

  it("requires same-origin before recording or reversing admission receipts", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const record = await app.request("http://portal.test/api/staff/admissions/enq_first/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
      body: "{}",
    });
    const reverse = await app.request("http://portal.test/api/staff/admissions/enq_first/receipts/receipt_1/reversal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.test" },
      body: JSON.stringify({ reason: "Wrong amount", expectedReceiptVersion: "receipt:version-token", idempotencyKey: "reverse_route_test" }),
    });

    expect(record.status).toBe(403);
    expect(reverse.status).toBe(403);
    expect(admissionService.recordAdmissionReceipt).not.toHaveBeenCalled();
    expect(admissionService.reverseAdmissionReceipt).not.toHaveBeenCalled();
  });

  it.each(["system_admin", "admin", "admission_admin", "counsellor"])("denies %s admission receipt reversal at the route", async (role) => {
    const app = routeApp();
    authenticateAs([role]);

    const response = await app.request("http://portal.test/api/staff/admissions/enq_first/receipts/receipt_1/reversal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({ reason: "Wrong amount", expectedReceiptVersion: "receipt:version-token", idempotencyKey: "reverse_route_test" }),
    });

    expect(response.status).toBe(403);
    expect(admissionService.reverseAdmissionReceipt).not.toHaveBeenCalled();
  });

  it("allows owner admission receipt reversal through the route", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const response = await app.request("http://portal.test/api/staff/admissions/enq_first/receipts/receipt_1/reversal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({ reason: "Wrong amount", expectedReceiptVersion: "receipt:version-token", idempotencyKey: "reverse_route_test" }),
    });

    expect(response.status).toBe(200);
    expect(admissionService.reverseAdmissionReceipt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ roles: ["owner"] }), "enq_first", "receipt_1", expect.objectContaining({ idempotencyKey: "reverse_route_test" }));
  });

  it("rejects whitespace-only reversal reasons before admission receipt reversal service execution", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);

    const response = await app.request("http://portal.test/api/staff/admissions/enq_first/receipts/receipt_1/reversal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://portal.test" },
      body: JSON.stringify({ reason: "   \n  ", expectedReceiptVersion: "receipt:version-token", idempotencyKey: "reverse_blank_reason" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_receipt_reversal" } });
    expect(admissionService.reverseAdmissionReceipt).not.toHaveBeenCalled();
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

  it("allows owner basic detail edits through the narrow student endpoint", async () => {
    const app = routeApp();
    authenticateAs(["owner"]);
    const db = studentProfileDb("owner");
    const versionResponse = await app.request("http://localhost/api/staff/students/student_sion", {}, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });
    const versionBody = await versionResponse.json() as { basicDetailsVersion: string };

    const response = await app.request("http://localhost/api/staff/students/student_sion/basic-details", {
      method: "PATCH",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "  Md. Arif Khan  ", expectedBasicDetailsVersion: versionBody.basicDetailsVersion }),
    }, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, studentId: "student_sion", personId: "person_sion", fullName: "Md. Arif Khan" });
    expect(row(db, "select full_name, public_name from people where id = 'person_sion'")).toMatchObject({ full_name: "Md. Arif Khan", public_name: "Md. Arif Khan" });
    expect(row(db, "select official_full_name from person_identity_details where person_id = 'person_sion'")).toMatchObject({ official_full_name: "Md. Arif Khan" });
  });

  it.each(["admin", "system_admin", "admission_admin", "counsellor", "student", "partner"])("denies %s student basic detail edits", async (role) => {
    const app = routeApp();
    authenticateAs([role]);
    const db = studentProfileDb(role);
    const response = await app.request("http://localhost/api/staff/students/student_sion/basic-details", {
      method: "PATCH",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Blocked Name", expectedBasicDetailsVersion: "version-token-123456" }),
    }, { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(403);
    expect(row(db, "select full_name from people where id = 'person_sion'")).toMatchObject({ full_name: "Sion Student" });
  });

  it("denies unauthenticated student basic detail edits", async () => {
    const app = routeApp();
    mocks.getSessionFromRequest.mockResolvedValue(null);
    const response = await app.request("http://localhost/api/staff/students/student_sion/basic-details", {
      method: "PATCH",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "Blocked Name", expectedBasicDetailsVersion: "version-token-123456" }),
    }, { DB: new D1Adapter(studentProfileDb()), SESSION_PEPPER: "test-pepper" });

    expect(response.status).toBe(403);
  });
});

function studentProfileDb(roleCode = "counsellor") {
  const db = new DatabaseSync(":memory:");
  installStudentProfileSchema(db);
  const roleId = `role_${roleCode}`;
  db.exec(`
    insert into roles values ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '2026-08-22T00:00:00.000Z');
    insert into roles values ('role_owner', 'org_samyak', 'owner', 'Owner', '2026-08-22T00:00:00.000Z');
    insert into roles values ('role_admin', 'org_samyak', 'admin', 'Admin', '2026-08-22T00:00:00.000Z');
    insert into roles values ('role_system_admin', 'org_samyak', 'system_admin', 'System Admin', '2026-08-22T00:00:00.000Z');
    insert into roles values ('role_admission_admin', 'org_samyak', 'admission_admin', 'Admission Admin', '2026-08-22T00:00:00.000Z');
    insert into roles values ('role_student', 'org_samyak', 'student', 'Student', '2026-08-22T00:00:00.000Z');
    insert into roles values ('role_partner', 'org_samyak', 'partner', 'Partner', '2026-08-22T00:00:00.000Z');
    insert into people values ('person_sion', 'org_samyak', 'branch_sion', 'Sion Student', 'Sion Student', null, 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into person_identity_details values ('person_sion', 'Sion Student', '2000-01-01', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into students values ('student_sion', 'org_samyak', 'person_sion', 'branch_sion', 'SYK-SION-0001', 1, '2026-01-01', 'active', 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into people values ('person_bandra', 'org_samyak', 'branch_bandra', 'Band Stand Student', 'Band Student', null, 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into person_identity_details values ('person_bandra', 'Band Stand Student', '2000-01-01', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into students values ('student_bandra', 'org_samyak', 'person_bandra', 'branch_bandra', 'SYK-BANDRA-0001', 1, '2026-01-01', 'active', 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into people values ('person_archived', 'org_samyak', 'branch_sion', 'Archived Student', 'Archived Student', null, 'archived', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
    insert into students values ('student_archived', 'org_samyak', 'person_archived', 'branch_sion', 'SYK-SION-ARCHIVED', 2, '2026-01-01', 'active', 'active', '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
  `);
  db.prepare("insert into login_account_roles values ('acct_test', ?, 'branch_sion', '2026-08-22T00:00:00.000Z')").run(roleId);
  return db;
}

function installStudentProfileSchema(db: DatabaseSync) {
  db.exec(`
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table person_localities (id text primary key, person_id text, locality text, city text, status text, created_at text);
    create table education_records (id text primary key, person_id text, qualification_level text, created_at text);
    create table enrolments (id text primary key, student_id text, course_id text, enrolment_number text, joining_date text, created_at text);
    create table courses (id text primary key, name text);
    create table fee_agreements (id text primary key, enrolment_id text, final_agreed_fee_paise integer, payment_plan_type text);
    create table receipts (id text primary key, enrolment_id text, amount_paise integer, status text);
    create table receipt_reversals (id text primary key, receipt_id text);
    create table nsdc_profiles (id text primary key, enrolment_id text, status text);
    create table batches (id text primary key, branch_id text, course_id text, name text, primary_trainer_person_id text, days_of_week_json text, start_time text, end_time text, capacity integer, status text, created_at text, updated_at text);
    create table batch_memberships (id text primary key, batch_id text, enrolment_id text, joined_at text, left_at text, status text);
    create table enquiries (id text primary key, person_id text, enquiry_number text, status text, created_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, display_value text, last_four text, is_primary integer, is_verified integer, verified_at text, created_at text, updated_at text);
    create table person_contact_details (contact_id text primary key, belongs_to text, contact_label text, is_whatsapp integer, valid_from text, valid_until text, status text, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table referrer_profiles (id text primary key, organisation_id text, person_id text, external_referrer_id text, referral_token text, personal_link text, active integer, created_at text, updated_at text);
    create table referral_links (id text primary key, organisation_id text, referral_programme_id text, referrer_profile_id text, token_hash text, token_last_four text, link_version integer, status text, activated_at text, expires_at text, revoked_at text, last_used_at text, created_at text, updated_at text);
    create table referral_link_secrets (referral_link_id text primary key, token_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, metadata_json text, created_at text);
  `);
}

function admissionDetailDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table branches (id text primary key, organisation_id text, code text, name text);
    create table courses (id text primary key, organisation_id text, code text, name text);
    create table people (id text primary key, organisation_id text, full_name text, date_of_birth text);
    create table students (id text primary key, organisation_id text, person_id text, student_number text);
    create table enquiries (
      id text primary key,
      organisation_id text not null,
      branch_id text,
      person_id text,
      course_interest_id text,
      enquiry_number text,
      status text,
      created_at text,
      updated_at text
    );
    create table enquiry_course_interests (enquiry_id text primary key, course_interest_text text);
    create table enrolments (id text primary key, organisation_id text, student_id text, course_id text, enrolment_number text, status text, joining_date text, created_at text);
    create table referrals (
      id text primary key,
      organisation_id text not null,
      enquiry_id text,
      prospect_name text,
      referral_link_id text,
      prospect_mobile_hash text,
      prospect_mobile_ciphertext text
    );

    insert into branches values ('branch_samyak', 'org_samyak', 'SYK', 'Samyak Branch');
    insert into branches values ('branch_rememo', 'org_rememo', 'RMO', 'Demo Branch');
    insert into courses values ('course_samyak', 'org_samyak', 'SYK-FSD', 'Samyak Course');
    insert into courses values ('course_rememo', 'org_rememo', 'RMO-FSD', 'Demo Course');
    insert into enquiries values ('enq_samyak', 'org_samyak', 'branch_samyak', null, 'course_samyak', 'SYK-001', 'new', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z');
    insert into enquiries values ('enq_rememo', 'org_rememo', 'branch_rememo', null, 'course_rememo', 'RMO-001', 'new', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z');
    insert into enquiry_course_interests values ('enq_rememo', 'Demo Course');
    insert into referrals values ('ref_samyak', 'org_samyak', 'enq_samyak', 'Samyak Prospect', null, null, null);
    insert into referrals values ('ref_rememo', 'org_rememo', 'enq_rememo', 'Demo Prospect', null, null, null);
  `);
  return db;
}

function courseOnboardingDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table courses (
      id text primary key,
      organisation_id text not null,
      code text not null,
      name text not null,
      category_id text,
      duration_label text,
      duration_months real,
      default_fee_paise integer,
      lowest_acceptable_fee_paise integer,
      admission_configuration_complete integer not null default 0,
      nsdc_available integer,
      status text not null,
      created_at text,
      updated_at text
    );
    create unique index courses_org_code_unique on courses (organisation_id, code);
    create table organisation_onboarding_progress (
      organisation_id text primary key,
      status text not null,
      completed_steps_json text not null,
      checklist_json text not null,
      reported_centre_count integer,
      created_at text not null,
      updated_at text not null
    );
    create table admission_discount_approvals (
      id text primary key,
      organisation_id text,
      course_id text,
      status text,
      updated_at text
    );
    create table audit_logs (
      id text primary key,
      organisation_id text,
      branch_id text,
      actor_login_account_id text,
      actor_person_id text,
      action text,
      entity_type text,
      entity_id text,
      metadata_json text,
      created_at text
    );
  `);
  insertCourseOnboarding(db, "org_samyak");
  insertCourseOnboarding(db, "org_rememo");
  return db;
}

function insertCourseOnboarding(db: DatabaseSync, organisationId: string) {
  const checklist = [
    { code: "organisation_profile", label: "Organisation profile", done: true },
    { code: "centre_profile", label: "Centre profile", done: true },
    { code: "owner_account", label: "Owner account", done: true },
    { code: "courses", label: "Courses", done: false },
    { code: "fees", label: "Fees", done: false },
    { code: "staff_invitations", label: "Staff invitations", done: false },
    { code: "branding", label: "Branding", done: false },
    { code: "data_import", label: "Data import", done: false },
  ];
  db.prepare(
    "insert into organisation_onboarding_progress (organisation_id, status, completed_steps_json, checklist_json, reported_centre_count, created_at, updated_at) values (?, 'in_progress', ?, ?, 1, ?, ?)",
  ).run(organisationId, JSON.stringify(["organisation_profile", "centre_profile", "owner_account"]), JSON.stringify(checklist), "2026-09-30T00:00:00.000Z", "2026-09-30T00:00:00.000Z");
}

async function createCourse(app: Hono, db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}) {
  return app.request("/api/staff/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "FSD",
      name: "Full Stack Development",
      durationLabel: "6 months",
      durationMonths: 6,
      standardFeePaise: 5000000,
      lowestAcceptableFeePaise: 4000000,
      nsdcAvailable: false,
      status: "active",
      ...overrides,
    }),
  }, { DB: new D1Adapter(db) });
}

async function patchCourse(app: Hono, db: DatabaseSync, courseId: string, body: Record<string, unknown>) {
  return app.request(`/api/staff/courses/${courseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: new D1Adapter(db) });
}

function seedCourse(db: DatabaseSync, input: { id: string; organisationId?: string; status: string; admissionConfigurationComplete: 0 | 1; defaultFeePaise?: number | null; lowestAcceptableFeePaise?: number | null }) {
  db.prepare(
    `insert into courses
       (id, organisation_id, code, name, category_id, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
     values (?, ?, ?, ?, null, '6 months', 6, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    input.id,
    input.organisationId ?? "org_samyak",
    input.id.toUpperCase(),
    "Seeded Course",
    input.defaultFeePaise !== undefined ? input.defaultFeePaise : 5000000,
    input.lowestAcceptableFeePaise !== undefined ? input.lowestAcceptableFeePaise : 4000000,
    input.admissionConfigurationComplete,
    input.status,
    "2026-09-30T00:00:00.000Z",
    "2026-09-30T00:00:00.000Z",
  );
}

function onboardingState(db: DatabaseSync, organisationId: string) {
  const progress = row(db, "select status, completed_steps_json, checklist_json from organisation_onboarding_progress where organisation_id = ?", organisationId)!;
  return {
    status: progress.status,
    completedSteps: JSON.parse(progress.completed_steps_json) as string[],
    checklist: JSON.parse(progress.checklist_json) as Array<{ code: string; label: string; done: boolean }>,
  };
}

function markOnboardingCoursesComplete(db: DatabaseSync, organisationId: string) {
  const state = onboardingState(db, organisationId);
  const completedSteps = state.completedSteps.includes("courses") ? state.completedSteps : [...state.completedSteps, "courses"];
  const checklist = state.checklist.map((item) => item.code === "courses" ? { ...item, done: true } : item);
  db.prepare("update organisation_onboarding_progress set completed_steps_json = ?, checklist_json = ? where organisation_id = ?").run(JSON.stringify(completedSteps), JSON.stringify(checklist), organisationId);
}

function row(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).get(...values) as Record<string, any> | undefined;
}

function count(db: DatabaseSync, tableAndWhere: string) {
  return Number(row(db, `select count(*) as count from ${tableAndWhere}`)?.count ?? 0);
}

function metadataRows(db: DatabaseSync) {
  return db.prepare("select metadata_json from audit_logs where action = 'onboarding_step_completed' order by metadata_json").all().map((audit) => JSON.parse(String(audit.metadata_json)));
}

class D1Adapter {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new D1Statement(this.db, sql);
  }
  async batch(statements: D1Statement[]) {
    this.db.exec("begin");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("commit");
      return results;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
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
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}
