import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { navigationForRoles, canAccessDiscountApprovals, canViewEnquiries, canViewStudents } from "../../routes/Router";
import { DiscountApprovalsContent } from "./DiscountApprovalsPage";
import { courseConfigurationLabel, isCourseConfigurationComplete } from "./CourseMasterPage";
import { ContactEditPanel } from "./StudentProfilePage";
import { StudentDirectoryContent, statusLabel } from "./StudentsPage";

describe("staff approval UI", () => {
  it("shows approval navigation only to owners", () => {
    expect(navigationForRoles(["owner"]).map((item) => item.path)).toContain("/app/discount-approvals");
    expect(navigationForRoles(["admin"]).map((item) => item.path)).not.toContain("/app/discount-approvals");
    expect(canAccessDiscountApprovals(["system_admin"])).toBe(false);
  });

  it("separates Enquiries and Students navigation for current staff roles", () => {
    const ownerNav = navigationForRoles(["owner"]);
    expect(ownerNav.map((item) => item.label)).toEqual(expect.arrayContaining(["Enquiries", "Students"]));
    expect(ownerNav.map((item) => item.label)).not.toContain("Students & Enquiries");
    expect(navigationForRoles(["counsellor"]).map((item) => item.path)).toEqual(expect.arrayContaining(["/app/enquiries", "/app/students"]));
    expect(navigationForRoles(["admission_admin"]).map((item) => item.path)).toEqual(expect.arrayContaining(["/app/enquiries", "/app/students"]));
    expect(navigationForRoles(["student"]).map((item) => item.path)).not.toContain("/app/students");
    expect(canViewEnquiries(["counsellor"])).toBe(true);
    expect(canViewStudents(["counsellor"])).toBe(true);
    expect(canViewStudents(["student"])).toBe(false);
  });

  it("blocks non-owner direct discount approval access", () => {
    expect(canAccessDiscountApprovals(["owner"])).toBe(true);
    expect(canAccessDiscountApprovals(["admin"])).toBe(false);
    expect(canAccessDiscountApprovals(["admission_admin"])).toBe(false);
    expect(canAccessDiscountApprovals(["counsellor"])).toBe(false);
  });

  it("renders commercial values and loading decision controls in the queue", () => {
    const html = renderToStaticMarkup(
      <DiscountApprovalsContent
        approvals={[
          {
            id: "approval_1",
            full_name: "Asha Student",
            enquiry_number: "ENQ-SION-2026-001",
            course_name: "Full Stack Development",
            listed_fee_paise: 5000000,
            lowest_acceptable_fee_paise: 4000000,
            requested_final_fee_paise: 3500000,
            discount_amount_paise: 1500000,
            discount_reason_text: "Merit scholarship",
            requested_by_name: "Counsellor One",
            created_at: "2026-08-01T10:00:00.000Z",
            status: "pending",
          },
        ]}
        decidingIds={new Set(["approval_1"])}
        error={null}
        success="Request approved."
        onDecide={vi.fn()}
      />,
    );

    expect(html).toContain("Listed price");
    expect(html).toContain("Lowest acceptable");
    expect(html).toContain("Requested final");
    expect(html).toContain("Discount");
    expect(html).toContain("Merit scholarship");
    expect(html).toContain("Counsellor One");
    expect(html).toContain("Working...");
    expect(html).not.toContain("9876543210");
    expect(html).not.toContain("Aadhaar");
  });

  it("tracks Course Master configuration-required state", () => {
    const baseCourse = {
      id: "course_full_stack",
      code: "FSD",
      name: "Full Stack",
      duration_label: "6 months",
      duration_months: 6,
      default_fee_paise: 5000000,
      lowest_acceptable_fee_paise: 4000000,
      nsdc_available: true,
      status: "active",
    };
    expect(isCourseConfigurationComplete({ ...baseCourse, admission_configuration_complete: false })).toBe(false);
    expect(courseConfigurationLabel({ ...baseCourse, admission_configuration_complete: false })).toBe("Configuration required");
    expect(isCourseConfigurationComplete({ ...baseCourse, admission_configuration_complete: true })).toBe(true);
    expect(courseConfigurationLabel({ ...baseCourse, admission_configuration_complete: true })).toBe("");
  });

  it("renders owner contact maintenance confirmation without raw mobile", () => {
    const html = renderToStaticMarkup(
      <ContactEditPanel
        studentId="student_a"
        profile={{
          student: {
            id: "student_a",
            student_number: "SYK-SION-0001",
            full_name: "Asha Student",
            date_of_birth: "2000-01-01",
            student_since: "2024-01-01",
            current_status: "active",
          },
          primaryMobile: "9876543210",
          mobileDisplay: "******3210",
          canMaintainContact: true,
          contactVersion: "contact-version-token",
          contactHistory: [],
          locality: null,
          education: null,
          enrolments: [],
          enquiries: [],
        }}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(html).toContain("Change primary mobile");
    expect(html).toContain("Old");
    expect(html).toContain("New");
    expect(html).toContain("Confirm Change");
    expect(html).toContain("******3210");
    expect(html).not.toContain("9876543210");
  });

  it("renders student directory filters, status chips, profile links and deduped enrolment summary", () => {
    const html = renderToStaticMarkup(
      <StudentDirectoryContent
        directory={{
          success: true,
          filters: { status: "all", search: "" },
          pagination: { limit: 25, offset: 0, total: 2, hasMore: false },
          items: [
            {
              studentId: "student_current",
              studentNumber: "SYK-SION-0001",
              currentStatus: "active",
              studentSince: "2026-01-01",
              displayName: "Asha Current",
              mobileDisplay: "******3210",
              latestCourseName: "Advanced Excel",
              latestEnrolmentNumber: "ENR-SION-0001",
              enrolmentCount: 1,
              paymentShortcutEnrolmentId: "enrol_current",
            },
            {
              studentId: "student_on_hold",
              studentNumber: "SYK-SION-0005",
              currentStatus: "on_hold",
              studentSince: "2025-08-01",
              displayName: "On Hold Current",
              mobileDisplay: "******6655",
              latestCourseName: "Advanced Excel",
              latestEnrolmentNumber: "ENR-SION-0005",
              enrolmentCount: 1,
              paymentShortcutEnrolmentId: null,
            },
            {
              studentId: "student_alumni",
              studentNumber: "SYK-SION-0002",
              currentStatus: "alumni",
              studentSince: "2025-01-01",
              displayName: "Legacy Alumni",
              mobileDisplay: "******7890",
              latestCourseName: "Tally Prime",
              latestEnrolmentNumber: "ENR-SION-0002-B",
              enrolmentCount: 2,
              paymentShortcutEnrolmentId: null,
            },
          ],
        }}
        error={null}
        isLoading={false}
        searchDraft=""
        status="all"
        onSearchDraftChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        onStatusChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
      />,
    );

    expect(html).toContain("Students");
    expect(html).toContain("All Students");
    expect(html).toContain("Current");
    expect(html).toContain("Alumni");
    expect(html).toContain("CURRENT");
    expect(html).toContain("ON HOLD");
    expect(html).toContain("ALUMNI");
    expect(html).toContain("SYK-SION-0001");
    expect(html).toContain("******3210");
    expect(html).toContain("/app/students/student_current");
    expect(html).toContain("/app/enrolments/enrol_current/payments");
    expect(html).toContain("2 enrolments");
    expect(html).not.toContain("9876543210");
  });

  it("renders directory empty states", () => {
    const html = renderToStaticMarkup(
      <StudentDirectoryContent
        directory={{ success: true, filters: { status: "alumni", search: "" }, pagination: { limit: 25, offset: 0, total: 0, hasMore: false }, items: [] }}
        error={null}
        isLoading={false}
        searchDraft=""
        status="alumni"
        onSearchDraftChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        onStatusChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
      />,
    );

    expect(html).toContain("No alumni found.");
    expect(statusLabel("on_hold")).toBe("ON HOLD");
  });
});
