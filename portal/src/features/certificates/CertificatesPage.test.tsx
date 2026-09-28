import { Window } from "happy-dom";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  getStudentCertificates: vi.fn(),
  submitStudentCertificateApplication: vi.fn(),
  getStudentLearningDetail: vi.fn(),
  getStudentLearningEnrolments: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getPublicConfig: apiMocks.getPublicConfig,
    getStudentCertificates: apiMocks.getStudentCertificates,
    submitStudentCertificateApplication: apiMocks.submitStudentCertificateApplication,
    getStudentLearningDetail: apiMocks.getStudentLearningDetail,
    getStudentLearningEnrolments: apiMocks.getStudentLearningEnrolments,
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: { accountRoles: [] } }),
}));

import { CertificatesPage } from "./CertificatesPage";
import { StudentLearningPage } from "../student/StudentLearningPage";

describe("student certificate UX", () => {
  let root: Root;
  let container: HTMLElement;
  let window: Window;

  beforeEach(() => {
    window = new Window();
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLAnchorElement = window.HTMLAnchorElement;
    (globalThis as any).HTMLButtonElement = window.HTMLButtonElement;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Event = window.Event;
    (globalThis as any).MouseEvent = window.MouseEvent;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getPublicConfig.mockResolvedValue({ turnstileSiteKey: "", otpEnabled: true, googleReviewUrl: "" });
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    vi.clearAllMocks();
  });

  it("renders institute-neutral copy and API-provided verification links", async () => {
    const page = {
      certificates: {
        items: [{
          id: "cert_1",
          certificate_number: "CERT-MAIN-2026-000001",
          verification_code: "CERT-ABCDEFG123456789",
          verification_url: "https://certificates.example.test/verify/CERT-ABCDEFG123456789",
          student_id_snapshot: "DEMO-MAIN-001",
          student_name_snapshot: "Asha Student",
          course_name_snapshot: "Full Stack",
          issue_date: "2026-08-20",
          completion_date_snapshot: "2026-08-18",
          status: "issued",
        }],
        pagination: { limit: 25, offset: 0, hasMore: false },
      },
      applications: {
        items: [{
          enrolment: {
            enrolment_id: "enrol_1",
            enrolment_number: "ENR-001",
            student_name: "Asha Student",
            student_number: "DEMO-MAIN-001",
            student_status: "active",
            course_id: "course_1",
            course_code: "FSD",
            course_name: "Full Stack",
            course_status: "active",
            duration_label: "6 months",
            joining_date: "2026-01-10",
            actual_completion_date: null,
            status: "active",
            batch_id: null,
            batch_name: null,
          },
          certificate: null,
          application: null,
          applicationEligibility: { eligible: true, reasons: [] },
        }, {
          enrolment: {
            enrolment_id: "enrol_2",
            enrolment_number: "ENR-002",
            student_name: "Asha Student",
            student_number: "DEMO-MAIN-001",
            student_status: "active",
            course_id: "course_2",
            course_code: "UXD",
            course_name: "UX Design",
            course_status: "active",
            duration_label: "3 months",
            joining_date: "2026-02-10",
            actual_completion_date: null,
            status: "cancelled",
            batch_id: null,
            batch_name: null,
          },
          certificate: null,
          application: null,
          applicationEligibility: { eligible: false, reasons: ["enrolment_cancelled"] },
        }],
      },
    };
    apiMocks.getStudentCertificates.mockResolvedValue(page);
    apiMocks.submitStudentCertificateApplication.mockResolvedValue({
      success: true,
      idempotent: false,
      application: { id: "certapp_1", status: "submitted", applied_at: "2026-08-21T00:00:00.000Z", low_feedback_flag: false },
    });

    await render(<CertificatesPage />);

    expect(container.textContent).toContain("Finished your training? Confirm completion and submit a certificate request. Your institute will review and confirm the official completion date before your certificate can be issued.");
    const verifyLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).filter((link) => link.textContent === "Verify");
    expect(verifyLinks.map((link) => link.getAttribute("href"))).toContain("https://certificates.example.test/verify/CERT-ABCDEFG123456789");
    expect(container.textContent).not.toContain("Samyak");
    expect(container.innerHTML).not.toContain("go.samyaksion.com");
    expect(container.innerHTML).not.toContain("edu.rememo.in");
    expect(container.textContent).toContain("Certificate requests are available for eligible current course enrolments. Please contact your institute if you have finished training and this option is not available.");
    expect(container.textContent).not.toContain("Certificate requests are available only for active course enrolments.");

    click(button("Confirm completion & request certificate"));
    expect(container.textContent).toContain("To be confirmed by the institute");
    expect(container.textContent).toContain("Please contact your institute before submitting your certificate application if anything is wrong.");
    expect(container.textContent).toContain("Your confirmation tells the institute that you have finished training and want a certificate. It does not mark your enrolment officially completed; staff must review and confirm the official completion date before a certificate can be issued.");
    expect(container.textContent).toContain("Your feedback is shared privately with your institute and helps improve the courses.");
    expect(button("Confirm completion & request certificate").disabled).toBe(true);
    expect(container.textContent).not.toContain("info@samyaksion.com");

    for (const checkbox of Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) check(checkbox);
    for (const name of new Set(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map((input) => input.name))) {
      const choice = container.querySelector<HTMLInputElement>(`input[name="${name}"][value="5"]`);
      if (choice) check(choice);
    }
    await submit(button("Confirm completion & request certificate"));

    expect(apiMocks.submitStudentCertificateApplication).toHaveBeenCalledWith(expect.objectContaining({ enrolmentId: "enrol_1" }));
    expect(container.textContent).toContain("Your certificate request was submitted. Your institute will now review and confirm the official completion date before certificate issuance.");
  });

  it("shows a certificate request CTA from active learning records", async () => {
    apiMocks.getStudentLearningEnrolments.mockResolvedValue({
      enrolments: [{
        enrolmentId: "enrol_1",
        enrolmentNumber: "ENR-001",
        courseName: "Full Stack",
        courseCode: "FSD",
        joiningDate: "2026-01-10",
        status: "active",
        currentBatch: { id: "batch_1", name: "Morning Batch", trainerName: "Trainer One", daysOfWeek: ["mon"], startTime: "10:00", endTime: "12:00" },
      }],
    });
    apiMocks.getStudentLearningDetail.mockResolvedValue({
      summary: { attendancePercent: 90, totalClasses: 10, present: 9, absent: 1 },
      sessions: [],
      pagination: { limit: 20, offset: 0, hasMore: false },
    });

    await render(<StudentLearningPage />);

    const requestLink = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find((link) => link.textContent === "Request Certificate");
    expect(requestLink?.getAttribute("href")).toBe("/student/certificates");
  });

  async function render(element: ReactNode) {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function button(label: string) {
    const match = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
    if (!match) throw new Error(`Missing button: ${label}`);
    return match as HTMLButtonElement;
  }

  function click(element: HTMLElement) {
    act(() => {
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
  }

  function check(input: HTMLInputElement) {
    act(() => {
      input.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
  }

  async function submit(element: HTMLElement) {
    await act(async () => {
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});
