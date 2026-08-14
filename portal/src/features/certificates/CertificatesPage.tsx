import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useAuth } from "../auth/AuthContext";
import {
  getEligibleCertificates,
  getStaffCertificates,
  getStudentCertificates,
  issueStaffCertificate,
  revokeStaffCertificate,
  type CertificateListItem,
  type EligibleCertificate,
} from "../../lib/api";

type Tab = "eligible" | "issued" | "revoked";

const staffRoles = new Set(["owner", "admin", "system_admin", "counsellor", "admission_admin"]);
const ownerRoles = new Set(["owner"]);

export function CertificatesPage() {
  const { session } = useAuth();
  const roles = session?.accountRoles || [];
  const isStaff = roles.some((role) => staffRoles.has(role));
  const isOwner = roles.some((role) => ownerRoles.has(role));
  return isStaff ? <StaffCertificates isOwner={isOwner} /> : <StudentCertificates />;
}

function StaffCertificates({ isOwner }: { isOwner: boolean }) {
  const [tab, setTab] = useState<Tab>("eligible");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [eligible, setEligible] = useState<EligibleCertificate[]>([]);
  const [certificates, setCertificates] = useState<CertificateListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIssue, setPendingIssue] = useState<{ enrolment: EligibleCertificate; issueDate: string } | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const limit = 25;

  useEffect(() => {
    void load();
  }, [tab, offset]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const params = { q: query.trim() || undefined, limit, offset };
      if (tab === "eligible") {
        const response = await getEligibleCertificates(params);
        setEligible(response.items);
        setCertificates([]);
        setHasMore(response.pagination.hasMore);
      } else {
        const response = await getStaffCertificates({ ...params, status: tab });
        setCertificates(response.items);
        setEligible([]);
        setHasMore(response.pagination.hasMore);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load certificates.");
    } finally {
      setIsLoading(false);
    }
  }

  function prepareIssue(enrolment: EligibleCertificate) {
    setMessage(null);
    setError(null);
    setPendingIssue({ enrolment, issueDate: new Date().toISOString().slice(0, 10) });
  }

  async function confirmIssue() {
    if (!pendingIssue) return;
    setMessage(null);
    setError(null);
    setIsIssuing(true);
    try {
      const response = await issueStaffCertificate(pendingIssue.enrolment.enrolment_id, pendingIssue.issueDate);
      setMessage(`${response.certificate.certificate_number} issued for ${pendingIssue.enrolment.student_name}.`);
      setPendingIssue(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not issue certificate.");
    } finally {
      setIsIssuing(false);
    }
  }

  async function revoke(certificate: CertificateListItem) {
    const reason = window.prompt("Reason for revocation");
    if (!reason?.trim()) return;
    setError(null);
    try {
      await revokeStaffCertificate(certificate.id, reason.trim());
      setMessage(`${certificate.certificate_number} revoked.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke certificate.");
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    void load();
  }

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Certificates</h1>
        <p>Review completed enrolments, issue certificates, and verify issued records.</p>
      </header>
      <div className="certificate-tabs" role="tablist" aria-label="Certificate views">
        {(["eligible", "issued", "revoked"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={tab === item} onClick={() => { setTab(item); setOffset(0); }}>
            {label(item)}
          </button>
        ))}
      </div>
      <form className="staff-card staff-search-row" onSubmit={search}>
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Student ID, certificate no., course" />
        </label>
        <button type="submit">Search</button>
      </form>
      {message ? <div className="notice notice--success"><strong>{message}</strong></div> : null}
      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      {pendingIssue ? (
        <section className="staff-card certificate-confirmation" aria-label="Confirm certificate issuance">
          <div className="section-heading"><h2>Confirm issue</h2><span>Final record</span></div>
          <dl>
            <div><dt>Student</dt><dd>{pendingIssue.enrolment.student_name}</dd></div>
            <div><dt>Student ID</dt><dd>{pendingIssue.enrolment.student_number}</dd></div>
            <div><dt>Course</dt><dd>{pendingIssue.enrolment.course_name}</dd></div>
            <div><dt>Completion</dt><dd>{pendingIssue.enrolment.actual_completion_date ? formatDate(pendingIssue.enrolment.actual_completion_date) : "Completed"}</dd></div>
          </dl>
          <label>
            Issue date
            <input type="date" value={pendingIssue.issueDate} onChange={(event) => setPendingIssue({ ...pendingIssue, issueDate: event.target.value })} />
          </label>
          <div className="certificate-actions">
            <button type="button" onClick={() => void confirmIssue()} disabled={isIssuing || !pendingIssue.issueDate}>{isIssuing ? "Issuing..." : "Confirm Issue"}</button>
            <button type="button" className="secondary-button" onClick={() => setPendingIssue(null)} disabled={isIssuing}>Cancel</button>
          </div>
        </section>
      ) : null}
      {isLoading ? <LoadingState label="Loading certificates" /> : null}
      {!isLoading && tab === "eligible" ? (
        <section className="staff-card">
          <div className="section-heading"><h2>Eligible enrolments</h2><span>{eligible.length}</span></div>
          <div className="table-list">
            {eligible.map((item) => (
              <article key={item.enrolment_id} className="table-row certificate-row">
                <strong>{item.student_name}</strong>
                <span>{item.student_number} · {item.course_name}</span>
                <small>Joined {formatDate(item.joining_date)}{item.actual_completion_date ? ` · Completed ${formatDate(item.actual_completion_date)}` : ""}{item.duration_label ? ` · ${item.duration_label}` : ""}</small>
                <button type="button" onClick={() => prepareIssue(item)}>Issue Certificate</button>
              </article>
            ))}
            {!eligible.length ? <p className="staff-empty">No eligible enrolments found.</p> : null}
          </div>
        </section>
      ) : null}
      {!isLoading && tab !== "eligible" ? (
        <CertificateList certificates={certificates} canRevoke={isOwner && tab === "issued"} downloadScope="staff" onRevoke={revoke} />
      ) : null}
      <Pagination offset={offset} limit={limit} hasMore={hasMore} onOffset={setOffset} />
    </div>
  );
}

function StudentCertificates() {
  const [certificates, setCertificates] = useState<CertificateListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getStudentCertificates({ limit: 25, offset: 0 })
      .then((response) => setCertificates(response.items))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load certificates."))
      .finally(() => setIsLoading(false));
  }, []);
  if (isLoading) return <LoadingState label="Loading certificates" />;
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>My Certificates</h1>
        <p>Your issued Samyak course-completion certificates.</p>
      </header>
      {error ? <ErrorState title="Could not load certificates" message={error} /> : null}
      <CertificateList certificates={certificates} canRevoke={false} downloadScope="student" />
    </div>
  );
}

function CertificateList({ certificates, canRevoke, downloadScope, onRevoke }: { certificates: CertificateListItem[]; canRevoke: boolean; downloadScope: "staff" | "student"; onRevoke?: (certificate: CertificateListItem) => void }) {
  return (
    <section className="staff-card">
      <div className="section-heading"><h2>Certificate records</h2><span>{certificates.length}</span></div>
      <div className="table-list">
        {certificates.map((certificate) => (
          <article key={certificate.id} className="table-row certificate-row">
            <strong>{certificate.certificate_number} <span className={`status-pill status-pill--${certificate.status}`}>{certificate.status}</span></strong>
            <span>{certificate.student_name_snapshot} · {certificate.student_id_snapshot}</span>
            <small>{certificate.course_name_snapshot} · Issued {formatDate(certificate.issue_date)}{certificate.completion_date_snapshot ? ` · Completed ${formatDate(certificate.completion_date_snapshot)}` : ""}</small>
            <div className="certificate-actions">
              <a className="button-link" href={`/${downloadScope === "staff" ? "api/staff" : "api/student"}/certificates/${encodeURIComponent(certificate.id)}/pdf`}>Download</a>
              <a className="button-link" href={`/verify/${encodeURIComponent(certificate.verification_code)}`}>Verify</a>
              {canRevoke ? <button type="button" className="danger-button" onClick={() => onRevoke?.(certificate)}>Revoke</button> : null}
            </div>
          </article>
        ))}
        {!certificates.length ? <p className="staff-empty">No certificates found.</p> : null}
      </div>
    </section>
  );
}

function Pagination({ offset, limit, hasMore, onOffset }: { offset: number; limit: number; hasMore: boolean; onOffset: (offset: number) => void }) {
  return (
    <div className="certificate-pagination">
      <button type="button" className="secondary-button" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>Previous</button>
      <span>Page {Math.floor(offset / limit) + 1}</span>
      <button type="button" className="secondary-button" disabled={!hasMore} onClick={() => onOffset(offset + limit)}>Next</button>
    </div>
  );
}

function label(tab: Tab) {
  return tab[0].toUpperCase() + tab.slice(1);
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : value;
}
