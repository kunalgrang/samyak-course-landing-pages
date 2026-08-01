import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { decideDiscountApproval, getDiscountApprovals } from "../../lib/api";

type ApprovalRow = Record<string, unknown>;

export function DiscountApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    try {
      await decideDiscountApproval(approvalId, decision);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update approval.");
    }
  }

  if (isLoading) return <LoadingState label="Loading discount approvals" />;

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Discount Approvals</h1>
        <p>Owner queue for below-floor admission fee requests.</p>
      </header>
      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      <section className="staff-card">
        <div className="section-heading"><h2>Requests</h2><span>{approvals.length}</span></div>
        <div className="table-list">
          {approvals.map((approval) => {
            const id = String(approval.id);
            const status = String(approval.status);
            return (
              <article key={id} className="table-row">
                <strong>{String(approval.full_name || "Student")} - {String(approval.enquiry_number || "")}</strong>
                <span>{String(approval.course_name || "Course")} - {formatMoney(Number(approval.requested_final_fee_paise || 0))}</span>
                <small>{String(approval.discount_reason_text || approval.discount_reason_code || "No reason")} - {status}</small>
                {status === "pending" ? (
                  <div className="staff-form-actions">
                    <button type="button" className="secondary-button" onClick={() => void decide(id, "rejected")}>Reject</button>
                    <button type="button" onClick={() => void decide(id, "approved")}>Approve</button>
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

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
