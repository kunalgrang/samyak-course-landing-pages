import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getStaffStudentProfile, type StaffStudentProfile } from "../../lib/api";

export function StudentProfilePage({ studentId }: { studentId: string }) {
  const [profile, setProfile] = useState<StaffStudentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStaffStudentProfile(studentId)
      .then(setProfile)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load student profile."));
  }, [studentId]);

  if (error) return <ErrorState title="Could not load student" message={error} />;
  if (!profile) return <LoadingState label="Loading student profile" />;
  const student = profile.student;

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>{String(student.student_number)}</h1>
        <p>{String(student.full_name)} · DOB {String(student.date_of_birth || "Not recorded")}</p>
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

      <section className="staff-card">
        <div className="section-heading"><h2>Enrolments</h2><span>{profile.enrolments.length}</span></div>
        {profile.enrolments.map((enrolment) => (
          <article className="table-row" key={String(enrolment.id)}>
            <strong>{String(enrolment.enrolment_number)}</strong>
            <span>{String(enrolment.course_name)} · Joining {String(enrolment.joining_date)}</span>
            <small>Fee {formatMoney(Number(enrolment.final_agreed_fee_paise || 0))} · {String(enrolment.payment_plan_type || "No plan")} · NSDC {String(enrolment.nsdc_status || "Not requested")}</small>
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

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
