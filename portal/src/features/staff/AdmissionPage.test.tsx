import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  confirmAdmission: vi.fn(),
  getAdmissionConfiguration: vi.fn(),
  getAdmissionDraft: vi.fn(),
  getActiveCourses: vi.fn(),
  getEnquiryDetail: vi.fn(),
  requestDiscountApproval: vi.fn(),
  saveAdmissionDraft: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    confirmAdmission: apiMocks.confirmAdmission,
    getAdmissionConfiguration: apiMocks.getAdmissionConfiguration,
    getAdmissionDraft: apiMocks.getAdmissionDraft,
    getActiveCourses: apiMocks.getActiveCourses,
    getEnquiryDetail: apiMocks.getEnquiryDetail,
    requestDiscountApproval: apiMocks.requestDiscountApproval,
    saveAdmissionDraft: apiMocks.saveAdmissionDraft,
  };
});

import {
  AdmissionPage,
  AdmissionLockedFieldset,
  AdmissionConfigurationMissing,
  AdmissionRecoveryNotice,
  AdmissionSuccess,
  OptionSelect,
  PaymentPlanField,
  admissionFieldId,
  admissionReview,
  allowedPaymentRulesForCourse,
  configuredAdmissionCourses,
  courseForReview,
  defaultAdmissionPayload,
  draftSavedMessage,
  emptyAdmissionConfiguration,
  isAdmissionLockedError,
  isAdmissionConfigurationReady,
  mergeDraftResponsePayload,
  mergeAdmissionPayload,
  paymentPlanPolicyMessage,
  shouldSaveDraftBeforeConfirm,
} from "./AdmissionPage";
import { ApiError } from "../../lib/api";

const course = {
  id: "course_full_stack",
  code: "FSD",
  name: "Full Stack",
  duration_label: "6 months",
  duration_months: 6,
  default_fee_paise: 5000000,
  lowest_acceptable_fee_paise: 4000000,
  admission_configuration_complete: true,
  nsdc_available: true,
  status: "active",
};

describe("AdmissionPage helpers", () => {
  it("builds a default draft from enquiry detail", () => {
    const payload = defaultAdmissionPayload({
      enquiry: { full_name: "Asha Student", date_of_birth: "2001-02-03", course_id: "course_full_stack", branch_id: "branch_sion" },
      primaryMobile: "+919876543210",
      mobileDisplay: "******3210",
      previousEnrolments: [],
      activeDraft: null,
    });

    expect(payload.identity.officialFullName).toBe("Asha Student");
    expect(payload.identity.dateOfBirth).toBe("2001-02-03");
    expect(payload.contact.primaryMobile).toBe("+919876543210");
    expect(payload.course.courseId).toBe("course_full_stack");
  });

  it("continues a saved draft without losing default sections", () => {
    const merged = mergeAdmissionPayload(defaultAdmissionPayload(), {
      identity: { officialFullName: "Asha Student" },
      locality: { locality: "Sion", city: "Mumbai" },
    });

    expect(merged.identity.officialFullName).toBe("Asha Student");
    expect(merged.locality.city).toBe("Mumbai");
    expect(merged.declarations.dataProcessingAccepted).toBe(false);
  });

  it("preserves in-session mobiles when the saved draft response redacts contact values", () => {
    const payload = defaultAdmissionPayload();
    payload.contact.primaryMobile = "+919876543210";
    payload.contact.alternateMobile = "+919876543211";

    const merged = mergeDraftResponsePayload(payload, { contact: { primaryMobile: "", alternateMobile: "" } });

    expect(merged.contact.primaryMobile).toBe("+919876543210");
    expect(merged.contact.alternateMobile).toBe("+919876543211");
  });

  it("calculates final fee discount and review readiness", () => {
    const payload = readyPayload();
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "Scholarship";
    payload.fee.discountReasonCode = "scholarship_financial_support";
    const review = admissionReview(payload, course);

    expect(review.discountPaise).toBe(500000);
    expect(review.canConfirmRegularAdmission).toBe(true);
  });

  it("uses Course Master fee over draft display fee in review calculations", () => {
    const payload = readyPayload();
    payload.fee.standardFeePaise = 1;
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "Scholarship";
    payload.fee.discountReasonCode = "scholarship_financial_support";

    expect(admissionReview(payload, course).discountPaise).toBe(500000);
  });

  it("shows NSDC readiness separately from regular admission readiness", () => {
    const payload = readyPayload();
    payload.course.nsdcPreference = "yes";
    let review = admissionReview(payload, course);
    expect(review.canConfirmRegularAdmission).toBe(true);
    expect(review.nsdcReady).toBe(false);

    payload.identity.fatherName = "Ramesh Student";
    payload.declarations.nsdcProcessingAccepted = true;
    payload.declarations.nsdcPendingDocumentsUnderstood = true;
    review = admissionReview(payload, course);
    expect(review.nsdcReady).toBe(true);
  });

  it("renders confirmation success with Student ID and enrolment number", () => {
    const html = renderToStaticMarkup(
      <AdmissionSuccess
        confirmation={{
          success: true,
          studentId: "student_1",
          studentNumber: "SYK-SION-000001",
          enrolmentId: "enrol_1",
          enrolmentNumber: "ENR-SION-2026-000001",
          enquiryNumber: "ENQ-SION-2026-ABC",
          isNewStudent: true,
        }}
      />,
    );

    expect(html).toContain("SYK-SION-000001");
    expect(html).toContain("ENR-SION-2026-000001");
    expect(html).toContain("/app/students/student_1");
  });

  it("models double-click protection through disabled confirmation state text", () => {
    const html = renderToStaticMarkup(<button type="button" disabled>Confirming...</button>);
    expect(html).toContain("disabled");
    expect(html).toContain("Confirming...");
  });

  it("filters incomplete courses out of admission choices", () => {
    expect(
      configuredAdmissionCourses([
        course,
        { ...course, id: "course_incomplete", name: "Incomplete", admission_configuration_complete: false },
      ]).map((item) => item.id),
    ).toEqual(["course_full_stack"]);
  });

  it("freezes Course Master display values from the locked draft", () => {
    const payload = readyPayload();
    payload.fee.standardFeePaise = 5000000;

    const lockedCourse = courseForReview(payload, { ...course, default_fee_paise: 5500000 }, true);
    const editableCourse = courseForReview(payload, { ...course, default_fee_paise: 5500000 }, false);

    expect(lockedCourse?.default_fee_paise).toBe(5000000);
    expect(editableCourse?.default_fee_paise).toBe(5500000);
  });

  it("skips draft save before retrying a locked confirmation", () => {
    expect(shouldSaveDraftBeforeConfirm(false)).toBe(true);
    expect(shouldSaveDraftBeforeConfirm(true)).toBe(false);
  });

  it("recognizes admission lock API errors", () => {
    expect(isAdmissionLockedError(new ApiError("Locked", undefined, "admission_confirmation_locked"))).toBe(true);
    expect(isAdmissionLockedError(new ApiError("Different", undefined, "invalid_admission"))).toBe(false);
  });

  it("renders locked recovery notice with retry action", () => {
    const html = renderToStaticMarkup(<AdmissionRecoveryNotice isConfirming={false} onRetry={() => undefined} />);
    expect(html).toContain("Admission confirmation is locked for recovery.");
    expect(html).toContain("Retry Confirmation");
  });

  it("disables admission controls while keeping frozen values visible", () => {
    const html = renderToStaticMarkup(
      <AdmissionLockedFieldset isLocked>
        <input value="Asha Student" readOnly />
        <select value="course_full_stack" onChange={() => undefined}>
          <option value="course_full_stack">Full Stack</option>
        </select>
        <button type="submit">Save Draft</button>
      </AdmissionLockedFieldset>,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Asha Student");
    expect(html).toContain("Full Stack");
  });

  it("renders populated configuration choices through the dropdown components", () => {
    const configuration = populatedConfiguration();
    const html = renderToStaticMarkup(
      <>
        {["preferred_language", "qualification_level", "stream", "occupation_status", "batch_preference", "discount_reason"].map((category) => (
          <OptionSelect
            key={category}
            label={category}
            options={configuration.options.filter((option) => option.category === category)}
            code=""
            customLabel=""
            onCodeChange={() => undefined}
            onCustomLabelChange={() => undefined}
          />
        ))}
        <PaymentPlanField value="" rules={configuration.paymentPlanRules} onChange={() => undefined} />
      </>,
    );

    for (const label of [
      "Gujarati",
      "Below 10th",
      "Undergraduate",
      "Postgraduate",
      "Doctorate",
      "General",
      "Engineering",
      "Management",
      "Vocational",
      "Employed / Salaried",
      "Self-employed / Business",
      "Freelancer",
      "Unemployed / Seeking Work",
      "Homemaker",
      "8 AM to 11 AM",
      "5 PM to 8 PM",
      "Full upfront payment",
      "Management approval",
      "Custom",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("shows an explicit page-level error when admission configuration is missing", () => {
    const html = renderToStaticMarkup(<AdmissionConfigurationMissing onRetry={() => undefined} />);

    expect(isAdmissionConfigurationReady(emptyAdmissionConfiguration())).toBe(false);
    expect(html).toContain("Admission settings are incomplete. Ask an owner or administrator to configure admission options.");
  });

  it("does not render silent empty selects for missing configuration", () => {
    const html = renderToStaticMarkup(<AdmissionConfigurationMissing onRetry={() => undefined} />);
    expect(html).not.toContain("<select");
  });

  it("renders a retry action for reloading missing configuration", () => {
    const html = renderToStaticMarkup(<AdmissionConfigurationMissing onRetry={() => undefined} />);
    expect(html).toContain("Retry");
    expect(html).toContain("button");
  });

  it("shows an explicit payment-plan duration policy error when no rule matches", () => {
    const message = paymentPlanPolicyMessage({ ...course, duration_months: 13 }, populatedConfiguration().paymentPlanRules.filter((rule) => rule.max_duration_months === 6), []);
    const html = renderToStaticMarkup(<PaymentPlanField value="" rules={[]} message={message} onChange={() => undefined} />);

    expect(message).toBe("No payment plan is configured for this course duration.");
    expect(html).toContain("No payment plan is configured for this course duration.");
  });

  it("updates payment-plan choices when course duration changes", () => {
    const rules = populatedConfiguration().paymentPlanRules;

    expect(allowedPaymentRulesForCourse({ ...course, duration_months: 1 }, rules).map((rule) => rule.plan_type)).toEqual(["full"]);
    expect(allowedPaymentRulesForCourse({ ...course, duration_months: 2 }, rules).map((rule) => rule.plan_type)).toEqual(["full", "two_instalments"]);
    expect(allowedPaymentRulesForCourse({ ...course, duration_months: 7 }, rules).map((rule) => rule.plan_type)).toEqual(["full", "two_instalments", "three_instalments", "custom"]);
  });

  it("counts unique draft warning fields in the saved message", () => {
    expect(draftSavedMessage({})).toBe("Draft saved.");
    expect(draftSavedMessage({ "identity.officialFullName": ["Required"] })).toBe("Draft saved. 1 field is still required before confirmation.");
    expect(draftSavedMessage({ "identity.officialFullName": ["Required"], "locality.city": ["Required"] })).toBe("Draft saved. 2 fields are still required before confirmation.");
  });
});

describe("AdmissionPage draft validation interactions", () => {
  let windowRef: Window;
  let roots: Root[];

  beforeEach(() => {
    roots = [];
    windowRef = new Window({ url: "http://localhost/app/staff/enquiries/enq_first/admission" });
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("navigator", windowRef.navigator);
    vi.stubGlobal("HTMLElement", windowRef.HTMLElement);
    vi.stubGlobal("HTMLInputElement", windowRef.HTMLInputElement);
    vi.stubGlobal("HTMLSelectElement", windowRef.HTMLSelectElement);
    vi.stubGlobal("HTMLButtonElement", windowRef.HTMLButtonElement);
    vi.stubGlobal("Event", windowRef.Event);
    vi.stubGlobal("MouseEvent", windowRef.MouseEvent);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    setDefaultAdmissionApiMocks();
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots = [];
    windowRef.happyDOM.cancelAsync();
    vi.unstubAllGlobals();
  });

  it("saves an incomplete draft from the explicit Save Draft button and shows all field errors together", async () => {
    apiMocks.saveAdmissionDraft.mockImplementation(async (_enquiryId, payload, currentStep) => ({
      success: true,
      draftId: "draft_1",
      payload,
      currentStep,
      fieldErrors: incompleteFieldErrors(),
    }));
    const container = await renderAdmissionPage(roots);

    const form = container.querySelector("form");
    const saveButton = buttonByText(container, "Save Draft");
    expect(form?.noValidate).toBe(true);
    expect((saveButton as HTMLButtonElement).type).toBe("button");

    await click(saveButton);

    expect(apiMocks.saveAdmissionDraft).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Draft saved. 7 fields are still required before confirmation.");
    expect(container.textContent).toContain("Official Aadhaar name is required.");
    expect(container.textContent).toContain("City is required.");
    expect(container.textContent).toContain("Preferred language is required.");
    expect(windowRef.document.activeElement?.id).toBe("admission-error-summary");

    const fullName = windowRef.document.getElementById(admissionFieldId("identity.officialFullName")) as unknown as HTMLInputElement;
    expect(fullName.getAttribute("aria-invalid")).toBe("true");

    await click(buttonByText(container, "Full name as per Aadhaar"));
    expect(windowRef.document.activeElement).toBe(fullName);

    await changeValue(fullName, "Asha Student");
    expect(container.textContent).not.toContain("Official Aadhaar name is required.");
    expect(container.textContent).toContain("City is required.");
  });

  it("saves before confirmation and blocks the confirm endpoint when readiness errors remain", async () => {
    apiMocks.saveAdmissionDraft.mockImplementation(async (_enquiryId, payload, currentStep) => ({
      success: true,
      draftId: "draft_1",
      payload,
      currentStep,
      fieldErrors: incompleteFieldErrors(),
    }));
    const container = await renderAdmissionPage(roots);

    await click(buttonByText(container, "Confirm Admission"));

    expect(apiMocks.saveAdmissionDraft).toHaveBeenCalledWith("enq_first", expect.any(Object), "review");
    expect(apiMocks.confirmAdmission).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Draft saved. 7 fields are still required before confirmation.");
    expect(windowRef.document.activeElement?.id).toBe("admission-error-summary");
  });

  it("calls the confirmation endpoint after the pre-confirm save returns no field errors", async () => {
    apiMocks.saveAdmissionDraft.mockImplementation(async (_enquiryId, payload, currentStep) => ({
      success: true,
      draftId: "draft_1",
      payload,
      currentStep,
      fieldErrors: {},
    }));
    const container = await renderAdmissionPage(roots);

    await click(buttonByText(container, "Confirm Admission"));

    expect(apiMocks.confirmAdmission).toHaveBeenCalledWith("enq_first");
    expect(container.textContent).toContain("Admission Confirmed");
  });

  it("preserves typed values when draft save returns an API error", async () => {
    apiMocks.saveAdmissionDraft.mockRejectedValueOnce(new ApiError("Temporary network failure", undefined, "network_error"));
    const container = await renderAdmissionPage(roots);
    const fullName = windowRef.document.getElementById(admissionFieldId("identity.officialFullName")) as unknown as HTMLInputElement;

    await changeValue(fullName, "Asha Manual");
    await click(buttonByText(container, "Save Draft"));

    expect(fullName.value).toBe("Asha Manual");
    expect(container.textContent).toContain("Temporary network failure");
  });

  it("keeps locked recovery retry on confirm without saving the editable draft first", async () => {
    apiMocks.getAdmissionDraft.mockResolvedValueOnce({
      draft: {
        payload: readyPayload(),
        currentStep: "review",
        confirmationLockedAt: "2026-08-03T00:00:00.000Z",
      },
    });
    const container = await renderAdmissionPage(roots);

    await click(buttonByText(container, "Retry Confirmation"));

    expect(apiMocks.saveAdmissionDraft).not.toHaveBeenCalled();
    expect(apiMocks.confirmAdmission).toHaveBeenCalledWith("enq_first");
  });
});

function setDefaultAdmissionApiMocks() {
  apiMocks.getEnquiryDetail.mockResolvedValue({
    enquiry: {
      enquiry_number: "ENQ-SION-2026-001",
      full_name: "",
      date_of_birth: "",
      course_id: "",
      branch_id: "branch_sion",
      branch_name: "Sion",
      branch_code: "SION",
    },
    primaryMobile: "",
    alternateMobile: "",
    mobileDisplay: null,
    previousEnrolments: [],
    activeDraft: null,
  });
  apiMocks.getActiveCourses.mockResolvedValue({ courses: [course] });
  apiMocks.getAdmissionDraft.mockResolvedValue({ draft: null });
  apiMocks.getAdmissionConfiguration.mockResolvedValue(populatedConfiguration());
  apiMocks.confirmAdmission.mockResolvedValue({
    success: true,
    studentId: "student_1",
    studentNumber: "SYK-SION-000001",
    enrolmentId: "enrol_1",
    enrolmentNumber: "ENR-SION-2026-000001",
    enquiryNumber: "ENQ-SION-2026-001",
    isNewStudent: true,
  });
  apiMocks.requestDiscountApproval.mockResolvedValue({ status: "requested" });
  apiMocks.saveAdmissionDraft.mockImplementation(async (_enquiryId, payload, currentStep) => ({
    success: true,
    draftId: "draft_1",
    payload,
    currentStep,
    fieldErrors: {},
  }));
}

async function renderAdmissionPage(roots: Root[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<AdmissionPage enquiryId="enq_first" />);
  });
  await flushAdmissionPage();
  return container;
}

async function flushAdmissionPage() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushAdmissionPage();
}

async function changeValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value")?.set;
  const eventWindow = input.ownerDocument.defaultView!;
  await act(async () => {
    if (valueSetter) valueSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new eventWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new eventWindow.Event("change", { bubbles: true }));
    const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
    const onChange = propsKey ? (input as unknown as Record<string, { onChange?: (event: { target: HTMLInputElement }) => void }>)[propsKey]?.onChange : undefined;
    onChange?.({ target: input });
  });
  await flushAdmissionPage();
}

function incompleteFieldErrors() {
  return {
    "identity.officialFullName": ["Official Aadhaar name is required."],
    "contact.primaryMobile": ["Primary mobile is required."],
    "contact.preferredLanguageCode": ["Preferred language is required."],
    "locality.locality": ["Locality is required."],
    "locality.city": ["City is required."],
    "education.qualificationLevelCode": ["Highest/current qualification is required."],
    "declarations.informationCorrect": ["Information correctness declaration is required."],
  };
}

function populatedConfiguration() {
  return {
    options: [
      option("preferred_language", "english", "English", 10),
      option("preferred_language", "hindi", "Hindi", 20),
      option("preferred_language", "marathi", "Marathi", 30),
      option("preferred_language", "gujarati", "Gujarati", 40),
      option("preferred_language", "other", "Other", 90, true),
      option("qualification_level", "below_10th", "Below 10th", 10),
      option("qualification_level", "ssc", "SSC / 10th", 20),
      option("qualification_level", "hsc", "HSC / 12th", 30),
      option("qualification_level", "diploma", "Diploma", 40),
      option("qualification_level", "undergraduate", "Undergraduate", 50),
      option("qualification_level", "graduate", "Graduate", 60),
      option("qualification_level", "postgraduate", "Postgraduate", 70),
      option("qualification_level", "doctorate", "Doctorate", 80),
      option("qualification_level", "other", "Other", 90, true),
      option("stream", "general", "General", 10),
      option("stream", "arts", "Arts", 20),
      option("stream", "commerce", "Commerce", 30),
      option("stream", "science", "Science", 40),
      option("stream", "it_computer_science", "IT / Computer Science", 50),
      option("stream", "engineering", "Engineering", 60),
      option("stream", "management", "Management", 70),
      option("stream", "vocational", "Vocational", 80),
      option("stream", "other", "Other", 90, true),
      option("occupation_status", "student", "Student", 10),
      option("occupation_status", "employed_salaried", "Employed / Salaried", 20),
      option("occupation_status", "self_employed_business", "Self-employed / Business", 30),
      option("occupation_status", "freelancer", "Freelancer", 40),
      option("occupation_status", "unemployed_seeking_work", "Unemployed / Seeking Work", 50),
      option("occupation_status", "homemaker", "Homemaker", 60),
      option("occupation_status", "other", "Other", 90, true),
      option("batch_preference", "08_11", "8 AM to 11 AM", 10),
      option("batch_preference", "11_14", "11 AM to 2 PM", 20),
      option("batch_preference", "14_17", "2 PM to 5 PM", 30),
      option("batch_preference", "17_20", "5 PM to 8 PM", 40),
      option("discount_reason", "full_upfront", "Full upfront payment", 10),
      option("discount_reason", "early_admission", "Early admission", 20),
      option("discount_reason", "repeat_student", "Repeat student", 30),
      option("discount_reason", "referral", "Referral", 40),
      option("discount_reason", "scholarship_financial_support", "Scholarship / Financial support", 50),
      option("discount_reason", "promotional_offer", "Promotional offer", 60),
      option("discount_reason", "management_approval", "Management approval", 70),
      option("discount_reason", "other", "Other", 90, true),
    ],
    paymentPlanRules: [
      plan(1, 1, "full", 1),
      plan(2, 3, "full", 1),
      plan(2, 3, "two_instalments", 2),
      plan(4, 6, "full", 1),
      plan(4, 6, "two_instalments", 2),
      plan(4, 6, "three_instalments", 3),
      plan(7, null, "full", 1),
      plan(7, null, "two_instalments", 2),
      plan(7, null, "three_instalments", 3),
      plan(7, null, "custom", null),
    ],
    configuration: { ready: true, missingCategories: [], paymentPlanRulesConfigured: true },
  };
}

function option(category: string, code: string, label: string, sortOrder: number, requiresCustomLabel = false) {
  return { category, code, label, sort_order: sortOrder, requires_custom_label: requiresCustomLabel, is_active: true };
}

function plan(min: number, max: number | null, planType: string, instalments: number | null) {
  return { min_duration_months: min, max_duration_months: max, plan_type: planType, fixed_instalments: instalments, is_active: true };
}

function readyPayload() {
  const payload = defaultAdmissionPayload();
  payload.identity = { ...payload.identity, officialFullName: "Asha Student", dateOfBirth: "2001-02-03", gender: "female", identityConfirmed: true };
  payload.contact = { ...payload.contact, primaryMobile: "+919876543210", preferredLanguage: "English", preferredLanguageCode: "english" };
  payload.locality = { ...payload.locality, locality: "Sion", city: "Mumbai" };
  payload.education = { ...payload.education, qualificationLevel: "HSC", occupationStatus: "student" };
  payload.course = { ...payload.course, courseId: "course_full_stack", branchId: "branch_sion", joiningDate: "2026-08-05" };
  payload.fee = { ...payload.fee, standardFeePaise: 5000000, finalAgreedFeePaise: 5000000 };
  payload.declarations = {
    ...payload.declarations,
    informationCorrect: true,
    nameDobMatchesAadhaar: true,
    courseRulesExplained: true,
    feeTermsAccepted: true,
    dataProcessingAccepted: true,
  };
  return payload;
}
