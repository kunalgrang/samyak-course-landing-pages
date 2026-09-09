import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getCollectionDetail,
  getCollections,
  recordCollectionFollowup,
  updateCollectionPaymentSchedule,
  type CollectionDetail,
  type CollectionItem,
  type CollectionList,
  type CollectionQuery,
} from "../../lib/api";
import type { AppRoute } from "../../routes/types";

type FollowupForm = {
  followupType: string;
  outcome: string;
  note: string;
  promisedPaymentDate: string;
  promisedAmount: string;
  nextFollowUpAt: string;
};

type ScheduleDraftRow = {
  amountPaise: number;
  dueDate: string | null;
};

const statuses: Array<{ value: NonNullable<CollectionQuery["status"]>; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "due_today", label: "Due Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "promise_due", label: "Promise Due" },
  { value: "no_follow_up", label: "No Follow-up" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];

export function CollectionsPage({ enrolmentId, onNavigate }: { enrolmentId?: string; onNavigate: (path: AppRoute) => void }) {
  if (enrolmentId) return <CollectionDetailPage enrolmentId={enrolmentId} onNavigate={onNavigate} />;
  return <CollectionsOverviewPage onNavigate={onNavigate} />;
}

function CollectionsOverviewPage({ onNavigate }: { onNavigate: (path: AppRoute) => void }) {
  const [query, setQuery] = useState<CollectionQuery>({ status: "overdue", limit: 25, offset: 0 });
  const [data, setData] = useState<CollectionList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getCollections(query)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load collections.");
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (error) return <ErrorState title="Could not load collections" message={error} />;
  if (!data) return <LoadingState label="Loading collections" />;

  return (
    <div className="content-stack staff-enquiries-page collections-page">
      <header className="page-header">
        <h1>Collections</h1>
        <p>Outstanding fees, due instalments, promises, and follow-ups.</p>
      </header>

      <section className="payment-summary-grid">
        <SummaryTile label="Total Outstanding" value={formatMoney(data.overview.totalOutstandingPaise)} emphasis={data.overview.totalOutstandingPaise > 0} />
        <SummaryTile label="Due Today" value={formatMoney(data.overview.dueTodayPaise)} />
        <SummaryTile label="Overdue" value={formatMoney(data.overview.overduePaise)} emphasis={data.overview.overduePaise > 0} />
        <SummaryTile label="Collected This Month" value={formatMoney(data.overview.collectedThisMonthPaise)} />
      </section>

      <section className="staff-card collection-toolbar">
        <label>
          <small>Search</small>
          <input value={query.search || ""} onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value, offset: 0 }))} placeholder="Name, mobile, student ID, enrolment, course" />
        </label>
        <label>
          <small>Aging</small>
          <select value={query.agingBucket || ""} onChange={(event) => setQuery((current) => ({ ...current, agingBucket: event.target.value, offset: 0 }))}>
            <option value="">Any aging</option>
            <option value="1-7">1-7 days</option>
            <option value="8-15">8-15 days</option>
            <option value="16-30">16-30 days</option>
            <option value="31-60">31-60 days</option>
            <option value="60+">60+ days</option>
          </select>
        </label>
        <div className="segmented-control collection-status-filter" aria-label="Collection status filter">
          {statuses.map((status) => (
            <button
              className={query.status === status.value ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"}
              type="button"
              key={status.value}
              onClick={() => setQuery((current) => ({ ...current, status: status.value, offset: 0 }))}
            >
              {status.label}
            </button>
          ))}
        </div>
      </section>

      <CollectionSection title="Needs Attention" items={data.sections.needsAttention} onNavigate={onNavigate} />
      <CollectionSection title="Due Today" items={data.sections.dueToday} onNavigate={onNavigate} />
      <CollectionSection title="Overdue" items={data.sections.overdue} onNavigate={onNavigate} />
      <CollectionSection title="Upcoming" items={data.sections.upcoming} onNavigate={onNavigate} />

      <section className="staff-card collection-list-card">
        <div className="section-heading"><h2>Collection Queue</h2><span>{data.pagination.total}</span></div>
        <div className="collection-list">
          {data.items.map((item) => <CollectionRow key={item.enrolmentId} item={item} onOpen={() => onNavigate(`/app/collections/${item.enrolmentId}`)} />)}
          {!data.items.length ? <p className="staff-empty">No enrolments match this collection view.</p> : null}
        </div>
      </section>
    </div>
  );
}

function CollectionDetailPage({ enrolmentId, onNavigate }: { enrolmentId: string; onNavigate: (path: AppRoute) => void }) {
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FollowupForm>(() => defaultFollowupForm());
  const [saving, setSaving] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleRows, setScheduleRows] = useState<ScheduleDraftRow[]>([]);
  const [scheduleReason, setScheduleReason] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setDetail(await getCollectionDetail(enrolmentId));
  }

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getCollectionDetail(enrolmentId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load collection detail.");
      });
    return () => {
      cancelled = true;
    };
  }, [enrolmentId]);

  useEffect(() => {
    if (!detail || editingSchedule) return;
    setScheduleRows(detail.installments.map((installment) => ({ amountPaise: installment.requiredPaise, dueDate: installment.dueDate })));
  }, [detail, editingSchedule]);

  async function submitFollowup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await recordCollectionFollowup(enrolmentId, {
        followupType: form.followupType,
        outcome: form.outcome,
        note: form.note,
        promisedPaymentDate: form.promisedPaymentDate || undefined,
        promisedAmountPaise: form.promisedAmount ? Math.round(Number(form.promisedAmount) * 100) : undefined,
        nextFollowUpAt: form.nextFollowUpAt ? localDateTimeToIso(form.nextFollowUpAt) : undefined,
      });
      setForm(defaultFollowupForm());
      setMessage("Follow-up recorded.");
      await refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not record follow-up.");
    } finally {
      setSaving(false);
    }
  }

  async function submitSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setSavingSchedule(true);
    setScheduleMessage(null);
    try {
      const result = await updateCollectionPaymentSchedule(enrolmentId, {
        expectedVersion: detail.paymentSchedule.version,
        reason: scheduleReason,
        installments: scheduleRows,
      });
      setDetail(result);
      setEditingSchedule(false);
      setScheduleReason("");
      setScheduleMessage("Payment schedule saved.");
    } catch (reason) {
      setScheduleMessage(reason instanceof Error ? reason.message : "Could not save payment schedule.");
    } finally {
      setSavingSchedule(false);
    }
  }

  function beginScheduleEdit() {
    if (!detail) return;
    setScheduleRows(detail.installments.map((installment) => ({ amountPaise: installment.requiredPaise, dueDate: installment.dueDate })));
    setScheduleReason("");
    setScheduleMessage(null);
    setEditingSchedule(true);
  }

  function splitRemainingEqually() {
    if (!detail) return;
    const protectedRows = detail.installments.filter((installment) => installment.allocatedReceivedPaise > 0);
    const protectedTotal = protectedRows.reduce((total, installment) => total + installment.requiredPaise, 0);
    const editableIndexes = scheduleRows.map((_row, index) => index).filter((index) => !protectedRows.some((installment) => installment.instalmentNumber === index + 1));
    const split = equalAmounts(Math.max(0, detail.paymentSchedule.finalAgreedFeePaise - protectedTotal), editableIndexes.length);
    setScheduleRows((current) => current.map((row, index) => editableIndexes.includes(index) ? { ...row, amountPaise: split[editableIndexes.indexOf(index)] || 0 } : row));
  }

  if (error) return <ErrorState title="Could not load collection" message={error} />;
  if (!detail) return <LoadingState label="Loading collection detail" />;
  const item = detail.item;

  return (
    <div className="content-stack staff-enquiries-page collections-page">
      <button type="button" className="button-link collection-back" onClick={() => onNavigate("/app/collections")}>Back to Collections</button>
      <header className="page-header">
        <h1>{item.studentName}</h1>
        <p>{item.studentNumber} · {item.courseName} · {item.enrolmentNumber} · {titleCase(item.enrolmentStatus)}</p>
      </header>

      <section className="payment-summary-grid">
        <SummaryTile label="Agreed" value={formatMoney(item.summary.agreedFeePaise)} />
        <SummaryTile label="Received" value={formatMoney(item.summary.receivedPaise)} />
        <SummaryTile label="Outstanding" value={formatMoney(item.summary.outstandingPaise)} emphasis={item.summary.outstandingPaise > 0} />
        <SummaryTile label="Next Due" value={item.summary.nextDueDate || "No scheduled date"} />
        <SummaryTile label="Overdue" value={item.summary.overduePaise ? `${formatMoney(item.summary.overduePaise)} · ${item.summary.daysOverdue}d` : "No"} />
        <SummaryTile label="Promise" value={item.summary.promiseDate ? `${item.summary.promiseDate}${item.summary.promiseMissed ? " missed" : ""}` : "None"} />
      </section>

      <section className="staff-card collection-actions">
        <div className="section-heading"><h2>Actions</h2><span>{item.mobileDisplay || "No mobile"}</span></div>
        <div className="crm-actions">
          <a className="button-link" href={`/app/enrolments/${item.enrolmentId}/payments`}>Record Payment</a>
          {detail.paymentSchedule.canManage ? <button type="button" className="button-link" onClick={beginScheduleEdit}>{detail.installments.length ? "Manage Instalments" : "Create Payment Schedule"}</button> : null}
          {item.whatsappUrl ? <a className="button-link" href={item.whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a> : null}
          {item.callUrl ? <a className="button-link" href={item.callUrl}>Call</a> : null}
          <a className="button-link" href={`/app/students/${item.studentId}`}>Student Profile</a>
        </div>
        <p className="staff-empty">{detail.receiptCorrection.message}</p>
      </section>

      {detail.paymentSchedule.canManage || editingSchedule || scheduleMessage ? (
        <section className="staff-card">
          <div className="section-heading"><h2>Payment Schedule</h2><span>{detail.paymentSchedule.maxInstallments} max</span></div>
          {scheduleMessage ? <p className="form-message">{scheduleMessage}</p> : null}
          {editingSchedule ? (
            <PaymentScheduleEditor
              detail={detail}
              rows={scheduleRows}
              reason={scheduleReason}
              saving={savingSchedule}
              onRowsChange={setScheduleRows}
              onReasonChange={setScheduleReason}
              onSplitRemaining={splitRemainingEqually}
              onCancel={() => setEditingSchedule(false)}
              onSubmit={submitSchedule}
            />
          ) : (
            <p className="staff-empty">{detail.paymentSchedule.fullyPaid ? "Fully settled schedules are read-only." : "Owner and admin staff can revise unpaid schedule amounts and due dates."}</p>
          )}
        </section>
      ) : null}

      <section className="staff-card">
        <div className="section-heading"><h2>Add Follow-up</h2><span>Immutable history</span></div>
        {message ? <p className="form-message">{message}</p> : null}
        <form className="staff-form staff-form-grid collection-followup-form" onSubmit={(event) => void submitFollowup(event)}>
          <label>Type<select value={form.followupType} onChange={(event) => setForm((current) => ({ ...current, followupType: event.target.value }))}><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="in_person">In Person</option><option value="other">Other</option></select></label>
          <label>Outcome<select value={form.outcome} onChange={(event) => setForm((current) => ({ ...current, outcome: event.target.value }))}><option value="contacted">Contacted</option><option value="not_reachable">Not reachable</option><option value="promised_payment">Promised payment</option><option value="paid_or_receipt_pending">Paid / receipt pending</option><option value="dispute_or_query">Dispute or query</option><option value="follow_up_later">Follow up later</option></select></label>
          <label>Promise Date<input type="date" value={form.promisedPaymentDate} required={form.outcome === "promised_payment"} onChange={(event) => setForm((current) => ({ ...current, promisedPaymentDate: event.target.value }))} /></label>
          <label>Promise Amount<input type="number" min="1" step="1" value={form.promisedAmount} onChange={(event) => setForm((current) => ({ ...current, promisedAmount: event.target.value }))} /></label>
          <label>Next Follow-up<input type="datetime-local" value={form.nextFollowUpAt} onChange={(event) => setForm((current) => ({ ...current, nextFollowUpAt: event.target.value }))} /></label>
          <label className="collection-note-field">Note<textarea maxLength={1000} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
          <div className="staff-form-actions"><button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Follow-up"}</button></div>
        </form>
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Instalments</h2><span>FIFO</span></div>
        <div className="instalment-list">
          {detail.installments.map((installment) => (
            <article className="instalment-row" key={installment.instalmentNumber}>
              <span><strong>Instalment {installment.instalmentNumber}</strong><small>{installment.label}{installment.daysOverdue ? ` · ${installment.daysOverdue} days overdue` : ""}</small></span>
              <span>{formatMoney(installment.allocatedReceivedPaise)} / {formatMoney(installment.requiredPaise)} · Balance {formatMoney(installment.balancePaise)}</span>
              <small>Due {installment.dueDate || "Not scheduled"}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Receipts</h2><span>{detail.receipts.length}</span></div>
        <div className="receipt-list">
          {detail.receipts.map((receipt) => (
            <article className="receipt-card" key={receipt.id}>
              <span><strong>{receipt.receiptNumber}</strong><small>{formatDisplayDateTime(receipt.receivedAt)}</small></span>
              <span><small>Amount</small>{formatMoney(receipt.amountPaise)}</span>
              <span><small>Mode</small>{titleCase(receipt.paymentMode)}</span>
              <span><small>Reference</small>{receipt.paymentReference || "None"}</span>
              <span><small>Recorded By</small>{receipt.recordedBy || "Staff"}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Collection History</h2><span>{detail.timeline.length}</span></div>
        <div className="collection-timeline">
          {detail.timeline.map((event) => (
            <article className="table-row" key={`${event.type}-${event.id}`}>
              <strong>{titleCase(event.label)}</strong>
              <span>{formatDisplayDateTime(event.occurredAt)}{event.amountPaise ? ` · ${formatMoney(event.amountPaise)}` : ""}</span>
              {event.note ? <small>{event.note}</small> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CollectionSection({ title, items, onNavigate }: { title: string; items: CollectionItem[]; onNavigate: (path: AppRoute) => void }) {
  if (!items.length) return null;
  return (
    <section className="staff-card collection-list-card">
      <div className="section-heading"><h2>{title}</h2><span>{items.length}</span></div>
      <div className="collection-list">
        {items.map((item) => <CollectionRow key={`${title}-${item.enrolmentId}`} item={item} onOpen={() => onNavigate(`/app/collections/${item.enrolmentId}`)} />)}
      </div>
    </section>
  );
}

function PaymentScheduleEditor({
  detail,
  rows,
  reason,
  saving,
  onRowsChange,
  onReasonChange,
  onSplitRemaining,
  onCancel,
  onSubmit,
}: {
  detail: CollectionDetail;
  rows: ScheduleDraftRow[];
  reason: string;
  saving: boolean;
  onRowsChange: (rows: ScheduleDraftRow[]) => void;
  onReasonChange: (value: string) => void;
  onSplitRemaining: () => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const total = rows.reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
  const difference = total - detail.paymentSchedule.finalAgreedFeePaise;
  const invalid = difference !== 0 || !reason.trim() || rows.length < 1 || rows.length > detail.paymentSchedule.maxInstallments || rows.some((row) => !Number.isInteger(row.amountPaise) || row.amountPaise <= 0);

  function updateRow(index: number, patch: Partial<ScheduleDraftRow>) {
    onRowsChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function addRow() {
    if (rows.length >= detail.paymentSchedule.maxInstallments) return;
    onRowsChange([...rows, { amountPaise: 0, dueDate: null }]);
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_row, rowIndex) => rowIndex !== index));
  }

  return (
    <form className="staff-form payment-schedule-form" onSubmit={onSubmit}>
      <div className="payment-schedule-table">
        {rows.map((row, index) => {
          const current = detail.installments[index];
          const locked = current?.status === "paid";
          const protectedPaid = Number(current?.allocatedReceivedPaise || 0) > 0;
          const removable = !protectedPaid && rows.length > 1;
          return (
            <div className="payment-schedule-row" key={index}>
              <strong>Instalment {index + 1}</strong>
              <label>
                <small>Amount</small>
                <input type="number" min={protectedPaid ? Math.ceil(Number(current?.allocatedReceivedPaise || 0) / 100) : 1} step="1" value={row.amountPaise ? row.amountPaise / 100 : ""} disabled={locked} onChange={(event) => updateRow(index, { amountPaise: Math.round(Number(event.target.value || 0) * 100) })} />
              </label>
              <label>
                <small>Due date</small>
                <input type="date" value={row.dueDate || ""} disabled={locked} onChange={(event) => updateRow(index, { dueDate: event.target.value || null })} />
              </label>
              <span><small>Paid</small>{formatMoney(Number(current?.allocatedReceivedPaise || 0))}</span>
              <span><small>Remaining</small>{formatMoney(Math.max(0, row.amountPaise - Number(current?.allocatedReceivedPaise || 0)))}</span>
              <span><small>Status</small>{locked ? "Paid - locked" : protectedPaid ? "Part paid" : "Editable"}</span>
              <button type="button" className="secondary-button" disabled={!removable} onClick={() => removeRow(index)}>Remove</button>
            </div>
          );
        })}
      </div>
      <div className="staff-form-actions">
        <button type="button" className="secondary-button" disabled={rows.length >= detail.paymentSchedule.maxInstallments} onClick={addRow}>Add Instalment</button>
        <button type="button" className="secondary-button" onClick={onSplitRemaining}>Split Remaining Equally</button>
      </div>
      <div className="payment-schedule-summary">
        <span><small>Final Agreed Fee</small><strong>{formatMoney(detail.paymentSchedule.finalAgreedFeePaise)}</strong></span>
        <span><small>Schedule Total</small><strong>{formatMoney(total)}</strong></span>
        <span><small>Difference</small><strong>{formatMoney(difference)}</strong></span>
        <span><small>Instalments</small><strong>{rows.length} / {detail.paymentSchedule.maxInstallments}</strong></span>
      </div>
      <label>Reason for change<textarea maxLength={500} value={reason} onChange={(event) => onReasonChange(event.target.value)} required /></label>
      <div className="staff-form-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || invalid}>{saving ? "Saving..." : "Save Changes"}</button>
      </div>
    </form>
  );
}

function CollectionRow({ item, onOpen }: { item: CollectionItem; onOpen: () => void }) {
  return (
    <article className="collection-row">
      <div>
        <strong>{item.studentName}</strong>
        <span>{item.studentNumber} · {item.courseName}</span>
        <small>{item.enrolmentNumber} · {item.branchName} · {item.mobileDisplay || "No mobile"}</small>
      </div>
      <div>
        <small>Outstanding</small>
        <strong>{formatMoney(item.summary.outstandingPaise)}</strong>
      </div>
      <div>
        <small>Overdue</small>
        <strong>{item.summary.overduePaise ? `${formatMoney(item.summary.overduePaise)} · ${item.summary.daysOverdue}d` : "No"}</strong>
      </div>
      <div>
        <small>Next</small>
        <span>{item.summary.nextDueDate || item.summary.nextFollowUpAt?.slice(0, 10) || "None"}</span>
      </div>
      <div className="collection-flags">{item.flags.map((flag) => <span key={flag}>{flag}</span>)}</div>
      <button type="button" onClick={onOpen}>Open</button>
    </article>
  );
}

function SummaryTile({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={emphasis ? "summary-tile summary-tile--emphasis" : "summary-tile"}><small>{label}</small><strong>{value}</strong></div>;
}

function defaultFollowupForm(): FollowupForm {
  return { followupType: "call", outcome: "contacted", note: "", promisedPaymentDate: "", promisedAmount: "", nextFollowUpAt: "" };
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

function formatDisplayDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function localDateTimeToIso(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function equalAmounts(totalPaise: number, count: number) {
  if (!Number.isInteger(count) || count <= 0) return [];
  const base = Math.floor(totalPaise / count);
  let remainder = totalPaise - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
