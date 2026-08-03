import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { decideDiscountApproval, getDiscountApprovals } from "../../lib/api";

type ApprovalRow = Record<string, unknown>;
type Decision = "approved" | "rejected";

export function DiscountApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [decidingIds, setDecidingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    try {
      setApprovals((await getDiscountApprovals()).approvals);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load approvals.");
    } finally {
      setIsLoading(false);
    }
  }

  async function decide(approvalId: string, decision: Decision) {
    if (decidingIds.has(approvalId)) return;
    setDecidingIds((current) => new Set(current).add(approvalId));
    try {
      await decideDiscountApproval(approvalId, decision);
      await load();
      setSuccess(`Request ${decision}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update approval.");
      setSuccess(null);
    } finally {
      setDecidingIds((current) => {
        const next = new Set(current);
        next.delete(approvalId);
        return next;
      });
    }
  }

  if (isLoading) return <LoadingState label="Loading discount approvals" />;

  return <DiscountApprovalsContent approvals={approvals} decidingIds={decidingIds} error={error} success={success} onDecide={(id, decision) => void decide(id, decision)} />;
}

export function DiscountApprovalsContent({
  approvals,
  decidingIds = new Set(),
  error,
  success,
  onDecide,
}: {
  approvals: ApprovalRow[];
  decidingIds?: Set<string>;
  error: string | null;
  success: string | null;
  onDecide: (approvalId: string, decision: Decision) => void;
}) {
  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Discount Approvals</h1>
        <p>Owner queue for below-floor admission fee requests.</p>
      </header>
      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      {success ? <div className="notice notice--success" role="status"><strong>{success}</strong></div> : null}
      <section className="staff-card">
        <div className="section-heading"><h2>Requests</h2><span>{approvals.length}</span></div>
        <div className="table-list">
          {approvals.map((approval) => {
            const id = String(approval.id);
            const status = String(approval.status);
            const listed = Number(approval.listed_fee_paise || 0);
            const floor = Number(approval.lowest_acceptable_fee_paise || 0);
            const requested = Number(approval.requested_final_fee_paise || 0);
            const discount = Number(approval.discount_amount_paise || Math.max(0, listed - requested));
            const isDeciding = decidingIds.has(id);
            return (
              <article key={id} className="table-row">
                <strong>{String(approval.full_name || "Student")} - {String(approval.enquiry_number || "")}</strong>
                <span>{String(approval.course_name || "Course")} - {status}</span>
                <div className="detail-grid">
                  <Detail label="Listed price" value={formatMoney(listed)} />
                  <Detail label="Lowest acceptable" value={formatMoney(floor)} />
                  <Detail label="Requested final" value={formatMoney(requested)} />
                  <Detail label="Discount" value={`${formatMoney(discount)}${listed > 0 ? ` (${Math.round((discount / listed) * 100)}%)` : ""}`} />
                  <Detail label="Reason" value={String(approval.discount_reason_text || approval.discount_reason_code || "No reason")} />
                  <Detail label="Requesting staff" value={String(approval.requested_by_name || approval.requested_by_login_account_id || "Staff")} />
                  <Detail label="Requested" value={formatDateTime(String(approval.created_at || ""))} />
                  <Detail label="Current status" value={status} />
                </div>
                {status === "pending" ? (
                  <div className="staff-form-actions">
                    <button type="button" className="secondary-button" disabled={isDeciding} onClick={() => onDecide(id, "rejected")}>{isDeciding ? "Working..." : "Reject"}</button>
                    <button type="button" disabled={isDeciding} onClick={() => onDecide(id, "approved")}>{isDeciding ? "Working..." : "Approve"}</button>
                  </div>
                ) : null}
              </article>
            );
          })}
          {!approvals.length ? <p className="staff-empty">No discount approvals.</p> : null}
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

function formatDateTime(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return value || "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
