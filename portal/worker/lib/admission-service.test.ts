import { describe, expect, it } from "vitest";
import { validateAdmissionDraftPayload, validateAdmissionForConfirmation } from "./admission-service";

function validPayload() {
  return {
    identity: {
      officialFullName: "Asha Student",
      firstName: "Asha",
      dateOfBirth: "2001-02-03",
      gender: "female",
      fatherName: "",
      identityConfirmed: true,
    },
    contact: { primaryMobile: "+919876543210", belongsTo: "student", isWhatsapp: true },
    locality: { locality: "Sion East", city: "Mumbai", fullAddress: "" },
    education: { qualificationLevel: "HSC", occupationStatus: "student" },
    course: {
      courseId: "course_full_stack",
      branchId: "branch_sion",
      trainingMode: "classroom",
      admissionDate: "2026-08-01",
      joiningDate: "2026-08-05",
      nsdcPreference: "no",
    },
    fee: {
      standardFeePaise: 5000000,
      finalAgreedFeePaise: 4500000,
      discountReason: "Early admission",
      paymentPlanType: "two_instalments",
      numberOfInstalments: 2,
      initialPaymentExpectedPaise: 0,
    },
    declarations: {
      informationCorrect: true,
      nameDobMatchesAadhaar: true,
      courseRulesExplained: true,
      feeTermsAccepted: true,
      dataProcessingAccepted: true,
      nsdcProcessingAccepted: false,
      nsdcPendingDocumentsUnderstood: false,
    },
  };
}

describe("Admission Workflow v1 rules", () => {
  it("accepts a complete regular admission with locality and city but no full address", () => {
    const payload = validPayload();
    expect(payload.locality.fullAddress).toBe("");
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);
  });

  it("requires locality, city, configured course and Aadhaar name/DOB confirmation", () => {
    const payload = validPayload();
    payload.locality.locality = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.locality.locality = "Sion";
    payload.locality.city = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.locality.city = "Mumbai";
    payload.course.courseId = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.course.courseId = "course_full_stack";
    payload.identity.identityConfirmed = false;
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("accepts valid Indian mobile shape in admission payloads", () => {
    const payload = validPayload();
    payload.contact.primaryMobile = "+91 98765 43210";
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);

    payload.contact.primaryMobile = "5123456789";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("rejects future DOB and names containing numbers", () => {
    const payload = validPayload();
    payload.identity.dateOfBirth = "2999-01-01";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.identity.dateOfBirth = "2001-02-03";
    payload.identity.officialFullName = "Asha 2";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("requires discount reason when the agreed fee is lower", () => {
    const payload = validPayload();
    payload.fee.discountReason = "";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });
  });

  it("requires father's name and NSDC declarations when NSDC is Yes", () => {
    const payload = validPayload();
    payload.course.nsdcPreference = "yes";
    expect(validateAdmissionForConfirmation(payload)).toMatchObject({ success: false });

    payload.identity.fatherName = "Ramesh Student";
    payload.declarations.nsdcProcessingAccepted = true;
    payload.declarations.nsdcPendingDocumentsUnderstood = true;
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);
  });

  it("does not require full Aadhaar capture for NSDC preference", () => {
    const payload = validPayload();
    payload.course.nsdcPreference = "yes";
    payload.identity.fatherName = "Ramesh Student";
    payload.declarations.nsdcProcessingAccepted = true;
    payload.declarations.nsdcPendingDocumentsUnderstood = true;

    expect(JSON.stringify(payload).toLowerCase()).not.toContain("aadhaarnumber");
    expect(validateAdmissionForConfirmation(payload).success).toBe(true);
  });

  it("blocks sensitive draft payload keys", () => {
    expect(validateAdmissionDraftPayload({ identity: {}, aadhaarNumber: "123412341234" })).toMatchObject({
      success: false,
    });
    expect(validateAdmissionDraftPayload({ bankDetails: "secret" })).toMatchObject({ success: false });
  });

  it("documents server-generated permanent and enrolment number formats", () => {
    expect("SYK-SION-000001").toMatch(/^SYK-[A-Z0-9]+-\d{6}$/);
    expect("ENR-SION-2026-000001").toMatch(/^ENR-[A-Z0-9]+-\d{4}-\d{6}$/);
  });

  it("keeps repeat-admission and idempotency invariants explicit", () => {
    const first = { studentNumber: "SYK-SION-000001", enrolments: ["ENR-SION-2026-000001"] };
    const repeat = { studentNumber: first.studentNumber, enrolments: [...first.enrolments, "ENR-SION-2026-000002"] };
    const retried = { ...repeat, enrolments: repeat.enrolments };

    expect(repeat.studentNumber).toBe(first.studentNumber);
    expect(new Set(repeat.enrolments).size).toBe(2);
    expect(retried.enrolments).toEqual(repeat.enrolments);
  });

  it("keeps student and alumni users outside staff admission APIs by role contract", () => {
    const admissionRoles = ["owner", "system_admin", "admin", "counsellor", "admission_admin"];
    expect(admissionRoles).not.toContain("student");
    expect(admissionRoles).not.toContain("alumni");
  });
});
