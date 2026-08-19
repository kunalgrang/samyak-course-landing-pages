import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { NotificationToast, nextNotification, type AppNotification } from "../../components/NotificationToast";
import { assignEnquiry, getCrmEnquiryDetail, getEnquiryDetail, updateEnquiryStatus, type CrmEnquiryDetail, type EnquiryDetail } from "../../lib/api";

export function EnquiryDetailPage({ enquiryId }: { enquiryId: string }) {
  const [detail, setDetail] = useState<EnquiryDetail | null>(null);
  const [crmDetail, setCrmDetail] = useState<CrmEnquiryDetail | null>(null);
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAssignee, setIsSavingAssignee] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [notification, setNotification] = useState<AppNotification | null>(null);

  useEffect(() => {
    void Promise.all([getEnquiryDetail(enquiryId), getCrmEnquiryDetail(enquiryId)])
      .then(([data, crm]) => {
        setDetail(data);
        setCrmDetail(crm);
        setStatus(String(data.enquiry.status || ""));
        setAssignee(crm.crm.assignedCounsellorLoginAccountId || "");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load enquiry."))
      .finally(() => setIsLoading(false));
  }, [enquiryId]);

  async function saveStatus() {
    if (isSavingStatus) return;
    setIsSavingStatus(true);
    try {
      await updateEnquiryStatus(enquiryId, status);
      const [nextDetail, nextCrm] = await Promise.all([getEnquiryDetail(enquiryId), getCrmEnquiryDetail(enquiryId)]);
      setDetail(nextDetail);
      setCrmDetail(nextCrm);
      setError(null);
      showNotification("success", "Enquiry updated.");
    } catch (reason) {
      showNotification("error", "Could not update enquiry. Please try again.");
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function saveAssignee() {
    if (isSavingAssignee) return;
    setIsSavingAssignee(true);
    try {
      await assignEnquiry(enquiryId, assignee || null);
      const nextCrm = await getCrmEnquiryDetail(enquiryId);
      setCrmDetail(nextCrm);
      setAssignee(nextCrm.crm.assignedCounsellorLoginAccountId || "");
      setError(null);
      showNotification("success", assignee ? `Assigned to ${assigneeLabel(nextCrm, assignee)}.` : "Assignment updated.");
    } catch (reason) {
      showNotification("error", "Could not update assignment. Please try again.");
    } finally {
      setIsSavingAssignee(false);
    }
  }

  function showNotification(kind: "success" | "error", message: string) {
    setNotification((current) => nextNotification(kind, message, current));
  }

  if (isLoading) return <LoadingState label="Loading enquiry" />;
  if (!detail) return <ErrorState title="Could not load enquiry" message={error || "Please try again."} />;
  const enquiry = detail.enquiry;
  const converted = enquiry.status === "converted" || Boolean(enquiry.converted_enrolment_id);

  return (
    <div className="content-stack staff-enquiries-page">
      <NotificationToast notification={notification} onDismiss={() => setNotification(null)} />
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

      {crmDetail ? (
        <section className="staff-card crm-detail-card">
          <div className="section-heading"><h2>CRM state</h2></div>
          <div className="detail-grid">
            <Detail label="Pipeline" value={formatLabel(crmDetail.crm.pipelineStage)} />
            <Detail label="Lead temperature" value={temperatureLabel(crmDetail.crm.leadTemperature)} />
            <Detail label="Why" value={crmDetail.crm.leadTemperatureReason} />
            <Detail label="Mobile" value={crmDetail.crm.contact.mobileDisplay || "Contact number unavailable"} />
            <Detail label="Next follow-up" value={formatDateTime(crmDetail.crm.nextFollowUpAt)} />
            <Detail label="Expected joining" value={crmDetail.crm.expectedJoiningDate || "Not recorded"} />
            <Detail label="Last contacted" value={formatDateTime(crmDetail.crm.lastContactedAt)} />
          </div>
          <StaffCrmContactPanel contact={crmDetail.crm.contact} />
          <div className="action-row crm-detail-actions">
            <label>
              Assigned counsellor
              <select value={assignee} disabled={converted || isSavingAssignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Unassigned</option>
                {crmDetail.assignees.map((staff) => <option key={staff.id} value={staff.id}>{staff.label}</option>)}
              </select>
            </label>
            <button type="button" disabled={converted || isSavingAssignee} onClick={() => void saveAssignee()}>{isSavingAssignee ? "Saving..." : "Save assignment"}</button>
            {crmDetail.crm.referral ? <a className="button-link" href={`/app/referral-operations/${crmDetail.crm.referral.id}`}>Open referral</a> : null}
          </div>
        </section>
      ) : null}

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
          <button type="button" disabled={converted || isSavingStatus} onClick={() => void saveStatus()}>{isSavingStatus ? "Saving..." : "Save status"}</button>
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

      {crmDetail ? (
        <section className="staff-card">
          <div className="section-heading"><h2>Follow-up timeline</h2><span>{crmDetail.timeline.length}</span></div>
          {crmDetail.timeline.length ? crmDetail.timeline.map((event) => (
            <article className="table-row" key={event.id}>
              <strong>{formatLabel(event.outcome)}</strong>
              <span>{formatLabel(event.channel)} · {formatDateTime(event.occurredAt)}</span>
              <small>{event.note || "No note"} · Next {formatDateTime(event.nextFollowUpAtSnapshot)}</small>
            </article>
          )) : <p className="staff-empty">No follow-ups logged yet.</p>}
        </section>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

export function StaffCrmContactPanel({ contact }: { contact: CrmEnquiryDetail["crm"]["contact"] }) {
  return (
    <div className="crm-contact-panel">
      <strong>Prospect Contact</strong>
      <span>Mobile: {contact.mobileDisplay || "Contact number unavailable"}</span>
      <div className="crm-actions">
        {contact.whatsappUrl ? <a className="contact-action contact-action--whatsapp" href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
        {contact.callUrl ? <a className="contact-action" href={contact.callUrl}>Call</a> : null}
      </div>
    </div>
  );
}

function assigneeLabel(crmDetail: CrmEnquiryDetail, assigneeId: string) {
  return crmDetail.assignees.find((staff) => staff.id === assigneeId)?.label || "selected staff";
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function temperatureLabel(value: string | null) {
  if (!value) return "Inactive";
  return value === "hot_urgent" ? "HOT URGENT" : value.toUpperCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}

function formatDateTime(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
