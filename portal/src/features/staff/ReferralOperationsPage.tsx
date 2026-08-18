import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getStaffReferralDetail,
  getStaffReferrals,
  updateStaffReferralStatus,
  type StaffReferralDetail,
  type StaffReferralList,
  type StaffReferralListItem,
  type StaffReferralQuery,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";
import { formatIndianCurrency } from "../referrals/referralUtils";

const PAGE_SIZE = 20;
const referralStatusOptions = ["submitted", "accepted", "rejected", "active", "converted", "expired", "cancelled", "closed"];
const transitionOptions = ["accepted", "active", "converted", "expired", "cancelled", "closed", "rejected"];

export function ReferralOperationsPage({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  const [query, setQuery] = useState<StaffReferralQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [draft, setDraft] = useState({ q: "", status: "", rewardStatus: "", referrerType: "", admission: "", validity: "", fromDate: "", toDate: "" });
  const { data, error, loading } = useStaffReferralList(query);

  function applyFilters() {
    setQuery({ ...draft, limit: PAGE_SIZE, offset: 0 });
  }

  function page(delta: number) {
    setQuery((current) => ({ ...current, limit: PAGE_SIZE, offset: Math.max(0, Number(current.offset || 0) + delta * PAGE_SIZE) }));
  }

  if (error) return <ErrorState title="Could not load referral operations" message="Please try again after checking the staff session." />;

  return (
    <div className="content-stack staff-enquiries-page referral-ops-page">
      <header className="page-header">
        <h1>Referral Operations</h1>
        <p>Manage referral progress, admission linkage and reward readiness across the organisation.</p>
      </header>

      <section className="staff-card referral-ops-filters" aria-label="Referral filters">
        <label>
          Search
          <input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="Reference, prospect, referrer, enquiry" />
        </label>
        <label>
          Referral status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="">All statuses</option>
            {referralStatusOptions.map((status) => <option key={status} value={status}>{label(status)}</option>)}
          </select>
        </label>
        <label>
          Reward state
          <select value={draft.rewardStatus} onChange={(event) => setDraft({ ...draft, rewardStatus: event.target.value })}>
            <option value="">All reward states</option>
            <option value="pending">Pending</option>
            <option value="qualified_pending_approval">Qualified</option>
            <option value="expired">Expired</option>
          </select>
        </label>
        <label>
          Referrer type
          <select value={draft.referrerType} onChange={(event) => setDraft({ ...draft, referrerType: event.target.value })}>
            <option value="">All referrers</option>
            <option value="student">Student</option>
            <option value="alumni">Alumni</option>
          </select>
        </label>
        <label>
          Admission
          <select value={draft.admission} onChange={(event) => setDraft({ ...draft, admission: event.target.value })}>
            <option value="">All</option>
            <option value="admitted">Admitted</option>
            <option value="not_admitted">Not admitted</option>
          </select>
        </label>
        <label>
          Validity
          <select value={draft.validity} onChange={(event) => setDraft({ ...draft, validity: event.target.value })}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={draft.fromDate} onChange={(event) => setDraft({ ...draft, fromDate: event.target.value })} />
        </label>
        <label>
          To
          <input type="date" value={draft.toDate} onChange={(event) => setDraft({ ...draft, toDate: event.target.value })} />
        </label>
        <button type="button" onClick={applyFilters}>Apply</button>
      </section>

      {loading || !data ? <LoadingState label="Loading referral operations" /> : <ReferralOperationsContent data={data} onNavigate={onNavigate} onPage={page} />}
    </div>
  );
}

export function ReferralOperationsContent({
  data,
  onNavigate,
  onPage,
}: {
  data: StaffReferralList;
  onNavigate: (path: RoutePath) => void;
  onPage: (delta: number) => void;
}) {
  return (
    <>
      <section className="metric-grid" aria-label="Referral operations summary">
        <Metric label="Loaded referrals" value={data.summary.totalReferrals} />
        <Metric label="Admitted" value={data.summary.admitted} />
        <Metric label="Qualified" value={data.summary.qualified} />
        <Metric label="Expired" value={data.summary.expired} />
      </section>

      <section className="staff-card referral-ops-table-card" aria-labelledby="referral-ops-table-title">
        <div className="section-heading">
          <h2 id="referral-ops-table-title">Referral queue</h2>
          <span>{data.pagination.total} total</span>
        </div>
        {data.referrals.length === 0 ? (
          <EmptyState title="No referrals found" message="Try clearing filters or checking a different date range." />
        ) : (
          <div className="referral-ops-table" role="table" aria-label="Referral operations queue">
            <div className="referral-ops-row referral-ops-row--head" role="row">
              <span>Reference</span>
              <span>Referrer</span>
              <span>Prospect</span>
              <span>Status</span>
              <span>Admission</span>
              <span>Reward</span>
              <span>Last activity</span>
            </div>
            {data.referrals.map((referral) => (
              <button type="button" className="referral-ops-row referral-ops-row--button" key={referral.referralId} onClick={() => onNavigate(`/app/referral-operations/${referral.referralId}`)}>
                <span><strong>{referral.shortReference}</strong><small>{formatDate(referral.submittedAt)}</small></span>
                <span><strong>{referral.referrerName}</strong><small>{label(referral.referrerType) || "Referrer"}</small></span>
                <span><strong>{referral.prospectPublicName}</strong><small>{referral.courseInterested || "Course pending"}</small></span>
                <StatusChip value={referral.referralStatus} />
                <span><strong>{label(referral.admissionStatus)}</strong><small>{referral.linkedEnquiry?.enquiryNumber || "No enquiry"}</small></span>
                <span><strong>{label(referral.qualificationState)}</strong><small>{referral.rewardStatus}</small></span>
                <span><strong>{formatDate(referral.lastActivityAt)}</strong><small>{referral.validityState === "expired" ? "Expired" : `Expires ${formatDate(referral.validUntil)}`}</small></span>
              </button>
            ))}
          </div>
        )}
        <div className="certificate-pagination">
          <button type="button" className="secondary-button" disabled={data.pagination.offset === 0} onClick={() => onPage(-1)}>Previous</button>
          <span>{data.pagination.offset + 1}-{data.pagination.offset + data.referrals.length}</span>
          <button type="button" className="secondary-button" disabled={!data.pagination.hasMore} onClick={() => onPage(1)}>Next</button>
        </div>
      </section>
    </>
  );
}

export function ReferralOperationsDetailPage({ referralId, onNavigate, isOwner }: { referralId: string; onNavigate: (path: RoutePath) => void; isOwner: boolean }) {
  const { detail, error, refresh } = useStaffReferralDetail(referralId);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveStatus() {
    if (!status) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await updateStaffReferralStatus(referralId, status, note);
      setMessage(result.idempotent ? "Referral was already in that status." : "Referral status updated.");
      setStatus("");
      setNote("");
      refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not update referral status.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState title="Could not load referral" message="This referral may be outside your staff scope." />;
  if (!detail) return <LoadingState label="Loading referral detail" />;

  return (
    <div className="content-stack staff-enquiries-page referral-ops-page">
      <header className="page-header">
        <button type="button" className="secondary-button" onClick={() => onNavigate("/app/referral-operations")}>Back</button>
        <h1>Referral {detail.shortReference}</h1>
        <p>{detail.prospectPublicName} referred by {detail.referrer.publicName || detail.referrerName}</p>
      </header>

      <section className="staff-card referral-detail-hero">
        <DetailField label="Status" value={label(detail.referralStatus)} />
        <DetailField label="Qualification" value={label(detail.qualificationState)} />
        <DetailField label="Submitted" value={formatDateTime(detail.submittedAt)} />
        <DetailField label="Validity" value={`${detail.validityState === "expired" ? "Expired" : "Active"} until ${formatDate(detail.validUntil)}`} />
      </section>

      <section className="detail-grid">
        <article className="staff-card">
          <h2>Referrer</h2>
          <DetailField label="Public name" value={detail.referrer.publicName || detail.referrerName} />
          <DetailField label="Type" value={label(detail.referrer.type)} />
          <DetailField label="External ID" value={detail.referrer.externalReferrerId || "Not available"} />
        </article>
        <article className="staff-card">
          <h2>Referral Links</h2>
          <DetailField label="Enquiry" value={detail.linkedEnquiry ? detail.linkedEnquiry.enquiryNumber : "Not linked"} />
          <DetailField label="Admission" value={detail.linkedEnrolment ? detail.linkedEnrolment.enrolmentNumber : "Not admitted"} />
          <DetailField label="Matched person" value={detail.matchedPerson?.publicName || "Not matched"} />
        </article>
        <article className="staff-card">
          <h2>Reward Readiness</h2>
          <DetailField label="Reward status" value={detail.rewardStatus} />
          <DetailField label="Cash reward" value={detail.reward ? paise(detail.reward.cashRewardPaise) : "Pending"} />
          <DetailField label="Course credit" value={detail.reward ? paise(detail.reward.courseCreditPaise) : "Pending"} />
        </article>
      </section>

      <section className="staff-card">
        <div className="section-heading">
          <h2>Fee Qualification</h2>
          <span>Server authoritative</span>
        </div>
        {detail.fee ? (
          <div className="detail-grid referral-fee-grid">
            <DetailField label="Final agreed fee" value={paise(detail.fee.finalAgreedFeePaise)} />
            <DetailField label="50% qualifying threshold" value={paise(detail.fee.minimumQualifyingPaymentPaise)} />
            <DetailField label="Received amount" value="Payment receipts not modelled yet" />
          </div>
        ) : (
          <p className="staff-empty">No active fee agreement is linked through an admitted enrolment.</p>
        )}
      </section>

      <section className="staff-card">
        <div className="section-heading">
          <h2>Status Transition</h2>
          <span>{isOwner ? "Owner access active" : "Staff access"}</span>
        </div>
        <div className="action-row referral-status-action">
          <label>
            Next status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Select status</option>
              {transitionOptions.map((option) => <option key={option} value={option}>{label(option)}</option>)}
            </select>
          </label>
          <label>
            Internal note
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional operational note" />
          </label>
          <button type="button" disabled={!status || busy} onClick={() => void saveStatus()}>{busy ? "Saving" : "Update"}</button>
        </div>
        {message ? <p className="staff-empty" aria-live="polite">{message}</p> : null}
        {isOwner ? <p className="staff-empty">Reward approval and payout actions are not enabled because no audited reward approval/fulfilment schema exists yet.</p> : null}
      </section>

      <section className="staff-card">
        <h2>Status Timeline</h2>
        {detail.timeline.length === 0 ? (
          <p className="staff-empty">No status events have been recorded yet.</p>
        ) : (
          <div className="table-list">
            {detail.timeline.map((event) => (
              <article className="table-row" key={event.id}>
                <strong>{label(event.toStatus)}</strong>
                <small>{formatDateTime(event.createdAt)} {event.actorPublicName ? `by ${event.actorPublicName}` : ""}</small>
                {event.internalNote ? <span>{event.internalNote}</span> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function useStaffReferralList(query: StaffReferralQuery) {
  const [data, setData] = useState<StaffReferralList | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const key = useMemo(() => JSON.stringify(query), [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void getStaffReferrals(query)
      .then((next) => {
        if (!active) return;
        setData(next);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key]);

  return { data, error, loading };
}

function useStaffReferralDetail(referralId: string) {
  const [detail, setDetail] = useState<StaffReferralDetail | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(false);
    void getStaffReferralDetail(referralId)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [referralId, refreshKey]);

  return { detail, error, refresh: () => setRefreshKey((value) => value + 1) };
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailField({ label: fieldLabel, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{fieldLabel}</small>
      <strong>{value}</strong>
    </div>
  );
}

function StatusChip({ value }: { value: StaffReferralListItem["referralStatus"] }) {
  return <span className={`status-pill status-pill--${value === "converted" ? "issued" : value === "expired" || value === "cancelled" || value === "rejected" ? "revoked" : "warning"}`}>{label(value)}</span>;
}

function label(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function paise(value: number) {
  return formatIndianCurrency(Math.round(value / 100));
}
