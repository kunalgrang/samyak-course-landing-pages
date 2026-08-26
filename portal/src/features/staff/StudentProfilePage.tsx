import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { ApiError, changeStaffStudentPrimaryMobile, getStaffStudentProfile, replaceStaffStudentReferralLink, type SharedMobileMatch, type StaffStudentProfile } from "../../lib/api";

export function StudentProfilePage({ studentId }: { studentId: string }) {
  const [profile, setProfile] = useState<StaffStudentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralMessage, setReferralMessage] = useState<string | null>(null);

  useEffect(() => {
    void getStaffStudentProfile(studentId)
      .then(setProfile)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load student profile."));
  }, [studentId]);

  if (error) return <ErrorState title="Could not load student" message={error} />;
  if (!profile) return <LoadingState label="Loading student profile" />;
  const student = profile.student;

  async function replaceReferralLink() {
    if (!window.confirm("Replacing this referral link will deactivate the current link. Anyone using the old link will no longer be able to submit a referral. Continue?")) return;
    setReferralBusy(true);
    setReferralMessage(null);
    try {
      const replaced = await replaceStaffStudentReferralLink(studentId);
      const nextProfile = await getStaffStudentProfile(studentId);
      setProfile(nextProfile);
      setReferralMessage(replaced.created ? "Referral link replaced." : "Referral link was not replaced.");
    } catch (cause) {
      setReferralMessage(cause instanceof Error ? cause.message : "Referral link could not be replaced.");
    } finally {
      setReferralBusy(false);
    }
  }

  async function copyReferralLink(link: string) {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(link);
    setReferralMessage("Referral link copied.");
  }

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>{String(student.student_number)}</h1>
        <p>{String(student.full_name)} · DOB {String(student.date_of_birth || "Not recorded")}</p>
        {profile.canMaintainContact ? <button className="button-link" type="button" onClick={() => setEditingContact(true)}>Edit Contact</button> : null}
      </header>
      <section className="staff-card detail-grid">
        <Detail label="Permanent Student ID" value={String(student.student_number)} />
        <Detail label="Official name" value={String(student.full_name)} />
        <Detail label="DOB" value={String(student.date_of_birth || "Not recorded")} />
        <Detail label="Primary mobile" value={profile.mobileDisplay || "Protected"} />
        <Detail label="Locality" value={profile.locality ? `${String(profile.locality.locality)}, ${String(profile.locality.city)}` : "Not recorded"} />
        <Detail label="Student since" value={String(student.student_since)} />
        <Detail label="Status" value={String(student.current_status)} />
        <Detail label="Education" value={profile.education ? String(profile.education.qualification_level) : "Not recorded"} />
      </section>

      {profile.canMaintainContact && editingContact ? (
        <ContactEditPanel
          studentId={studentId}
          profile={profile}
          onCancel={() => setEditingContact(false)}
          onSaved={(nextProfile) => {
            setProfile(nextProfile);
            setEditingContact(false);
          }}
        />
      ) : null}

      <ReferralLinkPanel
        profile={profile}
        busy={referralBusy}
        message={referralMessage}
        onCopy={(link) => void copyReferralLink(link)}
        onReplace={() => void replaceReferralLink()}
      />

      {profile.canMaintainContact && profile.contactHistory.length > 0 ? (
        <section className="staff-card">
          <div className="section-heading"><h2>Contact history</h2><span>{profile.contactHistory.length}</span></div>
          {profile.contactHistory.map((contact) => (
            <article className="table-row" key={`${contact.mobileDisplay}-${contact.status}-${contact.changedAt}`}>
              <strong>{contact.mobileDisplay}</strong>
              <span>{contact.isPrimary ? "Current primary" : contact.status}</span>
              <small>Changed {contact.changedAt.slice(0, 10)}</small>
            </article>
          ))}
        </section>
      ) : null}

      <section className="staff-card">
        <div className="section-heading"><h2>Enrolments</h2><span>{profile.enrolments.length}</span></div>
        {profile.enrolments.map((enrolment) => (
          <article className="table-row" key={String(enrolment.id)}>
            <strong>{String(enrolment.enrolment_number)}</strong>
            <span>{String(enrolment.course_name)} · Joining {String(enrolment.joining_date)}</span>
            <small>Fee {formatMoney(Number(enrolment.final_agreed_fee_paise || 0))} · {String(enrolment.payment_plan_type || "No plan")} · NSDC {String(enrolment.nsdc_status || "Not requested")}</small>
            {enrolment.final_agreed_fee_paise ? <a className="button-link" href={`/app/enrolments/${String(enrolment.id)}/payments`}>Payments</a> : null}
          </article>
        ))}
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Enquiry history</h2><span>{profile.enquiries.length}</span></div>
        {profile.enquiries.map((enquiry) => (
          <article className="table-row" key={String(enquiry.id)}>
            <strong>{String(enquiry.enquiry_number)}</strong>
            <span>{String(enquiry.status)}</span>
            <a href={`/app/enquiries/${String(enquiry.id)}`}>Open enquiry</a>
          </article>
        ))}
      </section>
    </div>
  );
}

function ReferralLinkPanel({
  profile,
  busy,
  message,
  onCopy,
  onReplace,
}: {
  profile: StaffStudentProfile;
  busy: boolean;
  message: string | null;
  onCopy: (link: string) => void;
  onReplace: () => void;
}) {
  const link = profile.referralLink;
  if (!link) return null;
  return (
    <section className="staff-card">
      <div className="section-heading"><h2>Referral Link</h2>{link.lastFour ? <span>...{link.lastFour}</span> : null}</div>
      {link.publicUrl ? (
        <div className="confirmation-box">
          <small>Your Referral Link</small>
          <strong>{link.publicUrl}</strong>
          <small>Activated</small>
          <strong>{link.activatedAt ? link.activatedAt.slice(0, 10) : "Active"}</strong>
        </div>
      ) : (
        <p>{link.message}</p>
      )}
      <div className="form-actions">
        {link.publicUrl ? <button type="button" onClick={() => onCopy(link.publicUrl || "")}>Copy Link</button> : null}
        {link.publicUrl ? <a className="button-link" href={link.publicUrl} target="_blank" rel="noreferrer">Open Link</a> : null}
        {profile.canReplaceReferralLink && link.hasActiveLink ? (
          <button type="button" className="button-secondary" disabled={busy} onClick={onReplace}>{busy ? "Replacing..." : "Replace Referral Link"}</button>
        ) : null}
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

export function ContactEditPanel({
  studentId,
  profile,
  onCancel,
  onSaved,
}: {
  studentId: string;
  profile: StaffStudentProfile;
  onCancel: () => void;
  onSaved: (profile: StaffStudentProfile) => void;
}) {
  const [newMobile, setNewMobile] = useState("");
  const [reason, setReason] = useState("Student changed number");
  const [sharedMatches, setSharedMatches] = useState<SharedMobileMatch[]>([]);
  const [confirmSharedMobile, setConfirmSharedMobile] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const oldMobile = profile.mobileDisplay || "Protected";
  const newMobilePreview = maskSubmittedMobile(newMobile);
  const canSubmit = newMobile.trim().length > 0 && confirmChange && (!sharedMatches.length || confirmSharedMobile) && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setMessage(null);
    try {
      if (!profile.contactVersion) {
        setMessage("Refresh the profile before changing contact details.");
        return;
      }
      await changeStaffStudentPrimaryMobile(studentId, { newMobile, reason, confirmSharedMobile, expectedContactVersion: profile.contactVersion });
      const nextProfile = await getStaffStudentProfile(studentId);
      onSaved(nextProfile);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "shared_mobile_confirmation_required") {
        setSharedMatches(parseSharedMatches(cause.details?.sharedMobileMatches));
        setMessage(cause.message);
      } else {
        setMessage(cause instanceof Error ? cause.message : "Mobile could not be updated.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="staff-card contact-edit-panel">
      <div className="section-heading"><h2>Change primary mobile</h2><span>{String(profile.student.student_number)}</span></div>
      <label>
        <small>New primary mobile</small>
        <input value={newMobile} onChange={(event) => setNewMobile(event.target.value)} placeholder="98765 43210" inputMode="tel" />
      </label>
      <label>
        <small>Reason</small>
        <select value={reason} onChange={(event) => setReason(event.target.value)}>
          <option>Student changed number</option>
          <option>Correction of wrong number</option>
          <option>Parent/guardian number replaced</option>
          <option>Other</option>
        </select>
      </label>
      <div className="confirmation-box">
        <small>Old</small><strong>{oldMobile}</strong>
        <small>New</small><strong>{newMobilePreview}</strong>
      </div>
      {sharedMatches.length > 0 ? (
        <div className="warning-box">
          <strong>This mobile is already used by another student/person.</strong>
          <p>Shared family numbers are allowed. Confirm that this is intentional.</p>
          {sharedMatches.map((match) => (
            <small key={match.personId}>{match.displayName} {match.studentNumber ? `· ${match.studentNumber}` : ""} {match.status ? `· ${match.status}` : ""}</small>
          ))}
          <label className="check-row">
            <input type="checkbox" checked={confirmSharedMobile} onChange={(event) => setConfirmSharedMobile(event.target.checked)} />
            <span>Confirm shared mobile use</span>
          </label>
        </div>
      ) : null}
      <label className="check-row">
        <input type="checkbox" checked={confirmChange} onChange={(event) => setConfirmChange(event.target.checked)} />
        <span>Confirm this contact change is intentional</span>
      </label>
      {message ? <p className="form-message">{message}</p> : null}
      <div className="form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={!canSubmit}>{saving ? "Saving..." : "Confirm Change"}</button>
      </div>
    </section>
  );
}

function parseSharedMatches(value: unknown): SharedMobileMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SharedMobileMatch => Boolean(item && typeof item === "object" && "personId" in item && "displayName" in item));
}

function maskSubmittedMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  const lastFour = digits.slice(-4);
  return lastFour ? `******${lastFour}` : "******";
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
