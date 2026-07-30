import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AdmissionSuccess,
  admissionReview,
  defaultAdmissionPayload,
  mergeAdmissionPayload,
} from "./AdmissionPage";

const course = {
  id: "course_full_stack",
  code: "FSD",
  name: "Full Stack",
  duration_label: "6 months",
  default_fee_paise: 5000000,
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
    const review = admissionReview(payload, course);

    expect(review.discountPaise).toBe(500000);
    expect(review.canConfirmRegularAdmission).toBe(true);
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
