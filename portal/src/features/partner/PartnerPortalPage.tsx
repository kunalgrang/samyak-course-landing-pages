import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getEducationPartnerPortalPreview,
  getPartnerPortal,
  logoutPartner,
  type PartnerPortal,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";
import { formatIndianCurrency } from "../referrals/referralUtils";
import { copyTextToClipboard } from "../staff/EducationPartnersPage";

const PAGE_SIZE = 20;

export function PartnerPortalPage({
  mode,
  partnerId,
  onNavigate,
}: {
  mode: "self" | "preview";
  partnerId?: string;
  onNavigate: (path: RoutePath) => void;
}) {
  const [offset, setOffset] = useState(0);
  const { data, error, loading, refresh } = usePartnerPortal(mode, partnerId || "", offset);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setOffset(0);
    setCopied(false);
    setActionError("");
  }, [mode, partnerId]);

  async function copyLink() {
    if (!data?.referralLink.publicUrl) return;
    setActionError("");
    try {
      await copyTextToClipboard(data.referralLink.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setActionError("Couldn't copy - select the link manually.");
    }
  }

  async function signOut() {
    await logoutPartner().catch(() => undefined);
    onNavigate("/partner/login");
  }

  if (loading && !data) return <LoadingState label={mode === "preview" ? "Loading partner preview" : "Loading partner portal"} />;
  if (error || !data) return <ErrorState title="Could not load partner portal" message={mode === "preview" ? "This preview may be unavailable to your account." : "Please sign in again."} />;

  return (
    <div className="content-stack partner-portal-page">
      {mode === "preview" ? (
        <section className="preview-banner" aria-label="Partner portal preview">
          <div>
            <strong>Partner Portal Preview</strong>
            <span>Viewing as {data.partner.businessName}</span>
          </div>
          <button type="button" className="secondary-button" onClick={() => onNavigate(`/app/education-partners/${partnerId || ""}`)}>Exit Preview</button>
        </section>
      ) : null}

      <header className="page-header partner-portal-header">
        <div>
          <h1>{data.partner.businessName}</h1>
          <p>{label(data.partner.partnerType)} · {data.partner.branchName || "Samyak"} · {label(data.partner.status)}</p>
        </div>
        {mode === "self" ? <button type="button" className="secondary-button" onClick={() => void signOut()}>Sign Out</button> : null}
      </header>

      <section className="metric-grid" aria-label="Partner summary">
        <Metric label="Total Referrals" value={data.summary.totalReferrals} />
        <Metric label="Admissions" value={data.summary.admissions} />
        <Metric label="Awaiting Payment" value={data.summary.awaitingPayment} />
        <Metric label="Qualified" value={data.summary.qualified} />
        <Metric label="Approved" value={data.summary.approved} />
        <Metric label="Paid" value={data.summary.paid} />
        <Metric label="Approved Commission" value={paise(data.summary.totalApprovedCommissionPaise)} />
        <Metric label="Paid Commission" value={paise(data.summary.totalPaidCommissionPaise)} />
      </section>

      <section className="partner-portal-grid">
        <article className="staff-card partner-link-card">
          <div className="section-heading">
            <h2>Referral Link</h2>
            <span>{data.referralLink.hasActiveLink ? "Active" : "Unavailable"}</span>
          </div>
          {data.referralLink.publicUrl ? (
            <div className="partner-link-panel">
              <p className="partner-link-value" title={data.referralLink.publicUrl} aria-label="Current public referral URL">{data.referralLink.publicUrl}</p>
              <div className="referral-contact-actions">
                <button type="button" className="primary-button" onClick={() => void copyLink()}>{copied ? "Copied" : "Copy Link"}</button>
                <a className="secondary-button partner-link-open" href={data.referralLink.publicUrl} target="_blank" rel="noopener noreferrer">Open Link</a>
              </div>
              <p className="copy-feedback" aria-live="polite">{copied ? "Referral link copied." : ""}</p>
            </div>
          ) : (
            <p className="staff-empty">{data.referralLink.message}</p>
          )}
          {data.referralLink.lastFour ? <DetailField label="Last four" value={data.referralLink.lastFour} /> : null}
          {data.referralLink.activatedAt ? <DetailField label="Activated" value={formatDate(data.referralLink.activatedAt)} /> : null}
          {actionError ? <p className="form-error">{actionError}</p> : null}
        </article>

        <article className="staff-card">
          <h2>Commercial Terms</h2>
          <DetailField label="Commission" value={bpsToPercent(data.partner.currentCommissionBasisPoints)} />
          <DetailField label="GST basis" value={bpsToPercent(data.partner.gstBasisPoints)} />
          <DetailField label="Member since" value={formatDate(data.partner.memberSince)} />
          <p className="partner-commission-helper">Commission is calculated on course fee before GST. Changes made by Samyak apply to new referrals only.</p>
        </article>
      </section>

      <section className="staff-card partner-referral-card">
        <div className="section-heading">
          <h2>Referrals</h2>
          <span>{data.pagination.total} total</span>
        </div>
        {data.referrals.length === 0 ? <EmptyState title="No referrals yet" message="Shared referral submissions will appear here." /> : (
          <div className="partner-referral-table" role="table" aria-label="Partner referral list">
            <div className="partner-referral-row partner-referral-row--head" role="row">
              <span>Reference</span>
              <span>Student</span>
              <span>Course</span>
              <span>Status</span>
              <span>Commission</span>
              <span>Paid</span>
            </div>
            {data.referrals.map((referral) => (
              <div className="partner-referral-row" role="row" key={referral.reference}>
                <span><strong>{referral.reference}</strong><small>{formatDate(referral.submittedAt)}</small></span>
                <span>{referral.prospectPublicName}</span>
                <span>{referral.courseInterested}</span>
                <span><strong>{referral.publicStatus}</strong><small>{referral.commissionStatus}</small></span>
                <span>{referral.approvedCommissionPaise > 0 ? paise(referral.approvedCommissionPaise) : "-"}</span>
                <span>{referral.paidCommissionPaise > 0 ? `${paise(referral.paidCommissionPaise)} · ${label(referral.paymentMode || "")}` : "-"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="certificate-pagination">
          <button type="button" className="secondary-button" disabled={data.pagination.offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Previous</button>
          <span>{data.pagination.offset + 1}-{data.pagination.offset + data.referrals.length}</span>
          <button type="button" className="secondary-button" disabled={!data.pagination.hasMore} onClick={() => setOffset((value) => value + PAGE_SIZE)}>Next</button>
          <button type="button" className="secondary-button" onClick={() => void refresh()}>Refresh</button>
        </div>
      </section>
    </div>
  );
}

function usePartnerPortal(mode: "self" | "preview", partnerId: string, offset: number) {
  const [data, setData] = useState<PartnerPortal | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const key = useMemo(() => JSON.stringify({ mode, partnerId, offset }), [mode, partnerId, offset]);

  async function refresh() {
    setData(await loadPortal(mode, partnerId, offset));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void loadPortal(mode, partnerId, offset)
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key]);

  return { data, error, loading, refresh };
}

function loadPortal(mode: "self" | "preview", partnerId: string, offset: number) {
  const params = { limit: PAGE_SIZE, offset };
  return mode === "preview" ? getEducationPartnerPortalPreview(partnerId, params) : getPartnerPortal(params);
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function DetailField({ label: fieldLabel, value }: { label: string; value: string }) {
  return <div className="partner-detail-field"><small>{fieldLabel}</small><strong>{value}</strong></div>;
}

function bpsToPercent(bps: number) {
  return `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

function paise(value: number) {
  return formatIndianCurrency(Math.round(value / 100));
}

function formatDate(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function label(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}
