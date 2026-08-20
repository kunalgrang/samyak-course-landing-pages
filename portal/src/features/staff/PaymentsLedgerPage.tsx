import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getPaymentLedger, recordEnrolmentReceipt, type PaymentLedger } from "../../lib/api";

type ReceiptInput = {
  amount: string;
  receivedAt: string;
  paymentMode: string;
  paymentReference: string;
  notes: string;
  idempotencyKey: string;
};

const referenceModes = new Set(["upi", "card", "bank_transfer", "cheque"]);

export function PaymentsLedgerPage({ enrolmentId }: { enrolmentId: string }) {
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [input, setInput] = useState<ReceiptInput>(() => defaultReceiptInput());

  useEffect(() => {
    let cancelled = false;
    void getPaymentLedger(enrolmentId)
      .then((result) => {
        if (!cancelled) setLedger(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load payment ledger.");
      });
    return () => {
      cancelled = true;
    };
  }, [enrolmentId]);

  const summary = ledger?.financialSummary;
  const maxPaymentPaise = summary?.overallBalancePaise || 0;
  const amountPaise = Math.round(Number(input.amount || 0) * 100);
  const amountTooHigh = amountPaise > maxPaymentPaise;
  const referenceRequired = referenceModes.has(input.paymentMode);
  const notesRequired = input.paymentMode === "other";
  const canSubmit = Boolean(ledger && !summary?.fullyPaid && amountPaise > 0 && !amountTooHigh && (!referenceRequired || input.paymentReference.trim()) && (!notesRequired || input.notes.trim()));

  async function refreshLedger() {
    setLedger(await getPaymentLedger(enrolmentId));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setFormError(null);
    setSuccess(null);
    try {
      const result = await recordEnrolmentReceipt(enrolmentId, {
        amountPaise,
        receivedAt: localDateTimeToIso(input.receivedAt),
        paymentMode: input.paymentMode,
        paymentReference: input.paymentReference,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      });
      setSuccess(`Payment recorded. Receipt ${result.receipt.receiptNumber}.`);
      setInput(defaultReceiptInput());
      await refreshLedger();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not record payment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (error) return <ErrorState title="Could not load payments" message={error} />;
  if (!ledger || !summary) return <LoadingState label="Loading payment ledger" />;

  return (
    <div className="content-stack staff-enquiries-page payments-page">
      <header className="page-header">
        <h1>Payments</h1>
        <p>{ledger.enrolment.studentName} · {ledger.enrolment.studentNumber} · {ledger.enrolment.enrolmentNumber}</p>
      </header>

      <section className="staff-card payment-summary-grid">
        <SummaryTile label="Final Fee" value={formatMoney(summary.finalAgreedFeePaise)} />
        <SummaryTile label="Received" value={formatMoney(summary.totalReceivedPaise)} />
        <SummaryTile label="Balance" value={formatMoney(summary.overallBalancePaise)} emphasis={summary.overallBalancePaise > 0} />
        <SummaryTile label="Ready to Start Classes" value={summary.classStartEligible ? "Yes" : "No"} />
        <SummaryTile label="Fully Paid" value={summary.fullyPaid ? "Yes" : "No"} />
        <SummaryTile label="Receipts" value={String(summary.receiptCount || ledger.receipts.length)} />
      </section>

      <section className="staff-card first-instalment-panel">
        <div className="section-heading"><h2>First Instalment</h2><span>{summary.classStartEligible ? "Ready" : "Pending"}</span></div>
        <div className="payment-progress-line">
          <strong>{formatMoney(summary.firstInstalmentReceivedPaise || 0)} / {formatMoney(summary.firstInstalmentRequiredPaise)}</strong>
          <span>Pending before classes start: {formatMoney(summary.firstInstalmentBalancePaise)}</span>
        </div>
        <ProgressBar value={summary.firstInstalmentReceivedPaise || 0} max={summary.firstInstalmentRequiredPaise} />
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Record Payment</h2><span>Maximum {formatMoney(maxPaymentPaise)}</span></div>
        {summary.fullyPaid ? <p className="notice notice--success"><strong>Fully Paid.</strong> No further payment can be recorded.</p> : null}
        {success ? <p className="notice notice--success">{success}</p> : null}
        {formError ? <p className="field-error">{formError}</p> : null}
        {!summary.fullyPaid ? (
          <form className="staff-form staff-form-grid payment-form" onSubmit={(event) => void handleSubmit(event)}>
            <label>Amount Received<input type="number" min="1" step="1" value={input.amount} onChange={(event) => setInput((current) => ({ ...current, amount: event.target.value }))} aria-invalid={amountTooHigh} /></label>
            <label>Received Date/Time<input type="datetime-local" value={input.receivedAt} onChange={(event) => setInput((current) => ({ ...current, receivedAt: event.target.value }))} /></label>
            <label>Payment Mode<select value={input.paymentMode} onChange={(event) => setInput((current) => ({ ...current, paymentMode: event.target.value }))}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
            <label>Reference{referenceRequired ? <span className="required-mark">*</span> : null}<input value={input.paymentReference} onChange={(event) => setInput((current) => ({ ...current, paymentReference: event.target.value }))} /></label>
            <label className="payment-notes-field">Notes{notesRequired ? <span className="required-mark">*</span> : null}<input value={input.notes} onChange={(event) => setInput((current) => ({ ...current, notes: event.target.value }))} /></label>
            {amountTooHigh ? <p className="field-error">Amount cannot exceed the current outstanding balance.</p> : null}
            <div className="staff-form-actions"><button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? "Recording..." : "Record Payment"}</button></div>
          </form>
        ) : null}
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Instalment Progress</h2><span>FIFO allocation</span></div>
        <div className="instalment-list">
          {summary.instalments.map((instalment) => (
            <article className="instalment-row" key={instalment.instalmentNumber}>
              <span><strong>Instalment {instalment.instalmentNumber}</strong><small>{statusLabel(instalment.status || "pending")}</small></span>
              <span>{formatMoney(instalment.allocatedReceivedPaise || 0)} / {formatMoney(instalment.requiredPaise || instalment.amountPaise || 0)}</span>
              <ProgressBar value={instalment.allocatedReceivedPaise || 0} max={instalment.requiredPaise || instalment.amountPaise || 0} />
            </article>
          ))}
        </div>
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Receipt History</h2><span>{ledger.receipts.length}</span></div>
        <div className="receipt-list">
          {ledger.receipts.map((receipt, index) => (
            <article className="receipt-card" key={receipt.id}>
              <span><strong>{receipt.receiptNumber}</strong>{index === ledger.receipts.length - 1 ? <small>Admission Token</small> : null}</span>
              <span><small>Date</small>{formatDisplayDateTime(receipt.receivedAt)}</span>
              <span><small>Amount</small>{formatMoney(receipt.amountPaise)}</span>
              <span><small>Mode</small>{paymentModeLabel(receipt.paymentMode)}</span>
              <span><small>Recorded By</small>{receipt.recordedBy || "Staff"}</span>
              {receipt.paymentReference ? <span><small>Reference</small>{receipt.paymentReference}</span> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryTile({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={emphasis ? "summary-tile summary-tile--emphasis" : "summary-tile"}><small>{label}</small><strong>{value}</strong></div>;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="payment-progress" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>;
}

function defaultReceiptInput(): ReceiptInput {
  return {
    amount: "",
    receivedAt: defaultLocalDateTime(),
    paymentMode: "cash",
    paymentReference: "",
    notes: "",
    idempotencyKey: randomIdempotencyKey(),
  };
}

function defaultLocalDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function randomIdempotencyKey() {
  return `pay_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

function formatDisplayDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function paymentModeLabel(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function statusLabel(value: string) {
  if (value === "part_paid") return "Part Paid";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
