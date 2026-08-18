import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getStaffReferralDetail,
  getStaffReferrals,
  type StaffReferralDetail,
  type StaffReferralList,
  type StaffReferralListItem,
  type StaffReferralQuery,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";
import { formatIndianCurrency } from "../referrals/referralUtils";

const PAGE_SIZE = 20;
const referralStatusOptions = ["submitted", "accepted", "rejected", "active", "converted", "expired", "cancelled", "closed"];

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
          Referral admin state
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
            <option value="payment_data_unavailable">Payment data unavailable</option>
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
        <Metric label="Payment data unavailable" value={data.summary.paymentDataUnavailable} />
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
              <span>Submitted</span>
              <span>Referrer</span>
              <span>Prospect</span>
              <span>Mobile</span>
              <span>Course</span>
              <span>Enquiry</span>
              <span>Admission</span>
              <span>Validity</span>
              <span>Payment Qualification</span>
              <span>Reward Status</span>
            </div>
            {data.referrals.map((referral) => (
              <div className="referral-ops-row referral-ops-row--item" role="row" key={referral.referralId}>
                <span>
                  <button type="button" className="referral-open-button" onClick={() => onNavigate(`/app/referral-operations/${referral.referralId}`)}>
                    <strong>{referral.shortReference}</strong>
                    <small>{formatDate(referral.submittedAt)}</small>
                  </button>
                </span>
                <span><strong>{referral.referrerName}</strong><small>{label(referral.referrerType) || "Referrer"}</small></span>
                <span><strong>{referral.prospectPublicName}</strong><small>{label(referral.referralStatus) || "Referral"}</small></span>
                <ContactCell contact={referral.prospectContact} compact />
                <span><strong>{referral.courseInterested || "Course pending"}</strong><small>Referral interest</small></span>
                <span><strong>{referral.linkedEnquiry?.status ? label(referral.linkedEnquiry.status) : "Not linked"}</strong><small>{referral.linkedEnquiry?.enquiryNumber || "No enquiry"}</small></span>
                <span><strong>{admissionLabel(referral.admissionStatus)}</strong><small>{referral.linkedEnrolment?.enrolmentNumber || "No enrolment"}</small></span>
                <span><strong>{validityLabel(referral.validityState, referral.validUntil)}</strong><small>90-day admission rule</small></span>
                <span><strong>{label(referral.qualificationState)}</strong><small>{referral.rewardStatus}</small></span>
                <span><strong>{referral.rewardStatus}</strong><small>Rewards deferred</small></span>
              </div>
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
  const { detail, error } = useStaffReferralDetail(referralId);

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
        <DetailField label="Referral admin state" value={label(detail.referralStatus)} />
        <DetailField label="Payment qualification" value={label(detail.qualificationState)} />
        <DetailField label="Submitted" value={formatDateTime(detail.submittedAt)} />
        <DetailField label="Validity" value={validityLabel(detail.validityState, detail.validUntil)} />
      </section>

      <section className="detail-grid">
        <article className="staff-card">
          <h2>Referral</h2>
          <DetailField label="Referrer" value={detail.referrer.publicName || detail.referrerName} />
          <DetailField label="Public name" value={detail.referrer.publicName || detail.referrerName} />
          <DetailField label="Type" value={label(detail.referrer.type)} />
          <DetailField label="Course" value={detail.courseInterested || "Course pending"} />
          <DetailField label="Submitted" value={formatDateTime(detail.submittedAt)} />
        </article>
        <article className="staff-card">
          <h2>Prospect Contact</h2>
          <ContactCell contact={detail.prospectContact} />
        </article>
        <article className="staff-card">
          <h2>Enquiry</h2>
          <DetailField label="Enquiry" value={detail.linkedEnquiry ? detail.linkedEnquiry.enquiryNumber : "Not linked"} />
          <DetailField label="Current status" value={detail.linkedEnquiry ? label(detail.linkedEnquiry.status) : "Not linked"} />
          {detail.linkedEnquiry ? <button type="button" className="secondary-button referral-inline-action" onClick={() => onNavigate(`/app/enquiries/${detail.linkedEnquiry!.id}`)}>Open Enquiry</button> : <p className="staff-empty">Enquiry workflow lives in the Enquiry module.</p>}
        </article>
        <article className="staff-card">
          <h2>Admission</h2>
          <DetailField label="Admission" value={admissionLabel(detail.admissionStatus)} />
          <DetailField label="Student ID" value={detail.linkedEnrolment?.studentNumber || "Not admitted"} />
          <DetailField label="Enrolment" value={detail.linkedEnrolment?.enrolmentNumber || "Not admitted"} />
          <DetailField label="Course" value={detail.linkedEnrolment?.courseName || "Not admitted"} />
          <DetailField label="Admission date" value={detail.linkedEnrolment?.admissionDate ? formatDate(detail.linkedEnrolment.admissionDate) : "Not admitted"} />
          <DetailField label="Joining date" value={detail.linkedEnrolment?.joiningDate ? formatDate(detail.linkedEnrolment.joiningDate) : "Not admitted"} />
          <DetailField label="Within validity" value={detail.validityState === "valid_admission" ? "Yes" : detail.validityState === "admission_after_expiry" ? "No" : "No admission"} />
        </article>
      </section>

      <section className="staff-card">
        <div className="section-heading">
          <h2>Payment Qualification</h2>
          <span>Receipts system pending</span>
        </div>
        {detail.fee ? (
          <div className="detail-grid referral-fee-grid">
            <DetailField label="Final agreed fee" value={paise(detail.fee.finalAgreedFeePaise)} />
            <DetailField label="Reward threshold" value="50%" />
            <DetailField label="Required amount" value={paise(detail.fee.minimumQualifyingPaymentPaise)} />
            <DetailField label="Amount received" value="Unavailable" />
            <DetailField label="Qualification" value={label(detail.qualificationState)} />
          </div>
        ) : (
          <p className="staff-empty">No active fee agreement is linked through an admitted enrolment.</p>
        )}
      </section>

      <section className="staff-card">
        <div className="section-heading">
          <h2>Reward</h2>
          <span>{isOwner ? "Owner access active" : "Read-only readiness"}</span>
        </div>
        <div className="detail-grid referral-fee-grid">
          <DetailField label="Current status" value={detail.rewardStatus} />
          <DetailField label="Cash reward if qualified" value={rewardOption(detail.rewardSlabs, "cash")} />
          <DetailField label="Course credit if qualified" value={rewardOption(detail.rewardSlabs, "credit")} />
          <DetailField label="Approval / payout" value="Deferred" />
        </div>
        <p className="staff-empty">Reward approval and payout actions are not enabled because receipts and audited reward fulfilment are future modules.</p>
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
  }, [referralId]);

  return { detail, error };
}

export function ContactCell({ contact, compact = false }: { contact: StaffReferralListItem["prospectContact"]; compact?: boolean }) {
  if (!contact.mobile || !contact.mobileDisplay) {
    return compact ? <span className="referral-contact-unavailable">Contact unavailable</span> : <p className="staff-empty referral-contact-unavailable">Contact number unavailable</p>;
  }
  return (
    <span className={`referral-contact ${compact ? "referral-contact--compact" : ""}`}>
      <strong className="referral-contact-number">{contact.mobileDisplay}</strong>
      <span className="referral-contact-actions">
        {contact.whatsappUrl ? (
          <a className="contact-action contact-action--whatsapp" href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp prospect">
            WhatsApp
          </a>
        ) : null}
        {contact.callUrl ? <a className="contact-action" href={contact.callUrl} aria-label="Call prospect">Call</a> : null}
      </span>
    </span>
  );
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

function label(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function admissionLabel(value: string) {
  if (value === "done") return "Done";
  if (value === "outside_validity") return "Admission outside referral validity";
  return "Not done";
}

function validityLabel(state: string, validUntil: string) {
  if (state === "valid_admission") return "Valid admission";
  if (state === "admission_after_expiry") return "Admission after expiry";
  if (state === "expired") return "Expired";
  return `Expires ${formatDate(validUntil)}`;
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

function rewardOption(slabs: StaffReferralDetail["rewardSlabs"], type: "cash" | "credit") {
  const values = slabs.map((slab) => type === "cash" ? slab.cashRewardPaise : slab.courseCreditPaise).filter((value) => value > 0);
  if (values.length === 0) return "Configured after qualification";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? paise(min) : `${paise(min)}-${paise(max)}`;
}
