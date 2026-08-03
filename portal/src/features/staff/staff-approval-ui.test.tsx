import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { navigationForRoles, canAccessDiscountApprovals } from "../../routes/Router";
import { DiscountApprovalsContent } from "./DiscountApprovalsPage";
import { courseConfigurationLabel, isCourseConfigurationComplete } from "./CourseMasterPage";

describe("staff approval UI", () => {
  it("shows approval navigation only to owners", () => {
    expect(navigationForRoles(["owner"]).map((item) => item.path)).toContain("/app/discount-approvals");
    expect(navigationForRoles(["admin"]).map((item) => item.path)).not.toContain("/app/discount-approvals");
    expect(canAccessDiscountApprovals(["system_admin"])).toBe(false);
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
});
