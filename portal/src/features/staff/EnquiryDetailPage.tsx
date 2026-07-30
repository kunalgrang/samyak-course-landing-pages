import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getEnquiryDetail, updateEnquiryStatus, type EnquiryDetail } from "../../lib/api";

export function EnquiryDetailPage({ enquiryId }: { enquiryId: string }) {
  const [detail, setDetail] = useState<EnquiryDetail | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void getEnquiryDetail(enquiryId)
      .then((data) => {
        setDetail(data);
        setStatus(String(data.enquiry.status || ""));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load enquiry."))
      .finally(() => setIsLoading(false));
  }, [enquiryId]);

  async function saveStatus() {
    try {
      await updateEnquiryStatus(enquiryId, status);
      setDetail(await getEnquiryDetail(enquiryId));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update enquiry.");
    }
  }

  if (isLoading) return <LoadingState label="Loading enquiry" />;
  if (!detail) return <ErrorState title="Could not load enquiry" message={error || "Please try again."} />;
  const enquiry = detail.enquiry;
  const converted = enquiry.status === "converted" || Boolean(enquiry.converted_enrolment_id);

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>{String(enquiry.enquiry_number)}</h1>
        <p>{String(enquiry.full_name || "Person not recorded")} · {detail.mobileDisplay || "Mobile protected"}</p>
      </header>
      {error ? <ErrorState title="Could not continue" message={error} /> : null}

      <section className="staff-card detail-grid">
        <Detail label="Course interest" value={String(enquiry.course_name || enquiry.course_interest_text || "Not mapped")} />
        <Detail label="Source" value={String(enquiry.source || "")} />
        <Detail label="Source details" value={String(enquiry.source_detail || "Not recorded")} />
        <Detail label="Preferred timing" value={String(enquiry.preferred_timing || "Not recorded")} />
        <Detail label="Preferred joining" value={String(enquiry.preferred_joining_date || "Not recorded")} />
        <Detail label="Created" value={formatDate(String(enquiry.created_at || ""))} />
        <Detail label="Conversion" value={converted ? "Converted" : "Not converted"} />
        <Detail label="Student ID" value={String(enquiry.student_number || "Not generated")} />
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Actions</h2></div>
        <div className="action-row">
          <label>
            Enquiry status
            <select value={status} disabled={converted} onChange={(event) => setStatus(event.target.value)}>
              {["new", "attempted_contact", "contacted", "follow_up", "counselling_completed", "demo_scheduled", "interested", "admission_pending", "not_interested", "lost", "duplicate", "invalid"].map((item) => (
                <option key={item} value={item}>{formatLabel(item)}</option>
              ))}
            </select>
          </label>
          <button type="button" disabled={converted} onClick={() => void saveStatus()}>Save status</button>
          {converted && enquiry.student_id ? <a className="button-link" href={`/app/students/${String(enquiry.student_id)}`}>Open student profile</a> : null}
          {!converted ? <a className="button-link" href={`/app/enquiries/${enquiryId}/admission`}>{detail.activeDraft ? "Continue admission draft" : "Start admission"}</a> : null}
        </div>
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Previous enrolments</h2><span>{detail.previousEnrolments.length}</span></div>
        {detail.previousEnrolments.length ? detail.previousEnrolments.map((enrolment) => (
          <article className="table-row" key={String(enrolment.id)}>
            <strong>{String(enrolment.enrolment_number)}</strong>
            <span>{String(enrolment.course_name)}</span>
            <small>{String(enrolment.status)} · Joining {String(enrolment.joining_date)}</small>
          </article>
        )) : <p className="staff-empty">No previous enrolments.</p>}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}
