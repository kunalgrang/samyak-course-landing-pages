import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getPaymentLedger: vi.fn(),
  recordEnrolmentReceipt: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getPaymentLedger: apiMocks.getPaymentLedger,
    recordEnrolmentReceipt: apiMocks.recordEnrolmentReceipt,
  };
});

import { PaymentsLedgerPage } from "./PaymentsLedgerPage";

describe("PaymentsLedgerPage", () => {
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
    apiMocks.getPaymentLedger.mockResolvedValue(ledger(false));
  });

  afterEach(() => {
    root?.unmount();
    window.close();
    vi.clearAllMocks();
  });

  it("renders summary, first receipt, instalment progress and record form", async () => {
    await act(async () => {
      root.render(<PaymentsLedgerPage enrolmentId="enrol_a" />);
    });
    await act(async () => {});

    expect(container.textContent).toContain("Payments");
    expect(container.textContent).toContain("SYK-SION-000057");
    expect(container.textContent).toContain("RCP-SION-2026-000001");
    expect(container.textContent).toContain("Admission Token");
    expect(container.textContent).toContain("Pending before classes start");
    expect(container.textContent).toContain("Instalment 1");
    expect(container.querySelector("button[type='submit']")?.textContent).toBe("Record Payment");
  });

  it("disables payment entry when fully paid", async () => {
    apiMocks.getPaymentLedger.mockResolvedValue(ledger(true));
    await act(async () => {
      root.render(<PaymentsLedgerPage enrolmentId="enrol_a" />);
    });
    await act(async () => {});

    expect(container.textContent).toContain("Fully Paid");
    expect(container.querySelector("button[type='submit']")).toBeNull();
  });
});

function ledger(fullyPaid: boolean) {
  const totalReceivedPaise = fullyPaid ? 1400000 : 1300000;
  return {
    enrolment: {
      id: "enrol_a",
      enrolmentNumber: "ENR-SION-2026-000060",
      status: "confirmed",
      branchName: "Sion",
      studentId: "student_a",
      studentNumber: "SYK-SION-000057",
      studentName: "Asha Student",
      courseId: "course_tally",
      courseCode: "SYK-TLY-003",
      courseName: "CAP - TALLY WITH TAX AND MS OFFICE",
    },
    financialSummary: {
      finalAgreedFeePaise: 1400000,
      totalReceivedPaise,
      overallBalancePaise: fullyPaid ? 0 : 100000,
      firstInstalmentRequiredPaise: 1400000,
      firstInstalmentReceivedPaise: totalReceivedPaise,
      firstInstalmentBalancePaise: fullyPaid ? 0 : 100000,
      classStartEligible: fullyPaid,
      fullyPaid,
      receiptCount: 1,
      instalments: [
        {
          instalmentNumber: 1,
          requiredPaise: 1400000,
          allocatedReceivedPaise: totalReceivedPaise,
          balancePaise: fullyPaid ? 0 : 100000,
          status: fullyPaid ? "paid" : "part_paid",
          dueDate: null,
        },
      ],
      tokenReceipt: {
        id: "receipt_1",
        receiptNumber: "RCP-SION-2026-000001",
        amountPaise: 1300000,
        receivedAt: "2026-08-20T09:00:00.000Z",
        paymentMode: "cash",
        paymentReference: null,
        status: "recorded",
        recordedBy: "Owner",
      },
    },
    receipts: [
      {
        id: "receipt_1",
        receiptNumber: "RCP-SION-2026-000001",
        amountPaise: 1300000,
        receivedAt: "2026-08-20T09:00:00.000Z",
        paymentMode: "cash",
        paymentReference: null,
        notes: null,
        status: "recorded",
        recordedBy: "Owner",
      },
    ],
  };
}
