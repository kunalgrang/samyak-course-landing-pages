import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CreateEnquirySubmitButton,
  CrmContactLine,
  EnquirySuccessNotice,
  buildCreateEnquiryInput,
  createEnquirySuccessMessage,
  enquiryStateAfterFailure,
  enquiryStateAfterSuccess,
  focusMobileSearchInput,
  guardedCreateEnquiry,
  initialEnquiryForm,
  isTerminalPipelineStage,
  sanitizeLogForm,
  type EnquiryPageState,
  type FormState,
} from "./EnquiriesPage";
import { StaffCrmContactPanel } from "./EnquiryDetailPage";
import { NotificationToast, nextNotification } from "../../components/NotificationToast";
import type { CreateEnquiryResponse, EnquiryOptions, StudentSearchResult } from "../../lib/api";

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
});
