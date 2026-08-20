import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CreateEnquirySubmitButton,
  CrmContactLine,
  EnquirySuccessNotice,
  assignedCounsellorLabel,
  buildCreateEnquiryInput,
  canLogCrmFollowUp,
  createEnquirySuccessMessage,
  crmLeadContext,
  crmPaymentPath,
  crmPrimaryAction,
  defaultCrmQueue,
  enquiryStateAfterFailure,
  enquiryStateAfterSuccess,
  focusMobileSearchInput,
  guardedCreateEnquiry,
  initialEnquiryForm,
  isConvertedCrmEnquiry,
  isQuarterHourLocalInput,
  isTerminalPipelineStage,
  queueOptions,
  sanitizeLogForm,
  toIsoDateTime,
  toIstDateTimeLocal,
  type EnquiryPageState,
  type FormState,
} from "./EnquiriesPage";
import { StaffAssigneeOptions, StaffCrmContactPanel, staffDisplayLabel } from "./EnquiryDetailPage";
import { NotificationToast, nextNotification } from "../../components/NotificationToast";
import type { CreateEnquiryResponse, CrmEnquiryItem, EnquiryOptions, StudentSearchResult } from "../../lib/api";

const singleBranchOptions: EnquiryOptions = {
  branches: [{ id: "branch_sion", code: "SION", name: "Sion" }],
  courses: [{ id: "course_full_stack", code: "FSD", name: "Full Stack", nsdc_available: true }],
  sources: ["Walk-in", "Website"],
};

const multiBranchOptions: EnquiryOptions = {
  ...singleBranchOptions,
  branches: [
    { id: "branch_sion", code: "SION", name: "Sion" },
    { id: "branch_dadar", code: "DADAR", name: "Dadar" },
  ],
};

const dirtyForm: FormState = {
  fullName: "Asha Student",
  branchId: "branch_sion",
  courseInterestId: "course_full_stack",
  courseInterestText: "Manual course",
  source: "Walk-in",
  sourceDetail: "Front desk",
  preferredTiming: "7 PM",
  preferredJoiningDate: "2026-08-10",
  existingPersonId: "person_asha",
};

const searchResult: StudentSearchResult = {
  mobileLastFour: "3210",
  possiblePeople: [
    {
      person_id: "person_asha",
      full_name: "Asha Student",
      date_of_birth: null,
      student_number: "STU-001",
      student_status: "active",
      mobile_last_four: "3210",
    },
  ],
  enquiries: [],
};

const created: CreateEnquiryResponse = {
  success: true,
  enquiryId: "enq_123",
  enquiryNumber: "ENQ-SION-2026-000123",
  personId: "person_asha",
};

describe("EnquiriesPage submission lifecycle", () => {
  it("disables the create button and shows the loading label during submission", () => {
    const html = renderToStaticMarkup(<CreateEnquirySubmitButton isSubmitting />);

    expect(html).toContain("disabled");
    expect(html).toContain("Creating enquiry…");
  });

  it("renders an accessible success message with the enquiry number", () => {
    const message = createEnquirySuccessMessage(created);
    const html = renderToStaticMarkup(<EnquirySuccessNotice message={message} />);

    expect(message).toBe("Enquiry ENQ-SION-2026-000123 was created successfully.");
    expect(html).toContain("role=\"status\"");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).toContain("ENQ-SION-2026-000123");
  });

  it("resets enquiry, person and search fields after success", () => {
    const next = enquiryStateAfterSuccess(multiBranchOptions, created);

    expect(next.mobile).toBe("");
    expect(next.searchResult).toBeNull();
    expect(next.error).toBeNull();
    expect(next.success).toContain("ENQ-SION-2026-000123");
    expect(next.form).toEqual({
      fullName: "",
      branchId: "",
      courseInterestId: "",
      courseInterestText: "",
      source: "",
      sourceDetail: "",
      preferredTiming: "",
      preferredJoiningDate: "",
      existingPersonId: "",
    });
  });

  it("selects the only active branch again after reset", () => {
    expect(initialEnquiryForm(singleBranchOptions).branchId).toBe("branch_sion");
    expect(enquiryStateAfterSuccess(singleBranchOptions, created).form.branchId).toBe("branch_sion");
  });

  it("returns focus to the mobile search input after success", () => {
    const focus = vi.fn();
    focusMobileSearchInput({ current: { focus } as unknown as HTMLInputElement });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("leaves all fields unchanged and shows an error after failed submission", () => {
    const current: EnquiryPageState = {
      mobile: "9876543210",
      searchResult,
      form: dirtyForm,
      error: null,
      success: null,
    };
    const next = enquiryStateAfterFailure(current, "Could not create the enquiry.");

    expect(next.mobile).toBe(current.mobile);
    expect(next.searchResult).toBe(searchResult);
    expect(next.form).toBe(dirtyForm);
    expect(next.success).toBeNull();
    expect(next.error).toBe("Could not create the enquiry.");
  });

  it("builds the create-enquiry API input from the selected person and form", () => {
    expect(buildCreateEnquiryInput({ mobile: "9876543210", form: dirtyForm, selectedPerson: searchResult.possiblePeople[0] })).toEqual({
      mobile: "9876543210",
      fullName: "Asha Student",
      branchId: "branch_sion",
      courseInterestId: "course_full_stack",
      courseInterestText: null,
      source: "Walk-in",
      sourceDetail: "Front desk",
      preferredTiming: "7 PM",
      preferredJoiningDate: "2026-08-10",
      existingPersonId: "person_asha",
    });
  });

  it("prevents multiple pending submissions from calling the API twice", async () => {
    let resolveCreate: (value: CreateEnquiryResponse) => void = () => undefined;
    const api = vi.fn(
      () =>
        new Promise<CreateEnquiryResponse>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const pending = { current: false };

    const first = guardedCreateEnquiry(pending, api);
    const second = guardedCreateEnquiry(pending, api);

    expect(api).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBeNull();

    resolveCreate(created);
    await expect(first).resolves.toEqual(created);
    expect(pending.current).toBe(false);
  });
});

describe("CRM contact and feedback UI", () => {
  const contact = {
    mobile: "9876543210",
    mobileDisplay: "+91 98765 43210",
    whatsappUrl: "https://wa.me/919876543210",
    callUrl: "tel:+919876543210",
  };

  it("renders the full authorized mobile in CRM list contact lines", () => {
    const html = renderToStaticMarkup(<CrmContactLine contact={contact} />);

    expect(html).toContain("+91 98765 43210");
  });

  it("renders the full authorized mobile and actions in CRM detail contact panel", () => {
    const html = renderToStaticMarkup(<StaffCrmContactPanel contact={contact} />);

    expect(html).toContain("Prospect Contact");
    expect(html).toContain("+91 98765 43210");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Call");
  });

  it("shows unavailable state when CRM contact is missing", () => {
    const html = renderToStaticMarkup(<StaffCrmContactPanel contact={{ mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null }} />);

    expect(html).toContain("Contact number unavailable");
    expect(html).not.toContain("WhatsApp");
    expect(html).not.toContain("Call");
  });

  it("renders accessible success and error notifications", () => {
    const success = nextNotification("success", "Assignment updated.");
    const error = nextNotification("error", "Could not update assignment. Please try again.", success);

    expect(renderToStaticMarkup(<NotificationToast notification={success} onDismiss={() => undefined} />)).toContain("role=\"status\"");
    expect(renderToStaticMarkup(<NotificationToast notification={error} onDismiss={() => undefined} />)).toContain("role=\"alert\"");
    expect(error.id).toBe(success.id + 1);
  });

  it("renders human assignee names without exposing internal account ids", () => {
    expect(assignedCounsellorLabel({
      assignedCounsellorLoginAccountId: "acct_04176173eb024647afbc0f9c8f693d88",
      assignedCounsellor: { accountId: "acct_04176173eb024647afbc0f9c8f693d88", displayName: "Kunal" },
    })).toBe("Kunal");

    expect(assignedCounsellorLabel({
      assignedCounsellorLoginAccountId: "acct_04176173eb024647afbc0f9c8f693d88",
      assignedCounsellor: null,
    })).toBe("Unknown staff");
  });

  it("uses staff names as assignment dropdown labels while preserving account ids as values", () => {
    const html = renderToStaticMarkup(
      <select>
        <StaffAssigneeOptions assignees={[
          { id: "acct_04176173eb024647afbc0f9c8f693d88", label: "Kunal" },
          { id: "acct_missing_name", label: "acct_missing_name" },
        ]} />
      </select>,
    );

    expect(html).toContain("value=\"acct_04176173eb024647afbc0f9c8f693d88\"");
    expect(html).toContain(">Kunal</option>");
    expect(html).toContain(">Unknown staff</option>");
    expect(html).not.toContain(">acct_");
    expect(staffDisplayLabel("person_internal")).toBe("Unknown staff");
  });
});

describe("CRM queue and converted enquiry navigation", () => {
  it("defaults to Hot Enquiries while keeping All visible", () => {
    expect(defaultCrmQueue).toBe("hot");
    expect(queueOptions).toContainEqual(["hot", "Hot Enquiries"]);
    expect(queueOptions).toContainEqual(["all", "All"]);
  });

  it("builds direct converted-student actions from canonical admission context", () => {
    const item = crmItem({
      pipelineStage: "converted",
      admission: {
        convertedEnrolmentId: "enrol_conversion",
        convertedAt: "2026-08-20T10:00:00.000Z",
        enrolmentId: "enrol_conversion",
        enrolmentNumber: "ENR-SION-2026-000060",
        enrolmentStatus: "confirmed",
        studentId: "student_aman",
        studentNumber: "SYK-SION-000057",
        paymentLedgerAvailable: true,
      },
    });

    expect(isConvertedCrmEnquiry(item)).toBe(true);
    expect(crmPrimaryAction(item)).toEqual({ label: "Profile", href: "/app/students/student_aman" });
    expect(crmPaymentPath(item)).toBe("/app/enrolments/enrol_conversion/payments");
    expect(canLogCrmFollowUp(item)).toBe(false);
    expect(crmLeadContext(item)).toBe("Student ID SYK-SION-000057 · ENR-SION-2026-000060");
  });

  it("falls back to Open Enquiry and hides payments when converted navigation context is incomplete", () => {
    const item = crmItem({
      pipelineStage: "converted",
      admission: {
        convertedEnrolmentId: null,
        convertedAt: "2026-08-20T10:00:00.000Z",
        enrolmentId: null,
        enrolmentNumber: null,
        enrolmentStatus: null,
        studentId: null,
        studentNumber: null,
        paymentLedgerAvailable: false,
      },
    });

    expect(isConvertedCrmEnquiry(item)).toBe(false);
    expect(crmPrimaryAction(item)).toEqual({ label: "Open Enquiry", href: "/app/enquiries/enq_aman" });
    expect(crmPaymentPath(item)).toBeNull();
    expect(canLogCrmFollowUp(item)).toBe(false);
  });

  it("keeps follow-up and no payment action for active enquiries", () => {
    const item = crmItem({ pipelineStage: "considering", leadTemperature: "hot" });

    expect(crmPrimaryAction(item)).toEqual({ label: "Open Enquiry", href: "/app/enquiries/enq_aman" });
    expect(crmPaymentPath(item)).toBeNull();
    expect(canLogCrmFollowUp(item)).toBe(true);
  });
});

describe("CRM follow-up form state", () => {
  it("clears hidden lost reason when stage changes away from lost", () => {
    expect(sanitizeLogForm({
      channel: "call",
      outcome: "call_connected",
      pipelineStage: "engaged",
      nextFollowUpAt: "2026-09-01T10:00",
      expectedJoiningDate: "",
      closedReason: "not_interested",
      note: "",
    }).closedReason).toBe("");
  });

  it("keeps lost reason only when lost is selected", () => {
    expect(sanitizeLogForm({
      channel: "call",
      outcome: "not_interested",
      pipelineStage: "lost",
      nextFollowUpAt: "2026-09-01T10:00",
      expectedJoiningDate: "",
      closedReason: "not_interested",
      note: "",
    })).toMatchObject({ closedReason: "not_interested", nextFollowUpAt: "" });
  });

  it("clears next follow-up for terminal stages and leaves converted unavailable manually", () => {
    expect(isTerminalPipelineStage("invalid")).toBe(true);
    expect(isTerminalPipelineStage("duplicate")).toBe(true);
    expect(sanitizeLogForm({
      channel: "call",
      outcome: "invalid_contact",
      pipelineStage: "invalid",
      nextFollowUpAt: "2026-09-01T10:00",
      expectedJoiningDate: "",
      closedReason: "not_interested",
      note: "",
    })).toMatchObject({ nextFollowUpAt: "", closedReason: "" });
    expect(["new", "contacting", "engaged", "considering", "deferred", "admission_ready", "lost", "invalid", "duplicate"]).not.toContain("converted");
  });

  it("accepts only quarter-hour follow-up times and round-trips IST to storage", () => {
    expect(["2026-08-20T18:00", "2026-08-20T18:15", "2026-08-20T18:30", "2026-08-20T18:45"].every(isQuarterHourLocalInput)).toBe(true);
    expect(["2026-08-20T18:01", "2026-08-20T18:14", "2026-08-20T18:23", "2026-08-20T18:59"].some(isQuarterHourLocalInput)).toBe(false);
    expect(toIsoDateTime("2026-08-20T18:30")).toBe("2026-08-20T13:00:00.000Z");
    expect(toIstDateTimeLocal("2026-08-20T13:00:00.000Z")).toBe("2026-08-20T18:30");
  });
});

function crmItem(overrides: Partial<CrmEnquiryItem> = {}): CrmEnquiryItem {
  return {
    enquiry: {
      id: "enq_aman",
      enquiryNumber: "ENQ-SION-2026-000060",
      status: "new",
      pipelineStage: "new",
      createdAt: "2026-08-20T09:00:00.000Z",
      updatedAt: "2026-08-20T09:00:00.000Z",
    },
    prospect: { displayName: "Aman Sharma" },
    contact: {
      mobile: "9876543210",
      mobileDisplay: "+91 98765 43210",
      whatsappUrl: "https://wa.me/919876543210",
      callUrl: "tel:+919876543210",
    },
    prospectContact: {
      mobile: "9876543210",
      mobileDisplay: "+91 98765 43210",
      whatsappUrl: "https://wa.me/919876543210",
      callUrl: "tel:+919876543210",
    },
    course: { id: "course_tally", name: "CAP - TALLY WITH TAX AND MS OFFICE" },
    source: "Walk-in",
    sourceDetail: null,
    referral: null,
    pipelineStage: "new",
    leadTemperature: "hot_urgent",
    leadTemperatureReason: "Walk-in enquiry received today",
    assignedCounsellor: null,
    assignedCounsellorLoginAccountId: null,
    assignedAt: null,
    lastContactedAt: null,
    nextFollowUpAt: null,
    expectedJoiningDate: null,
    branch: { id: "branch_sion", name: "Sion", code: "SION" },
    admission: {
      convertedEnrolmentId: null,
      convertedAt: null,
      enrolmentId: null,
      enrolmentNumber: null,
      enrolmentStatus: null,
      studentId: null,
      studentNumber: null,
      paymentLedgerAvailable: false,
    },
    closedReason: null,
    followUpEventCount: 0,
    ...overrides,
  };
}
