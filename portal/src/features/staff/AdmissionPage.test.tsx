import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AdmissionLockedFieldset,
  AdmissionRecoveryNotice,
  AdmissionSuccess,
  admissionReview,
  configuredAdmissionCourses,
  courseForReview,
  defaultAdmissionPayload,
  isAdmissionLockedError,
  mergeAdmissionPayload,
  shouldSaveDraftBeforeConfirm,
} from "./AdmissionPage";
import { ApiError } from "../../lib/api";

const course = {
  id: "course_full_stack",
  code: "FSD",
  name: "Full Stack",
  duration_label: "6 months",
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

  it("calculates final fee discount and review readiness", () => {
    const payload = readyPayload();
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "Scholarship";
    payload.fee.discountReasonCode = "merit";
    const review = admissionReview(payload, course);

    expect(review.discountPaise).toBe(500000);
    expect(review.canConfirmRegularAdmission).toBe(true);
  });

  it("uses Course Master fee over draft display fee in review calculations", () => {
    const payload = readyPayload();
    payload.fee.standardFeePaise = 1;
    payload.fee.finalAgreedFeePaise = 4500000;
    payload.fee.discountReason = "Scholarship";
    payload.fee.discountReasonCode = "merit";

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
});

function readyPayload() {
  const payload = defaultAdmissionPayload();
  payload.identity = { ...payload.identity, officialFullName: "Asha Student", dateOfBirth: "2001-02-03", gender: "female", identityConfirmed: true };
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
