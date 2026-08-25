import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  createEducationPartner,
  getEducationPartner,
  getEducationPartners,
  getEnquiryOptions,
  issueEducationPartnerReferralLink,
  replaceEducationPartnerReferralLink,
  updateEducationPartner,
  type EducationPartner,
  type EducationPartnerInput,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";
import { formatIndianCurrency } from "../referrals/referralUtils";

const PAGE_SIZE = 20;
const partnerTypes = ["college", "coaching_class", "tuition_centre", "training_institute", "career_counsellor", "placement_consultant", "freelancer", "other"];

export function EducationPartnersPage({ onNavigate, isOwner }: { onNavigate: (path: RoutePath) => void; isOwner: boolean }) {
  const [query, setQuery] = useState({ q: "", status: "", limit: PAGE_SIZE, offset: 0 });
  const [draft, setDraft] = useState({ q: "", status: "" });
  const { data, error, loading, refresh } = usePartnerList(query);
  const [showCreate, setShowCreate] = useState(false);

  if (error) return <ErrorState title="Could not load education partners" message="Please try again after checking the staff session." />;

  return (
    <div className="content-stack staff-enquiries-page referral-ops-page">
      <header className="page-header">
        <h1>Education Partners</h1>
        <p>Owner-managed partner master, commission terms and referral links.</p>
      </header>

      <section className="staff-card referral-ops-filters" aria-label="Education partner filters">
        <label>
          Search
          <input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="Partner, contact, last four" />
        </label>
        <label>
          Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button type="button" onClick={() => setQuery({ ...draft, limit: PAGE_SIZE, offset: 0 })}>Apply</button>
        {isOwner ? <button type="button" className="primary-button" onClick={() => setShowCreate(true)}>Create Partner</button> : null}
      </section>

      {showCreate ? (
        <PartnerForm
          title="Create Education Partner"
          submitLabel="Create Partner"
          onCancel={() => setShowCreate(false)}
          onSaved={async (partnerId) => {
            setShowCreate(false);
            await refresh();
            onNavigate(`/app/education-partners/${partnerId}`);
          }}
        />
      ) : null}

      {loading || !data ? <LoadingState label="Loading education partners" /> : (
        <section className="staff-card referral-ops-table-card">
          <div className="section-heading">
            <h2>Partner Directory</h2>
            <span>{data.pagination.total} total</span>
          </div>
          {data.partners.length === 0 ? <EmptyState title="No partners found" message="Try clearing filters or create the first education partner." /> : (
            <div className="table-list">
              {data.partners.map((partner) => (
                <article className="table-row education-partner-row" key={partner.id}>
                  <button type="button" className="referral-open-button" onClick={() => onNavigate(`/app/education-partners/${partner.id}`)}>
                    <strong>{partner.businessName}</strong>
                    <small>{label(partner.partnerType)} · {partner.branchName}</small>
                  </button>
                  <span>{partner.contactPersonName}</span>
                  <span>{partner.maskedMobile || "No mobile"}</span>
                  <span>{bpsToPercent(partner.currentCommissionBasisPoints)}</span>
                  <span>{label(partner.status)}</span>
                  <span>{partner.referralCount} referrals · {partner.admissionCount} admissions</span>
                </article>
              ))}
            </div>
          )}
          <div className="certificate-pagination">
            <button type="button" className="secondary-button" disabled={data.pagination.offset === 0} onClick={() => setQuery((current) => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}>Previous</button>
            <span>{data.pagination.offset + 1}-{data.pagination.offset + data.partners.length}</span>
            <button type="button" className="secondary-button" disabled={!data.pagination.hasMore} onClick={() => setQuery((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))}>Next</button>
          </div>
        </section>
      )}
    </div>
  );
}

export function EducationPartnerDetailPage({ partnerId, onNavigate, isOwner }: { partnerId: string; onNavigate: (path: RoutePath) => void; isOwner: boolean }) {
  const { detail, error, refresh } = usePartnerDetail(partnerId);
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setLink("");
    setCopied(false);
    setActionError("");
  }, [partnerId]);

  async function issueLink() {
    setActionError("");
    setCopied(false);
    try {
      const result = await issueEducationPartnerReferralLink(partnerId);
      if (result.link) setLink(result.link);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function replaceLink() {
    const confirmed = window.confirm("Replacing this referral link will deactivate the current link. Anyone using the old link will no longer be able to submit a referral. Continue?");
    if (!confirmed) return;
    setActionError("");
    setCopied(false);
    try {
      const result = await replaceEducationPartnerReferralLink(partnerId);
      if (result.link) setLink(result.link);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function copyLink() {
    const shareableLink = currentLink;
    if (!shareableLink) return;
    setActionError("");
    try {
      await copyTextToClipboard(shareableLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (caught) {
      setCopied(false);
      setActionError("Couldn't copy - select the link manually.");
    }
  }

  if (error) return <ErrorState title="Could not load education partner" message="This partner may be outside your staff scope." />;
  if (!detail) return <LoadingState label="Loading education partner" />;
  const partner = detail.partner;
  const currentLink = link || partner.activeLink?.publicUrl || "";
  const hasLegacyActiveLink = Boolean(partner.activeLink && !partner.activeLink.recoverable);

  return (
    <div className="content-stack staff-enquiries-page referral-ops-page">
      <header className="page-header">
        <button type="button" className="secondary-button" onClick={() => onNavigate("/app/education-partners")}>Back</button>
        <h1>{partner.businessName}</h1>
        <p>{label(partner.partnerType)} · {label(partner.status)} · {bpsToPercent(partner.currentCommissionBasisPoints)} commission</p>
      </header>

      <section className="metric-grid">
        <Metric label="Total Referrals" value={detail.metrics.totalReferrals} />
        <Metric label="Admissions" value={detail.metrics.admissions} />
        <Metric label="Approved" value={detail.metrics.approved} />
        <Metric label="Paid" value={detail.metrics.paid} />
        <Metric label="Approved Commission" value={paise(detail.metrics.totalApprovedCommissionPaise)} />
        <Metric label="Paid Commission" value={paise(detail.metrics.totalPaidCommissionPaise)} />
      </section>

      {editing ? (
        <PartnerForm
          title="Edit Education Partner"
          submitLabel="Save Changes"
          partner={partner}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      ) : (
        <section className="detail-grid">
          <article className="staff-card">
            <h2>Partner</h2>
            <DetailField label="Type" value={label(partner.partnerType)} />
            <DetailField label="Contact person" value={partner.contactPersonName} />
            <DetailField label="Mobile" value={partner.maskedMobile || "Not recorded"} />
            <DetailField label="Branch" value={partner.branchName || partner.homeBranchId} />
            <DetailField label="Status" value={label(partner.status)} />
            <DetailField label="Commission" value={bpsToPercent(partner.currentCommissionBasisPoints)} />
            <div className="partner-commission-helper" aria-label="Commission basis">
              <p>Calculated on course fee before GST.</p>
              <p>Current GST: {bpsToPercent(detail.commercialTerms.currentGstBasisPoints)}</p>
              <p>Commission changes apply to new referrals only.</p>
            </div>
            {isOwner ? <button type="button" className="primary-button referral-inline-action" onClick={() => setEditing(true)}>Edit Partner</button> : null}
          </article>

          <article className="staff-card">
            <h2>Referral Link</h2>
            <DetailField label="Active link" value={partner.activeLink ? `Active · last four ${partner.activeLink.lastFour}` : "No active link"} />
            {hasLegacyActiveLink ? <p className="staff-empty">This link was created before secure link recovery was enabled.</p> : null}
            {currentLink ? (
              <div className="partner-link-panel">
                <span className="field-label">Referral Link</span>
                <p className="partner-link-value" title={currentLink} aria-label="Current public referral URL">{currentLink}</p>
                <div className="referral-contact-actions">
                  <button type="button" className="primary-button" onClick={() => void copyLink()} aria-label="Copy current referral link">
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                  <a className="secondary-button partner-link-open" href={currentLink} target="_blank" rel="noopener noreferrer" aria-label="Open current referral link in a new tab">
                    Open Link
                  </a>
                  {isOwner && partner.activeLink ? <button type="button" className="secondary-button" onClick={() => void replaceLink()}>Replace Referral Link</button> : null}
                </div>
                <p className="copy-feedback" aria-live="polite">{copied ? "Referral link copied." : ""}</p>
              </div>
            ) : null}
            {actionError ? <p className="form-error">{actionError}</p> : null}
            {isOwner && !currentLink && partner.activeLink ? <button type="button" className="primary-button referral-inline-action" onClick={() => void replaceLink()}>Replace Referral Link</button> : null}
            {isOwner && !currentLink && !partner.activeLink ? <button type="button" className="primary-button referral-inline-action" onClick={issueLink}>Generate Referral Link</button> : null}
          </article>
        </section>
      )}
    </div>
  );
}

function PartnerForm({ title, submitLabel, partner, onCancel, onSaved }: {
  title: string;
  submitLabel: string;
  partner?: EducationPartner;
  onCancel: () => void;
  onSaved: (partnerId: string) => Promise<void>;
}) {
  const { branches } = useBranches();
  const [form, setForm] = useState<EducationPartnerInput>(() => ({
    partnerType: partner?.partnerType || "college",
    businessName: partner?.businessName || "",
    contactPersonName: partner?.contactPersonName || "",
    mobile: "",
    email: "",
    homeBranchId: partner?.homeBranchId || "branch_sion",
    commissionPercent: partner ? String(partner.currentCommissionBasisPoints / 100) : "",
    status: (partner?.status as "active" | "inactive") || "active",
    internalNotes: partner?.internalNotes || "",
  }));
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setWarnings([]);
    try {
      const result = partner ? await updateEducationPartner(partner.id, form) : await createEducationPartner(form);
      setWarnings(result.duplicateWarnings.map((warning) => `Possible duplicate: ${warning.businessName}`));
      await onSaved(result.partnerId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="staff-card">
      <div className="section-heading">
        <h2>{title}</h2>
        <span>Owner only</span>
      </div>
      <form className="referral-payout-form education-partner-form" onSubmit={submit}>
        <label>
          Partner Type
          <select value={form.partnerType} onChange={(event) => setForm({ ...form, partnerType: event.target.value })}>
            {partnerTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}
          </select>
        </label>
        <label>
          Business / Partner Name
          <input value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} />
        </label>
        <label>
          Contact Person
          <input value={form.contactPersonName} onChange={(event) => setForm({ ...form, contactPersonName: event.target.value })} />
        </label>
        <label>
          Mobile
          <input value={form.mobile || ""} onChange={(event) => setForm({ ...form, mobile: event.target.value })} />
        </label>
        <label>
          Email
          <input value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>
          Branch
          <select value={form.homeBranchId} onChange={(event) => setForm({ ...form, homeBranchId: event.target.value })}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label>
          Commission %
          <input inputMode="decimal" value={form.commissionPercent} onChange={(event) => setForm({ ...form, commissionPercent: event.target.value })} />
        </label>
        <label>
          Status
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label>
          Internal Notes
          <input value={form.internalNotes || ""} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} />
        </label>
        <p className="staff-empty">Commission changes apply to new referrals only.</p>
        {warnings.map((warning) => <p className="form-warning" key={warning}>{warning}</p>)}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="referral-contact-actions">
          <button type="submit" className="primary-button" disabled={busy}>{submitLabel}</button>
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

function usePartnerList(query: { q: string; status: string; limit: number; offset: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getEducationPartners>> | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const key = useMemo(() => JSON.stringify(query), [query]);

  async function refresh() {
    setData(await getEducationPartners(query));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void getEducationPartners(query)
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

function usePartnerDetail(partnerId: string) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getEducationPartner>> | null>(null);
  const [error, setError] = useState(false);

  async function refresh() {
    setDetail(await getEducationPartner(partnerId));
  }

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(false);
    void getEducationPartner(partnerId)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [partnerId]);

  return { detail, error, refresh };
}

function useBranches() {
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([{ id: "branch_sion", name: "Sion" }]);
  useEffect(() => {
    let active = true;
    void getEnquiryOptions().then((options) => {
      if (active) setBranches(options.branches.map((branch) => ({ id: branch.id, name: branch.name })));
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return { branches };
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function DetailField({ label: fieldLabel, value }: { label: string; value: string }) {
  return <div><small>{fieldLabel}</small><strong>{value}</strong></div>;
}

function label(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function bpsToPercent(bps: number) {
  return `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

export async function copyTextToClipboard(text: string, clipboard?: Pick<Clipboard, "writeText">) {
  const targetClipboard = clipboard || (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  let clipboardError: unknown;
  if (targetClipboard?.writeText) {
    try {
      await targetClipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }
  if (typeof document === "undefined") throw clipboardError instanceof Error ? clipboardError : new Error("Clipboard is not available.");
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) throw new Error("Copy command was not available.");
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
}

function paise(value: number) {
  return formatIndianCurrency(Math.round(value / 100));
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The partner action could not be completed.";
}
