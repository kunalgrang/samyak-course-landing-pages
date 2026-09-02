import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffBatch, StaffCourse } from "../../lib/api";

const apiMocks = vi.hoisted(() => ({
  createStaffBatch: vi.fn(),
  getActiveCourses: vi.fn(),
  getEligibleBatchEnrolments: vi.fn(),
  getEnquiryOptions: vi.fn(),
  getStaffBatch: vi.fn(),
  getStaffBatches: vi.fn(),
  getStaffBatchTrainers: vi.fn(),
  removeStaffBatchMembership: vi.fn(),
  transferStaffBatchMembership: vi.fn(),
  updateStaffBatch: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    createStaffBatch: apiMocks.createStaffBatch,
    getActiveCourses: apiMocks.getActiveCourses,
    getEligibleBatchEnrolments: apiMocks.getEligibleBatchEnrolments,
    getEnquiryOptions: apiMocks.getEnquiryOptions,
    getStaffBatch: apiMocks.getStaffBatch,
    getStaffBatches: apiMocks.getStaffBatches,
    getStaffBatchTrainers: apiMocks.getStaffBatchTrainers,
    removeStaffBatchMembership: apiMocks.removeStaffBatchMembership,
    transferStaffBatchMembership: apiMocks.transferStaffBatchMembership,
    updateStaffBatch: apiMocks.updateStaffBatch,
  };
});

import { BatchManagementPage, filterCourses } from "./BatchManagementPage";

describe("BatchManagementPage course selector", () => {
  let root: Root;
  let container: HTMLElement;
  let windowRef: Window;

  beforeEach(() => {
    windowRef = new Window({ url: "http://localhost/app/batches" });
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLElement", windowRef.HTMLElement);
    vi.stubGlobal("MouseEvent", windowRef.MouseEvent);
    vi.stubGlobal("KeyboardEvent", windowRef.KeyboardEvent);
    vi.stubGlobal("Node", windowRef.Node);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getStaffBatches.mockResolvedValue({ success: true, batches: [batch()] });
    apiMocks.getActiveCourses.mockResolvedValue({ courses });
    apiMocks.getEnquiryOptions.mockResolvedValue({ branches: [{ id: "branch_sion", name: "Sion", code: "SION" }], courses: [], sources: [] });
    apiMocks.getStaffBatchTrainers.mockResolvedValue({ success: true, trainers: [{ id: "person_trainer", name: "Trainer One" }] });
    apiMocks.getStaffBatch.mockResolvedValue({ success: true, batch: batch(), roster: [] });
    apiMocks.getEligibleBatchEnrolments.mockResolvedValue({ success: true, enrolments: [] });
    apiMocks.createStaffBatch.mockResolvedValue({ success: true, batchId: "batch_saved" });
    apiMocks.updateStaffBatch.mockResolvedValue({ success: true, batchId: "batch_one" });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    windowRef.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the course wall collapsed until the selector opens", async () => {
    await renderPage();

    expect(container.querySelector(".course-checklist")).toBeNull();
    expect(container.querySelector(".course-selector-option")).toBeNull();
    expect(text()).toContain("Search or select courses...");

    click(courseTrigger());
    await flush();

    expect(container.querySelectorAll(".course-selector-option")).toHaveLength(courses.length);
    expect(container.querySelectorAll(".course-selector-option input[type='checkbox']")).toHaveLength(courses.length);
  });

  it("filters courses case-insensitively in the already loaded course list", () => {
    expect(filterCourses(courses, "digital").map((course) => course.name)).toEqual([
      "Digital Marketing",
      "Digital Marketing with AI",
      "Digital Marketing with WordPress",
      "Digital Content Creation",
    ]);
    expect(filterCourses(courses, "python").map((course) => course.name)).toEqual([
      "Python Beginner",
      "Python Advanced",
      "Python & Web Design",
    ]);
  });

  it("selects one and multiple courses, shows chips, and removes a chip", async () => {
    await renderPage();
    click(courseTrigger());
    await flush();

    click(inputForCourse("course_dm"));
    await flush();
    expect(text()).toContain("1 course selected");
    expect(text()).toContain("Digital Marketing");

    click(inputForCourse("course_dm_ai"));
    await flush();
    expect(text()).toContain("2 courses selected");
    expect(container.querySelectorAll(".selected-course-chip")).toHaveLength(2);

    click(buttonByLabel("Remove Digital Marketing"));
    await flush();
    expect(text()).toContain("1 course selected");
    expect(container.querySelectorAll(".selected-course-chip")).toHaveLength(1);
    expect(text()).not.toContain("Digital MarketingxDigital Marketing with AI");
  });

  it("shows inline validation and avoids the API when saving zero courses", async () => {
    await renderPage();

    click(buttonByText("Create Batch"));
    await flush();

    expect(text()).toContain("Select at least one course.");
    expect(apiMocks.createStaffBatch).not.toHaveBeenCalled();
  });

  it("submits the multi-course payload without changing the API contract", async () => {
    await renderPage();
    setInputValue(container.querySelector<HTMLInputElement>("label input")!, "Morning Full Stack");
    setSelectValue(container.querySelector<HTMLSelectElement>("label select")!, "branch_sion");
    click(courseTrigger());
    await flush();
    click(inputForCourse("course_dm"));
    click(inputForCourse("course_python_beginner"));
    await flush();

    click(buttonByText("Create Batch"));
    await flush();

    expect(apiMocks.createStaffBatch).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course_dm",
      courseIds: ["course_dm", "course_python_beginner"],
    }));
  });

  it("loads existing mapped courses in edit mode and preserves them on non-course edits", async () => {
    await renderPage();

    click(buttonByText("Edit"));
    await flush();

    expect(text()).toContain("3 courses selected");
    expect(container.querySelectorAll(".selected-course-chip")).toHaveLength(3);
    click(courseTrigger());
    await flush();
    expect(inputForCourse("course_dm").checked).toBe(true);
    expect(inputForCourse("course_dm_ai").checked).toBe(true);
    expect(inputForCourse("course_dm_wp").checked).toBe(true);

    click(buttonByText("Update Batch"));
    await flush();

    expect(apiMocks.updateStaffBatch).toHaveBeenCalledWith("batch_one", expect.objectContaining({
      courseIds: ["course_dm", "course_dm_ai", "course_dm_wp"],
    }));
  });

  it("keeps long-list and mobile selector behavior in CSS instead of permanent page growth", () => {
    const staffCss = readStaffCss();

    expect(staffCss).toContain(".batch-form");
    expect(staffCss).toContain("width: min(100%, 860px);");
    expect(staffCss).toContain(".course-selector-list");
    expect(staffCss).toContain("max-height: 320px;");
    expect(staffCss).toContain("overflow-y: auto;");
    expect(staffCss).toContain("max-width: 100%;");
    expect(staffCss).toContain(".selected-course-chips");
    expect(staffCss).toContain("flex-wrap: wrap;");
  });

  it("keeps Batch assignment controls bounded and shrinkable on mobile", () => {
    const staffCss = readStaffCss();

    expect(staffCss).toContain(".batch-assignment-row {\n  display: grid;\n  gap: 12px;\n  align-items: end;\n  min-width: 0;\n  max-width: 100%;");
    expect(staffCss).toContain(".batch-assignment-row > label {\n  display: grid;\n  gap: 7px;\n  min-width: 0;");
    expect(staffCss).toContain(".batch-assignment-select,\n.batch-transfer-select {\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  box-sizing: border-box;");
  });

  it("stacks Batch assignment controls on mobile and preserves desktop columns", () => {
    const staffCss = readStaffCss();

    expect(staffCss).toContain(".batch-assignment-row button {\n  width: 100%;");
    expect(staffCss).toContain("@media (min-width: 640px)");
    expect(staffCss).toContain(".batch-assignment-row {\n    grid-template-columns: minmax(0, 1fr) auto;");
    expect(staffCss).toContain(".batch-assignment-row button {\n    width: auto;");
  });

  it("renders scoped assignment and transfer select hooks for long enrolment labels", async () => {
    apiMocks.getEligibleBatchEnrolments.mockResolvedValue({
      success: true,
      enrolments: [{
        id: "enrolment_long",
        student_name: "Abdul Kadir Iftekhar Khan",
        enrolment_number: "ENR-SION-2026-0000000000000000000000000000000000000000",
      }],
    });
    apiMocks.getStaffBatch.mockResolvedValue({
      success: true,
      batch: batch(),
      roster: [{
        membership_id: "membership_one",
        student_name: "Abdul Kadir Iftekhar Khan",
        student_number: "STU-SION-2026-000001",
        enrolment_number: "ENR-SION-2026-0000000000000000000000000000000000000000",
        course_id: "course_dm",
        course_name: "Digital Marketing",
        joined_at: "2026-09-02T00:00:00.000Z",
        enrolment_status: "active",
      }],
    });
    apiMocks.getStaffBatches.mockResolvedValue({
      success: true,
      batches: [
        batch(),
        batch({ id: "batch_two", name: "Digital Batch Evening" }),
      ],
    });

    await renderPage();
    click(container.querySelector<HTMLButtonElement>(".table-row-main")!);
    await flush();

    expect(container.querySelector(".batch-assignment-select")).toBeInstanceOf(windowRef.HTMLSelectElement);
    expect(container.querySelector(".batch-roster-row")).toBeInstanceOf(windowRef.HTMLElement);
    expect(container.querySelector(".batch-transfer-select")).toBeInstanceOf(windowRef.HTMLSelectElement);
    expect(text()).toContain("Abdul Kadir Iftekhar Khan · ENR-SION-2026-0000000000000000000000000000000000000000");
  });

  it("protects checkbox and radio controls from generic staff input sizing", () => {
    const staffCss = readStaffCss();

    expect(staffCss).toContain(".staff-form input,");
    expect(staffCss).toContain(".staff-form input[type=\"checkbox\"],");
    expect(staffCss).toContain(".staff-form input[type=\"radio\"]");
    expect(staffCss).toContain("min-width: 18px;");
    expect(staffCss).toContain("min-height: 18px;");
    expect(staffCss).toContain(".course-selector-option input[type=\"checkbox\"]");
  });

  it("normalizes CSS text assertions across LF and CRLF checkouts", () => {
    expect(normalizeLineEndings(".batch-assignment-row {\r\n  display: grid;\r\n}")).toBe(".batch-assignment-row {\n  display: grid;\n}");
  });

  async function renderPage() {
    await act(async () => {
      root.render(<BatchManagementPage />);
    });
    await flush();
  }

  function text() {
    return container.textContent || "";
  }

  function courseTrigger() {
    return container.querySelector<HTMLButtonElement>(".course-selector-trigger")!;
  }

  function inputForCourse(courseId: string) {
    return container.querySelector<HTMLInputElement>(`#batch-course-${courseId}`)!;
  }

  function buttonByText(label: string) {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === label)!;
  }

  function buttonByLabel(label: string) {
    return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  }

  function click(element: HTMLElement) {
    act(() => {
      element.click();
    });
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(windowRef.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new windowRef.Event("input", { bubbles: true }) as unknown as Event);
      input.dispatchEvent(new windowRef.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  function setSelectValue(select: HTMLSelectElement, value: string) {
    act(() => {
      select.value = value;
      select.dispatchEvent(new windowRef.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  async function flush() {
    await act(async () => {});
  }
});

function readStaffCss() {
  return normalizeLineEndings(readFileSync(new URL("../../styles/staff.css", import.meta.url), "utf8"));
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

const courses: StaffCourse[] = [
  course("course_dm", "Digital Marketing"),
  course("course_dm_ai", "Digital Marketing with AI"),
  course("course_dm_wp", "Digital Marketing with WordPress"),
  course("course_content", "Digital Content Creation"),
  course("course_python_beginner", "Python Beginner"),
  course("course_python_advanced", "Python Advanced"),
  course("course_python_web", "Python & Web Design"),
  course("course_long", "Very Long Course Name Built For Wrapping Cleanly In One Bounded Course Selector Row"),
];

function course(id: string, name: string): StaffCourse {
  return {
    id,
    code: id,
    name,
    category_id: null,
    duration_label: null,
    duration_months: null,
    default_fee_paise: null,
    lowest_acceptable_fee_paise: null,
    admission_configuration_complete: true,
    nsdc_available: false,
    status: "active",
  };
}

function batch(overrides: Partial<StaffBatch> = {}): StaffBatch {
  return {
    id: "batch_one",
    branchId: "branch_sion",
    branchName: "Sion",
    courseId: "course_dm",
    courseName: "Digital Marketing",
    courses: [
      { id: "course_dm", name: "Digital Marketing" },
      { id: "course_dm_ai", name: "Digital Marketing with AI" },
      { id: "course_dm_wp", name: "Digital Marketing with WordPress" },
    ],
    courseCount: 3,
    name: "Digital Batch",
    trainerPersonId: "person_trainer",
    trainerName: "Trainer One",
    daysOfWeek: ["mon", "wed", "fri"],
    startTime: "08:00",
    endTime: "10:00",
    capacity: 30,
    activeStudents: 0,
    capacityWarning: false,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}
