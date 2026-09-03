import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useAuth } from "../auth/AuthContext";
import {
  approveStaffCertificateApplication,
  getEligibleCertificates,
  getPublicConfig,
  getStaffCertificateApplication,
  getStaffCertificateApplications,
  getStaffCertificates,
  getStudentCertificates,
  issueStaffCertificate,
  markStaffCertificateApplicationNeedsAttention,
  revokeStaffCertificate,
  submitStudentCertificateApplication,
  type CertificateListItem,
  type EligibleCertificate,
  type StaffCertificateApplicationDetail,
  type StaffCertificateApplicationItem,
  type StudentCertificateApplicationItem,
} from "../../lib/api";

type Tab = "applications" | "eligible" | "issued" | "revoked";

const staffRoles = new Set(["owner", "admin", "system_admin", "counsellor", "admission_admin"]);
const ownerRoles = new Set(["owner"]);
const reviewerRoles = new Set(["owner", "admin", "system_admin", "admission_admin"]);
const feedbackQuestions = [
  { key: "feedbackTrainerClarityScore", label: "How clearly did your trainer explain the concepts?" },
  { key: "feedbackPracticalLearningScore", label: "How useful were the practical exercises/examples?" },
  { key: "feedbackCourseExpectationScore", label: "How well did the course match what was explained to you at admission?" },
  { key: "feedbackOverallScore", label: "Overall, how would you rate your learning experience at Samyak?" },
] as const;

type FeedbackKey = (typeof feedbackQuestions)[number]["key"];
type FeedbackState = Record<FeedbackKey, number>;

export function CertificatesPage() {
  const { session } = useAuth();
  const roles = session?.accountRoles || [];
  const isStaff = roles.some((role) => staffRoles.has(role));
  const isOwner = roles.some((role) => ownerRoles.has(role));
  const canReviewApplications = roles.some((role) => reviewerRoles.has(role));
  return isStaff ? <StaffCertificates isOwner={isOwner} canReviewApplications={canReviewApplications} /> : <StudentCertificates />;
}

function StaffCertificates({ isOwner, canReviewApplications }: { isOwner: boolean; canReviewApplications: boolean }) {
  const [tab, setTab] = useState<Tab>(canReviewApplications ? "applications" : "eligible");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [eligible, setEligible] = useState<EligibleCertificate[]>([]);
  const [certificates, setCertificates] = useState<CertificateListItem[]>([]);
  const [applications, setApplications] = useState<StaffCertificateApplicationItem[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<StaffCertificateApplicationDetail | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIssue, setPendingIssue] = useState<{ enrolment: EligibleCertificate; issueDate: string } | null>(null);
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().slice(0, 10));
  const [attentionNote, setAttentionNote] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const limit = 25;

  useEffect(() => {
    void load();
  }, [tab, offset]);

  useEffect(() => {
    if (!selectedApplicationId) {
      setSelectedApplication(null);
      return;
    }
    setIsDetailLoading(true);
    void getStaffCertificateApplication(selectedApplicationId)
      .then((application) => {
        setSelectedApplication(application);
        setCompletionDate((application.completion_date || application.actual_completion_date || new Date().toISOString()).slice(0, 10));
        setAttentionNote(application.decision_note || "");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load application."))
      .finally(() => setIsDetailLoading(false));
  }, [selectedApplicationId]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const params = { q: query.trim() || undefined, limit, offset };
      if (tab === "applications") {
        const response = await getStaffCertificateApplications(params);
        setApplications(response.items);
        setEligible([]);
        setCertificates([]);
        setHasMore(response.pagination.hasMore);
      } else if (tab === "eligible") {
        const response = await getEligibleCertificates(params);
        setEligible(response.items);
        setApplications([]);
        setCertificates([]);
        setHasMore(response.pagination.hasMore);
      } else {
        const response = await getStaffCertificates({ ...params, status: tab });
        setCertificates(response.items);
        setApplications([]);
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
    setIsMutating(true);
    try {
      const response = await issueStaffCertificate(pendingIssue.enrolment.enrolment_id, pendingIssue.issueDate);
      setMessage(`${response.certificate.certificate_number} issued for ${pendingIssue.enrolment.student_name}.`);
      setPendingIssue(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not issue certificate.");
    } finally {
      setIsMutating(false);
    }
  }

  async function approveApplication() {
    if (!selectedApplication) return;
    setMessage(null);
    setError(null);
    setIsMutating(true);
    try {
      await approveStaffCertificateApplication(selectedApplication.id, completionDate);
      setMessage(`Course completion approved for ${selectedApplication.student_name}.`);
      await load();
      setSelectedApplication(await getStaffCertificateApplication(selectedApplication.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not approve completion.");
    } finally {
      setIsMutating(false);
    }
  }

  async function needsAttention() {
    if (!selectedApplication) return;
    setMessage(null);
    setError(null);
    setIsMutating(true);
    try {
      await markStaffCertificateApplicationNeedsAttention(selectedApplication.id, attentionNote);
      setMessage(`Application marked needs attention for ${selectedApplication.student_name}.`);
      await load();
      setSelectedApplication(await getStaffCertificateApplication(selectedApplication.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update application.");
    } finally {
      setIsMutating(false);
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

  const tabs: Tab[] = canReviewApplications ? ["applications", "eligible", "issued", "revoked"] : ["eligible", "issued", "revoked"];

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Certificates</h1>
        <p>Review applications, approve course completion, and issue certificates explicitly.</p>
      </header>
      <div className="certificate-tabs" role="tablist" aria-label="Certificate views">
        {tabs.map((item) => (
          <button key={item} type="button" aria-pressed={tab === item} onClick={() => { setTab(item); setOffset(0); setSelectedApplicationId(null); }}>
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
            <button type="button" onClick={() => void confirmIssue()} disabled={isMutating || !pendingIssue.issueDate}>{isMutating ? "Issuing..." : "Confirm Issue"}</button>
            <button type="button" className="secondary-button" onClick={() => setPendingIssue(null)} disabled={isMutating}>Cancel</button>
          </div>
        </section>
      ) : null}
      {isLoading ? <LoadingState label="Loading certificates" /> : null}
      {!isLoading && tab === "applications" ? (
        <ApplicationQueue
          applications={applications}
          selectedApplicationId={selectedApplicationId}
          selectedApplication={selectedApplication}
          isDetailLoading={isDetailLoading}
          completionDate={completionDate}
          attentionNote={attentionNote}
          isMutating={isMutating}
          onSelect={setSelectedApplicationId}
          onCompletionDate={setCompletionDate}
          onAttentionNote={setAttentionNote}
          onApprove={() => void approveApplication()}
          onNeedsAttention={() => void needsAttention()}
        />
      ) : null}
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
      {!isLoading && tab !== "eligible" && tab !== "applications" ? (
        <CertificateList certificates={certificates} canRevoke={isOwner && tab === "issued"} downloadScope="staff" onRevoke={revoke} />
      ) : null}
      <Pagination offset={offset} limit={limit} hasMore={hasMore} onOffset={setOffset} />
    </div>
  );
}

function ApplicationQueue({
  applications,
  selectedApplicationId,
  selectedApplication,
  isDetailLoading,
  completionDate,
  attentionNote,
  isMutating,
  onSelect,
  onCompletionDate,
  onAttentionNote,
  onApprove,
  onNeedsAttention,
}: {
  applications: StaffCertificateApplicationItem[];
  selectedApplicationId: string | null;
  selectedApplication: StaffCertificateApplicationDetail | null;
  isDetailLoading: boolean;
  completionDate: string;
  attentionNote: string;
  isMutating: boolean;
  onSelect: (id: string | null) => void;
  onCompletionDate: (date: string) => void;
  onAttentionNote: (note: string) => void;
  onApprove: () => void;
  onNeedsAttention: () => void;
}) {
  return (
    <section className="staff-card certificate-applications">
      <div className="section-heading"><h2>Applications</h2><span>{applications.length}</span></div>
      <div className="certificate-application-grid">
        <div className="table-list">
          {applications.map((application) => (
            <button
              key={application.id}
              type="button"
              className={selectedApplicationId === application.id ? "table-row table-row--selected certificate-application-row" : "table-row certificate-application-row"}
              onClick={() => onSelect(application.id)}
            >
              <strong>{application.student_name}</strong>
              <span>{application.student_number} · {application.course_name}</span>
              <small>Applied {formatDate(application.applied_at)} · {applicationStatusLabel(application.status)}</small>
              <span className="certificate-badge-row">
                <span className={`status-pill status-pill--${application.status}`}>{applicationStatusLabel(application.status)}</span>
                {Boolean(application.low_feedback_flag) ? <span className="status-pill status-pill--warning">Low Feedback</span> : null}
              </span>
            </button>
          ))}
          {!applications.length ? <p className="staff-empty">No certificate applications found.</p> : null}
        </div>
        <aside className="certificate-application-detail">
          {isDetailLoading ? <LoadingState label="Loading application" /> : null}
          {!isDetailLoading && !selectedApplication ? <p className="staff-empty">Select an application to review details and approve course completion.</p> : null}
          {!isDetailLoading && selectedApplication ? (
            <>
              <div className="section-heading">
                <h2>{selectedApplication.student_name}</h2>
                <span className={`status-pill status-pill--${selectedApplication.status}`}>{applicationStatusLabel(selectedApplication.status)}</span>
              </div>
              {Boolean(selectedApplication.low_feedback_flag) ? <div className="warning-box"><strong>Low feedback</strong><p>Review before course completion approval.</p></div> : null}
              <dl className="certificate-detail-list">
                <div><dt>Student ID</dt><dd>{selectedApplication.student_number}</dd></div>
                <div><dt>Course</dt><dd>{selectedApplication.course_name}</dd></div>
                <div><dt>Enrolment</dt><dd>{selectedApplication.enrolment_number}</dd></div>
                <div><dt>Current status</dt><dd>{selectedApplication.enrolment_status}</dd></div>
                <div><dt>Joining date</dt><dd>{formatDate(selectedApplication.joining_date)}</dd></div>
                <div><dt>Batch</dt><dd>{selectedApplication.batch_name || "Not assigned"}</dd></div>
                <div><dt>Applied</dt><dd>{formatDate(selectedApplication.applied_at)}</dd></div>
              </dl>
              <div className="confirmation-box">
                <strong>Student confirmations</strong>
                <p>{truthy(selectedApplication.student_completion_confirmed) ? "Course completion confirmed" : "Course completion not confirmed"}</p>
                <p>{truthy(selectedApplication.certificate_details_confirmed) ? "Certificate details confirmed" : "Certificate details not confirmed"}</p>
              </div>
              <dl className="certificate-feedback-list">
                <div><dt>Trainer clarity</dt><dd>{selectedApplication.feedback_trainer_clarity_score}/5</dd></div>
                <div><dt>Practical usefulness</dt><dd>{selectedApplication.feedback_practical_learning_score}/5</dd></div>
                <div><dt>Expectation match</dt><dd>{selectedApplication.feedback_course_expectation_score}/5</dd></div>
                <div><dt>Overall experience</dt><dd>{selectedApplication.feedback_overall_score}/5</dd></div>
              </dl>
              <div className="confirmation-box">
                <strong>Improvement comment</strong>
                <p>{selectedApplication.feedback_improvement_text || "No comment shared."}</p>
              </div>
              <label>
                Actual completion date
                <input type="date" value={completionDate} onChange={(event) => onCompletionDate(event.target.value)} />
              </label>
              <label>
                Decision note
                <textarea value={attentionNote} onChange={(event) => onAttentionNote(event.target.value)} maxLength={500} />
              </label>
              <div className="certificate-actions">
                <button type="button" onClick={onApprove} disabled={isMutating || !completionDate || selectedApplication.status === "certificate_issued"}>Approve Course Completion</button>
                <button type="button" className="secondary-button" onClick={onNeedsAttention} disabled={isMutating || selectedApplication.status === "certificate_issued"}>Needs Attention</button>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function StudentCertificates() {
  const [items, setItems] = useState<StudentCertificateApplicationItem[]>([]);
  const [certificates, setCertificates] = useState<CertificateListItem[]>([]);
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successApplicationId, setSuccessApplicationId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const [page, config] = await Promise.all([getStudentCertificates({ limit: 25, offset: 0 }), getPublicConfig()]);
      setItems(page.applications.items);
      setCertificates(page.certificates.items);
      setGoogleReviewUrl(config.googleReviewUrl);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load certificates.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (isLoading) return <LoadingState label="Loading certificates" />;
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>My Certificates</h1>
        <p>Apply after completing a course, then download issued certificates here.</p>
      </header>
      {error ? <ErrorState title="Could not load certificates" message={error} /> : null}
      {successApplicationId ? <ApplicationSuccess applicationId={successApplicationId} items={items} googleReviewUrl={googleReviewUrl} onSkip={() => setSuccessApplicationId(null)} /> : null}
      <section className="staff-card student-certificate-applications">
        <div className="section-heading"><h2>Courses</h2><span>{items.length}</span></div>
        <div className="table-list">
          {items.map((item) => (
            <StudentApplicationCard key={item.enrolment.enrolment_id} item={item} onSubmitted={(applicationId) => { setSuccessApplicationId(applicationId); void load(); }} />
          ))}
          {!items.length ? <p className="staff-empty">No course enrolments found.</p> : null}
        </div>
      </section>
      {certificates.length ? <CertificateList certificates={certificates} canRevoke={false} downloadScope="student" /> : null}
    </div>
  );
}

function StudentApplicationCard({ item, onSubmitted }: { item: StudentCertificateApplicationItem; onSubmitted: (applicationId: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({
    feedbackTrainerClarityScore: 0,
    feedbackPracticalLearningScore: 0,
    feedbackCourseExpectationScore: 0,
    feedbackOverallScore: 0,
  });
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const certificate = item.certificate;
  const application = item.application;
  const canApply = item.applicationEligibility.eligible && !certificate && !application;
  const ready = completionConfirmed && detailsConfirmed && Object.values(feedback).every((score) => score >= 1 && score <= 5);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await submitStudentCertificateApplication({
        enrolmentId: item.enrolment.enrolment_id,
        studentCompletionConfirmed: completionConfirmed,
        certificateDetailsConfirmed: detailsConfirmed,
        ...feedback,
        feedbackImprovementText: comment.trim() || undefined,
      });
      onSubmitted(response.application.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit application.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="table-row certificate-row student-certificate-card">
      <div className="section-heading">
        <div>
          <strong>{item.enrolment.course_name}</strong>
          <small>{item.enrolment.enrolment_number} · Joined {formatDate(item.enrolment.joining_date)}</small>
        </div>
        <span className={`status-pill status-pill--${stateKind(item)}`}>{studentStateLabel(item)}</span>
      </div>
      {item.enrolment.batch_name ? <small>Current Batch: {item.enrolment.batch_name}</small> : null}
      {certificate ? (
        <div className="certificate-actions">
          <a className="button-link button-link--primary" href={`/api/student/certificates/${encodeURIComponent(certificate.id)}/pdf`}>View Certificate</a>
          {certificate.verification_code ? <a className="button-link" href={`https://go.samyaksion.com/verify/${encodeURIComponent(certificate.verification_code)}`}>Verify</a> : null}
        </div>
      ) : null}
      {!certificate && application ? <p className="form-message">{studentApplicationMessage(application.status || "submitted")}</p> : null}
      {canApply ? (
        <>
          {!isOpen ? <button type="button" onClick={() => setIsOpen(true)}>Apply for Certificate</button> : null}
          {isOpen ? (
            <form className="certificate-application-form" onSubmit={submit}>
              <div className="confirmation-box">
                <strong>Certificate Details</strong>
                <DetailLine label="Name" value={item.enrolment.student_name} />
                <DetailLine label="Student ID" value={item.enrolment.student_number} />
                <DetailLine label="Course" value={item.enrolment.course_name} />
                <DetailLine label="Joining Date" value={formatDate(item.enrolment.joining_date)} />
                <DetailLine label="Completion Date" value="To be confirmed by Samyak" />
              </div>
              <div className="warning-box">
                <strong>Please check your name and course details carefully before applying.</strong>
                <p>Please contact Samyak before submitting your certificate application if anything is wrong.</p>
                <a className="button-link" href="mailto:info@samyaksion.com">Email Samyak</a>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={completionConfirmed} onChange={(event) => setCompletionConfirmed(event.target.checked)} />
                <span>I confirm that I have completed the course shown above and that the training was delivered as per the course offered to me.</span>
              </label>
              <label className="check-row">
                <input type="checkbox" checked={detailsConfirmed} onChange={(event) => setDetailsConfirmed(event.target.checked)} />
                <span>I have reviewed my name and course details shown above and confirm that they are correct.</span>
              </label>
              <div className="certificate-feedback">
                <strong>Your feedback is shared privately with Samyak and helps us improve our courses.</strong>
                {feedbackQuestions.map((question) => (
                  <fieldset key={question.key} className="feedback-question">
                    <legend>{question.label}</legend>
                    <div className="feedback-scale" aria-label={question.label}>
                      {[1, 2, 3, 4, 5].map((score) => (
                        <label key={score}>
                          <input type="radio" name={`${item.enrolment.enrolment_id}-${question.key}`} value={score} checked={feedback[question.key] === score} onChange={() => setFeedback((current) => ({ ...current, [question.key]: score }))} />
                          <span>{score}</span>
                        </label>
                      ))}
                    </div>
                    <div className="feedback-scale-labels"><span>Poor</span><span>Excellent</span></div>
                  </fieldset>
                ))}
              </div>
              <label>
                What could we improve?
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} />
              </label>
              {error ? <div className="notice notice--error"><strong>{error}</strong></div> : null}
              <div className="certificate-actions">
                <button type="submit" disabled={!ready || isSubmitting}>{isSubmitting ? "Submitting..." : "Apply for Certificate"}</button>
                <button type="button" className="secondary-button" onClick={() => setIsOpen(false)} disabled={isSubmitting}>Cancel</button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
      {!certificate && !application && !canApply ? <p className="form-message">{ineligibleMessage(item.applicationEligibility.reasons)}</p> : null}
    </article>
  );
}

function ApplicationSuccess({ applicationId, items, googleReviewUrl, onSkip }: { applicationId: string; items: StudentCertificateApplicationItem[]; googleReviewUrl: string; onSkip: () => void }) {
  const item = items.find((candidate) => candidate.application?.id === applicationId);
  return (
    <section className="staff-card certificate-success-card">
      <div className="section-heading"><h2>Application received</h2><span>{item?.application?.status ? applicationStatusLabel(item.application.status) : "Submitted"}</span></div>
      <p>Thank you for your feedback.</p>
      {item ? <p>{item.enrolment.course_name} · Applied {formatDate(item.application?.applied_at || new Date().toISOString())}</p> : null}
      {googleReviewUrl ? (
        <div className="certificate-actions">
          <a className="button-link button-link--primary" href={googleReviewUrl} target="_blank" rel="noopener noreferrer">Leave a Google Review</a>
          <button type="button" className="secondary-button" onClick={onSkip}>Skip for now</button>
        </div>
      ) : (
        <button type="button" className="secondary-button" onClick={onSkip}>Done</button>
      )}
    </section>
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
              <a className="button-link" href={`https://go.samyaksion.com/verify/${encodeURIComponent(certificate.verification_code)}`}>Verify</a>
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

function DetailLine({ label, value }: { label: string; value: string }) {
  return <p><span>{label}: </span><strong>{value}</strong></p>;
}

function label(tab: Tab) {
  if (tab === "applications") return "Applications";
  return tab[0].toUpperCase() + tab.slice(1);
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : value;
}

function applicationStatusLabel(status: string) {
  if (status === "submitted") return "Application received";
  if (status === "approved") return "Course completion approved";
  if (status === "certificate_issued") return "Certificate issued";
  if (status === "needs_attention") return "Needs attention";
  return status.replace(/_/g, " ");
}

function studentStateLabel(item: StudentCertificateApplicationItem) {
  if (item.certificate) return "Certificate issued";
  if (item.application?.status === "approved") return "Certificate being processed";
  if (item.application?.status === "needs_attention") return "Contact Samyak";
  if (item.application?.status === "submitted") return "Application received";
  return item.applicationEligibility.eligible ? "Not applied" : item.enrolment.status.replace(/_/g, " ");
}

function studentApplicationMessage(status: string) {
  if (status === "needs_attention") return "Action required - please contact Samyak.";
  if (status === "approved") return "Course completion approved - certificate is being processed.";
  if (status === "certificate_issued") return "Certificate issued.";
  return "Application received.";
}

function stateKind(item: StudentCertificateApplicationItem) {
  if (item.certificate || item.application?.status === "certificate_issued") return "issued";
  if (item.application?.status === "needs_attention") return "warning";
  if (item.application?.status === "approved") return "approved";
  if (item.application?.status === "submitted") return "submitted";
  return "other";
}

function ineligibleMessage(reasons: string[]) {
  if (reasons.includes("certificate_already_issued")) return "Certificate already issued.";
  if (reasons.some((reason) => reason.startsWith("enrolment_completed"))) return "Course completion is already approved. Certificate is being processed.";
  if (reasons.some((reason) => reason.startsWith("enrolment_"))) return "Certificate application is available once your course is active and completed from your side.";
  if (reasons.includes("course_inactive")) return "Please contact Samyak about this course record.";
  return "Please contact Samyak before applying for this certificate.";
}

function truthy(value: unknown) {
  return value === true || value === 1;
}
