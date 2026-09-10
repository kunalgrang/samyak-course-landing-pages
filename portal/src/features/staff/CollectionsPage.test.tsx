import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  getCollectionDetail: vi.fn(),
  recordCollectionFollowup: vi.fn(),
  updateCollectionPaymentSchedule: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getCollections: apiMocks.getCollections,
    getCollectionDetail: apiMocks.getCollectionDetail,
    recordCollectionFollowup: apiMocks.recordCollectionFollowup,
    updateCollectionPaymentSchedule: apiMocks.updateCollectionPaymentSchedule,
  };
});

import { CollectionsPage } from "./CollectionsPage";

describe("CollectionsPage", () => {
  let root: Root;
  let container: HTMLElement;
  let window: Window;

  beforeEach(() => {
    window = new Window();
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getCollections.mockResolvedValue(collectionList());
    apiMocks.getCollectionDetail.mockResolvedValue(collectionDetail("missing_due_date"));
  });

  afterEach(() => {
    root?.unmount();
    window.close();
    vi.clearAllMocks();
  });

  it("renders schedule attention overview, section, and server-backed filter control", async () => {
    await act(async () => {
      root.render(<CollectionsPage onNavigate={vi.fn()} />);
    });
    await act(async () => {});

    expect(container.textContent).toContain("Schedule Attention");
    expect(container.textContent).toContain("Outstanding accounts missing a usable payment schedule");
    expect(container.textContent).toContain("Due Date Missing");

    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Schedule Attention");
    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
    expect(apiMocks.getCollections).toHaveBeenLastCalledWith(expect.objectContaining({ status: "schedule_attention" }));
  });

  it("renders detail warning and separate payment schedule row cells", async () => {
    await act(async () => {
      root.render(<CollectionsPage enrolmentId="enrol_a" onNavigate={vi.fn()} />);
    });
    await act(async () => {});

    expect(container.textContent).toContain("Payment schedule needs attention");
    expect(container.textContent).toContain("One or more outstanding installments does not have a due date.");

    const manage = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Manage Instalments");
    await act(async () => {
      manage?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });

    const row = container.querySelector(".payment-schedule-row");
    expect(row?.children).toHaveLength(7);
    expect(row?.children[1].textContent).toContain("Amount");
    expect(row?.children[2].textContent).toContain("Due date");
    expect(row?.children[3].textContent).toContain("Paid");
    expect(row?.children[4].textContent).toContain("Remaining");
    expect(row?.children[5].textContent).toContain("Status");
    expect(row?.children[6].textContent).toContain("Remove");
  });

  it("removes the warning when response state is valid", async () => {
    apiMocks.getCollectionDetail.mockResolvedValue(collectionDetail(null));
    await act(async () => {
      root.render(<CollectionsPage enrolmentId="enrol_a" onNavigate={vi.fn()} />);
    });
    await act(async () => {});

    expect(container.textContent).not.toContain("Payment schedule needs attention");
  });
});

function collectionList() {
  const item = collectionItem("missing_due_date");
  return {
    success: true,
    today: "2026-09-08",
    filters: { status: "overdue", limit: 25, offset: 0 },
    pagination: { limit: 25, offset: 0, total: 1, hasMore: false },
    overview: {
      totalOutstandingPaise: 1602000,
      dueTodayPaise: 0,
      overduePaise: 0,
      collectedThisMonthPaise: 50000,
      promisesDueToday: 0,
      scheduleAttentionCount: 1,
    },
    sections: {
      needsAttention: [],
      scheduleAttention: [item],
      dueToday: [],
      overdue: [],
      upcoming: [],
      recentCollections: [],
    },
    items: [item],
  };
}

function collectionDetail(reason: "missing_schedule" | "missing_due_date" | "invalid_schedule_total" | null) {
  return {
    success: true,
    today: "2026-09-08",
    item: collectionItem(reason),
    installments: [
      {
        instalmentNumber: 1,
        requiredPaise: 1652000,
        allocatedReceivedPaise: 50000,
        balancePaise: 1602000,
        status: "part_paid",
        dueDate: null,
        label: "Part Paid",
        daysOverdue: 0,
      },
    ],
    receipts: [],
    followups: [],
    timeline: [],
    receiptCorrection: { supported: false, message: "Receipt amounts and dates are immutable in the current ledger. Use owner review until a reversal workflow exists." },
    paymentSchedule: {
      canManage: true,
      reasonRequired: true,
      version: "version_1234567890abcdef",
      courseDurationMonths: 3,
      maxInstallments: 4,
      finalAgreedFeePaise: 1652000,
      totalReceivedPaise: 50000,
      fullyPaid: false,
    },
  };
}

function collectionItem(reason: "missing_schedule" | "missing_due_date" | "invalid_schedule_total" | null) {
  return {
    enrolmentId: "enrol_a",
    enrolmentNumber: "ENR-SION-0001",
    enrolmentStatus: "confirmed",
    branchId: "branch_sion",
    branchName: "Sion",
    studentId: "student_a",
    studentNumber: "SYK-SION-0001",
    studentName: "SHAHID KHAN",
    studentStatus: "active",
    courseId: "course_coreldraw",
    courseName: "CORELDRAW",
    mobileDisplay: "******1234",
    callUrl: null,
    whatsappUrl: null,
    summary: {
      agreedFeePaise: 1652000,
      receivedPaise: 50000,
      outstandingPaise: 1602000,
      overduePaise: 0,
      dueTodayPaise: 0,
      nextDueDate: null,
      daysOverdue: 0,
      agingBucket: null,
      lastPaymentAt: "2026-09-02T09:00:00.000Z",
      lastFollowUpAt: null,
      nextFollowUpAt: null,
      promiseDate: null,
      promiseAmountPaise: null,
      promiseMissed: false,
      fullyPaid: false,
      scheduleAttentionReason: reason,
    },
    flags: [],
  };
}
