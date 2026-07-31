import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  confirmAdmission,
  getAdmissionDraft,
  getEnquiryDetail,
  getActiveCourses,
  saveAdmissionDraft,
  type AdmissionConfirmation,
  type EnquiryDetail,
  type StaffCourse,
} from "../../lib/api";

export type AdmissionPayload = {
  identity: Record<string, string | boolean>;
  contact: Record<string, string | boolean>;
  locality: Record<string, string>;
  education: Record<string, string | boolean | number | null>;
  course: Record<string, string | boolean>;
  fee: Record<string, string | number>;
  declarations: Record<string, boolean>;
};

export function AdmissionPage({ enquiryId }: { enquiryId: string }) {
  const [detail, setDetail] = useState<EnquiryDetail | null>(null);
  const [courses, setCourses] = useState<StaffCourse[]>([]);
  const [payload, setPayload] = useState<AdmissionPayload>(defaultAdmissionPayload());
  const [currentStep, setCurrentStep] = useState("identity");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<AdmissionConfirmation | null>(null);
  const confirmPendingRef = useRef(false);

  useEffect(() => {
    async function load() {
      const [detailData, courseData, draftData] = await Promise.all([
        getEnquiryDetail(enquiryId),
        getActiveCourses(),
        getAdmissionDraft(enquiryId),
      ]);
      setDetail(detailData);
      setCourses(courseData.courses);
      const next = draftData.draft?.payload ? mergeAdmissionPayload(defaultAdmissionPayload(detailData), draftData.draft.payload) : defaultAdmissionPayload(detailData);
      setPayload(next);
      setCurrentStep(draftData.draft?.currentStep || "identity");
    }
    void load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load admission."))
      .finally(() => setIsLoading(false));
  }, [enquiryId]);

  const selectedCourse = useMemo(() => courses.find((course) => course.id === payload.course.courseId), [courses, payload.course.courseId]);
  const review = useMemo(() => admissionReview(payload, selectedCourse), [payload, selectedCourse]);

  useEffect(() => {
    if (!selectedCourse) return;
    setPayload((current) => ({
      ...current,
      fee: {
        ...current.fee,
        standardFeePaise: selectedCourse.default_fee_paise || 0,
        finalAgreedFeePaise: current.fee.finalAgreedFeePaise || selectedCourse.default_fee_paise || 0,
      },
    }));
  }, [selectedCourse]);

  async function handleSave(event?: FormEvent) {
    event?.preventDefault();
    setIsSaving(true);
    try {
      await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, currentStep);
      setSaved("Draft saved.");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save draft.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm() {
    if (confirmPendingRef.current) return;
    confirmPendingRef.current = true;
    setIsConfirming(true);
    try {
      await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, "review");
      const result = await confirmAdmission(enquiryId);
      setConfirmation(result);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm admission.");
    } finally {
      confirmPendingRef.current = false;
      setIsConfirming(false);
    }
  }

  function setSection(section: keyof AdmissionPayload, key: string, value: string | boolean | number | null) {
    setPayload((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
    setSaved(null);
  }

  if (isLoading) return <LoadingState label="Loading admission" />;
  if (!detail) return <ErrorState title="Could not load admission" message={error || "Please try again."} />;
  if (confirmation) return <AdmissionSuccess confirmation={confirmation} />;

  return (
    <form className="content-stack staff-enquiries-page" onSubmit={handleSave}>
      <header className="page-header">
        <h1>Admission Form</h1>
        <p>{String(detail.enquiry.enquiry_number)} · {String(detail.enquiry.full_name || "Student")}</p>
      </header>
      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      {saved ? <div className="notice notice--success" role="status"><strong>{saved}</strong></div> : null}

      <AdmissionSection title="A · Official identity">
        <label>Full name as per Aadhaar<input value={String(payload.identity.officialFullName)} onChange={(e) => setSection("identity", "officialFullName", e.target.value)} required /></label>
        <label>First name<input value={String(payload.identity.firstName)} onChange={(e) => setSection("identity", "firstName", e.target.value)} /></label>
        <label>Middle name<input value={String(payload.identity.middleName)} onChange={(e) => setSection("identity", "middleName", e.target.value)} /></label>
        <label>Last name<input value={String(payload.identity.lastName)} onChange={(e) => setSection("identity", "lastName", e.target.value)} /></label>
        <label>Date of birth as per Aadhaar<input type="date" value={String(payload.identity.dateOfBirth)} onChange={(e) => setSection("identity", "dateOfBirth", e.target.value)} required /></label>
        <label>Gender<select value={String(payload.identity.gender)} onChange={(e) => setSection("identity", "gender", e.target.value)} required><option value="">Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
        <label>Father's full name<input value={String(payload.identity.fatherName)} onChange={(e) => setSection("identity", "fatherName", e.target.value)} required={payload.course.nsdcPreference === "yes"} /></label>
        <label>Mother's full name<input value={String(payload.identity.motherName)} onChange={(e) => setSection("identity", "motherName", e.target.value)} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={Boolean(payload.identity.identityConfirmed)} onChange={(e) => setSection("identity", "identityConfirmed", e.target.checked)} /> Name and DOB confirmed against Aadhaar</label>
        <p className="preview-line">Certificate preview: <strong>{String(payload.identity.officialFullName || "").toUpperCase()}</strong></p>
      </AdmissionSection>

      <AdmissionSection title="B · Contact">
        <label>Primary mobile<input value={String(payload.contact.primaryMobile)} onChange={(e) => setSection("contact", "primaryMobile", e.target.value)} required /></label>
        <label>Mobile belongs to<select value={String(payload.contact.belongsTo)} onChange={(e) => setSection("contact", "belongsTo", e.target.value)}><option value="student">Student</option><option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option><option value="family">Family</option><option value="other">Other</option></select></label>
        <label>WhatsApp available<select value={payload.contact.isWhatsapp ? "yes" : "no"} onChange={(e) => setSection("contact", "isWhatsapp", e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></label>
        <label>Alternate mobile<input value={String(payload.contact.alternateMobile)} onChange={(e) => setSection("contact", "alternateMobile", e.target.value)} /></label>
        <label>Email<input type="email" value={String(payload.contact.email)} onChange={(e) => setSection("contact", "email", e.target.value)} /></label>
        <label>Preferred language<input value={String(payload.contact.preferredLanguage)} onChange={(e) => setSection("contact", "preferredLanguage", e.target.value)} /></label>
      </AdmissionSection>

      <AdmissionSection title="C · Locality">
        <label>Locality/area<input value={String(payload.locality.locality)} onChange={(e) => setSection("locality", "locality", e.target.value)} required /></label>
        <label>City<input value={String(payload.locality.city)} onChange={(e) => setSection("locality", "city", e.target.value)} required /></label>
        <label>PIN code<input value={String(payload.locality.postalCode)} onChange={(e) => setSection("locality", "postalCode", e.target.value)} /></label>
        <label>State<input value={String(payload.locality.state)} onChange={(e) => setSection("locality", "state", e.target.value)} /></label>
        <label>Residence type<select value={String(payload.locality.residenceType)} onChange={(e) => setSection("locality", "residenceType", e.target.value)}><option value="">Optional</option><option value="family_home">Family home</option><option value="hostel">Hostel</option><option value="pg">PG</option><option value="rented">Rented</option><option value="other">Other</option></select></label>
        <label>Full address<input value={String(payload.locality.fullAddress)} onChange={(e) => setSection("locality", "fullAddress", e.target.value)} placeholder="Optional" /></label>
      </AdmissionSection>

      <AdmissionSection title="D · Education and profile">
        <label>Highest/current qualification<input value={String(payload.education.qualificationLevel)} onChange={(e) => setSection("education", "qualificationLevel", e.target.value)} required /></label>
        <label>Qualification/course name<input value={String(payload.education.qualificationName)} onChange={(e) => setSection("education", "qualificationName", e.target.value)} /></label>
        <label>Stream<input value={String(payload.education.stream)} onChange={(e) => setSection("education", "stream", e.target.value)} /></label>
        <label>Institution<input value={String(payload.education.institutionName)} onChange={(e) => setSection("education", "institutionName", e.target.value)} /></label>
        <label>Currently pursuing<select value={payload.education.currentlyPursuing ? "yes" : "no"} onChange={(e) => setSection("education", "currentlyPursuing", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
        <label>Current year/semester<input value={String(payload.education.currentYearSemester)} onChange={(e) => setSection("education", "currentYearSemester", e.target.value)} /></label>
        <label>Passing year<input type="number" value={String(payload.education.passingYear || "")} onChange={(e) => setSection("education", "passingYear", e.target.value ? Number(e.target.value) : null)} /></label>
        <label>Occupation status<input value={String(payload.education.occupationStatus)} onChange={(e) => setSection("education", "occupationStatus", e.target.value)} required /></label>
      </AdmissionSection>

      <AdmissionSection title="E · Course enrolment">
        <label>Configured active course<select value={String(payload.course.courseId)} onChange={(e) => setSection("course", "courseId", e.target.value)} required><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <label>Branch<input value={String(payload.course.branchId)} onChange={(e) => setSection("course", "branchId", e.target.value)} required /></label>
        <label>Training mode<select value={String(payload.course.trainingMode)} onChange={(e) => setSection("course", "trainingMode", e.target.value)} required><option value="classroom">Classroom</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
        <label>Batch preference<input value={String(payload.course.batchPreference)} onChange={(e) => setSection("course", "batchPreference", e.target.value)} /></label>
        <label>Admission date<input type="date" value={String(payload.course.admissionDate)} onChange={(e) => setSection("course", "admissionDate", e.target.value)} required /></label>
        <label>Joining date<input type="date" value={String(payload.course.joiningDate)} onChange={(e) => setSection("course", "joiningDate", e.target.value)} required /></label>
        <label>Expected completion<input type="date" value={String(payload.course.expectedCompletionDate)} onChange={(e) => setSection("course", "expectedCompletionDate", e.target.value)} /></label>
        <label>NSDC preference<select value={String(payload.course.nsdcPreference)} onChange={(e) => setSection("course", "nsdcPreference", e.target.value)}><option value="no">No</option><option value="yes">Yes</option><option value="decide_later">Decide later</option></select></label>
      </AdmissionSection>

      <AdmissionSection title="F · Fee agreement">
        <label>Standard fee<input type="number" value={Number(selectedCourse?.default_fee_paise ?? payload.fee.standardFeePaise ?? 0) / 100} disabled /></label>
        <label>Final agreed fee<input type="number" min="0" value={Number(payload.fee.finalAgreedFeePaise || 0) / 100} onChange={(e) => setSection("fee", "finalAgreedFeePaise", Math.round(Number(e.target.value || 0) * 100))} required /></label>
        <label>Discount<input value={formatMoney(review.discountPaise)} disabled /></label>
        <label>Discount reason<input value={String(payload.fee.discountReason)} onChange={(e) => setSection("fee", "discountReason", e.target.value)} required={review.discountPaise > 0} /></label>
        <label>Payment plan<select value={String(payload.fee.paymentPlanType)} onChange={(e) => setSection("fee", "paymentPlanType", e.target.value)}><option value="full">Full payment</option><option value="two_instalments">Two instalments</option><option value="three_instalments">Three instalments</option><option value="custom">Custom</option></select></label>
        <label>Number of instalments<input type="number" min="1" value={String(payload.fee.numberOfInstalments)} onChange={(e) => setSection("fee", "numberOfInstalments", Number(e.target.value || 1))} /></label>
        <label>Initial payment expected<input type="number" min="0" value={Number(payload.fee.initialPaymentExpectedPaise || 0) / 100} onChange={(e) => setSection("fee", "initialPaymentExpectedPaise", Math.round(Number(e.target.value || 0) * 100))} required /></label>
      </AdmissionSection>

      <AdmissionSection title="G · Declarations">
        {requiredDeclarations(payload.course.nsdcPreference === "yes").map(([key, label]) => (
          <label key={key} className="checkbox-label"><input type="checkbox" checked={Boolean(payload.declarations[key])} onChange={(e) => setSection("declarations", key, e.target.checked)} /> {label}</label>
        ))}
      </AdmissionSection>

      <section className="staff-card">
        <div className="section-heading"><h2>H · Review</h2></div>
        <div className="detail-grid">
          <Review label="Official identity" value={String(payload.identity.officialFullName)} />
          <Review label="Locality" value={`${payload.locality.locality || "Missing"}, ${payload.locality.city || "Missing"}`} />
          <Review label="Course" value={selectedCourse?.name || "Missing"} />
          <Review label="Joining date" value={String(payload.course.joiningDate || "Missing")} />
          <Review label="NSDC" value={String(payload.course.nsdcPreference)} />
          <Review label="Course Master standard fee" value={formatMoney(Number(selectedCourse?.default_fee_paise ?? payload.fee.standardFeePaise ?? 0))} />
          <Review label="Final fee" value={formatMoney(Number(payload.fee.finalAgreedFeePaise || 0))} />
          <Review label="Discount" value={formatMoney(review.discountPaise)} />
          <Review label="Payment plan" value={String(payload.fee.paymentPlanType)} />
          <Review label="Regular admission" value={review.canConfirmRegularAdmission ? "Ready" : "Missing required fields"} />
          <Review label="NSDC readiness" value={review.nsdcReady ? "Ready for pending profile" : "Regular admission can continue separately"} />
        </div>
        <div className="staff-form-actions">
          <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Draft"}</button>
          <button type="button" className="secondary-button" onClick={() => setCurrentStep("identity")}>Return for Correction</button>
          <button type="button" disabled={isConfirming} onClick={() => void handleConfirm()}>{isConfirming ? "Confirming..." : "Confirm Admission"}</button>
        </div>
      </section>
    </form>
  );
}

export function defaultAdmissionPayload(detail?: EnquiryDetail | null): AdmissionPayload {
  const today = new Date().toISOString().slice(0, 10);
  return {
    identity: {
      officialFullName: String(detail?.enquiry.full_name || ""),
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: String(detail?.enquiry.date_of_birth || ""),
      gender: "",
      fatherName: "",
      motherName: "",
      identityConfirmed: false,
    },
    contact: {
      primaryMobile: detail?.primaryMobile || "",
      belongsTo: "student",
      isWhatsapp: true,
      alternateMobile: detail?.alternateMobile || "",
      email: "",
      preferredLanguage: "",
    },
    locality: { locality: "", city: "", postalCode: "", state: "Maharashtra", residenceType: "", fullAddress: "", homeLocality: "" },
    education: { qualificationLevel: "", qualificationName: "", stream: "", institutionName: "", currentlyPursuing: false, currentYearSemester: "", passingYear: null, occupationStatus: "" },
    course: { courseId: String(detail?.enquiry.course_id || ""), branchId: String(detail?.enquiry.branch_id || ""), trainingMode: "classroom", batchPreference: "", admissionDate: today, joiningDate: today, expectedCompletionDate: "", nsdcPreference: "no", placementSupport: false },
    fee: { standardFeePaise: 0, finalAgreedFeePaise: 0, discountReason: "", paymentPlanType: "full", numberOfInstalments: 1, initialPaymentExpectedPaise: 0, feeRemarks: "" },
    declarations: {
      informationCorrect: false,
      nameDobMatchesAadhaar: false,
      courseRulesExplained: false,
      feeTermsAccepted: false,
      dataProcessingAccepted: false,
      nsdcProcessingAccepted: false,
      nsdcPendingDocumentsUnderstood: false,
      marketingMessages: false,
      alumniCommunication: false,
      referralProgramme: false,
      placementProfileSharing: false,
      photographTestimonialUse: false,
    },
  };
}

export function admissionReview(payload: AdmissionPayload, selectedCourse?: StaffCourse) {
  const standard = Number(selectedCourse?.default_fee_paise ?? payload.fee.standardFeePaise ?? 0);
  const finalFee = Number(payload.fee.finalAgreedFeePaise || 0);
  const discountPaise = Math.max(0, standard - finalFee);
  const nsdcYes = payload.course.nsdcPreference === "yes";
  const regularReady = Boolean(
    payload.identity.officialFullName &&
      payload.identity.dateOfBirth &&
      payload.identity.gender &&
      payload.identity.identityConfirmed &&
      payload.locality.locality &&
      payload.locality.city &&
      payload.education.qualificationLevel &&
      payload.education.occupationStatus &&
      payload.course.courseId &&
      payload.course.branchId &&
      payload.course.joiningDate &&
      payload.fee.paymentPlanType &&
      payload.declarations.informationCorrect &&
      payload.declarations.nameDobMatchesAadhaar &&
      payload.declarations.courseRulesExplained &&
      payload.declarations.feeTermsAccepted &&
      payload.declarations.dataProcessingAccepted &&
      (!discountPaise || payload.fee.discountReason),
  );
  const nsdcReady = !nsdcYes || Boolean(payload.identity.fatherName && payload.declarations.nsdcProcessingAccepted && payload.declarations.nsdcPendingDocumentsUnderstood);
  return { discountPaise, canConfirmRegularAdmission: regularReady, nsdcReady };
}

export function mergeAdmissionPayload(base: AdmissionPayload, incoming: Record<string, unknown>): AdmissionPayload {
  return {
    ...base,
    ...incoming,
    identity: { ...base.identity, ...((incoming.identity as Record<string, unknown>) || {}) },
    contact: { ...base.contact, ...((incoming.contact as Record<string, unknown>) || {}) },
    locality: { ...base.locality, ...((incoming.locality as Record<string, unknown>) || {}) },
    education: { ...base.education, ...((incoming.education as Record<string, unknown>) || {}) },
    course: { ...base.course, ...((incoming.course as Record<string, unknown>) || {}) },
    fee: { ...base.fee, ...((incoming.fee as Record<string, unknown>) || {}) },
    declarations: { ...base.declarations, ...((incoming.declarations as Record<string, unknown>) || {}) },
  } as AdmissionPayload;
}

export function AdmissionSuccess({ confirmation }: { confirmation: AdmissionConfirmation }) {
  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header"><h1>Admission Confirmed</h1><p>{confirmation.isNewStudent ? "New permanent Student ID generated." : "Existing Student ID retained."}</p></header>
      <section className="staff-card detail-grid">
        <Review label="Student ID" value={confirmation.studentNumber} />
        <Review label="Enrolment number" value={confirmation.enrolmentNumber} />
        <Review label="Enquiry" value={confirmation.enquiryNumber} />
      </section>
      <a className="button-link" href={`/app/students/${confirmation.studentId}`}>Open student profile</a>
    </div>
  );
}

function AdmissionSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="staff-card staff-form staff-form-grid" onFocus={() => undefined}><div className="section-heading"><h2>{title}</h2></div>{children}</section>;
}

function Review({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function requiredDeclarations(nsdc: boolean): Array<[keyof AdmissionPayload["declarations"], string]> {
  const base: Array<[keyof AdmissionPayload["declarations"], string]> = [
    ["informationCorrect", "Information entered is correct"],
    ["nameDobMatchesAadhaar", "Name and DOB match Aadhaar"],
    ["courseRulesExplained", "Course rules explained"],
    ["feeTermsAccepted", "Fee and cancellation terms accepted"],
    ["dataProcessingAccepted", "Data processing for admission accepted"],
    ["marketingMessages", "Marketing messages"],
    ["alumniCommunication", "Alumni communication"],
    ["referralProgramme", "Referral programme participation"],
    ["placementProfileSharing", "Placement-profile sharing"],
    ["photographTestimonialUse", "Photograph/testimonial use"],
  ];
  if (nsdc) {
    base.splice(5, 0, ["nsdcProcessingAccepted", "NSDC/Skill India processing authorised"], ["nsdcPendingDocumentsUnderstood", "Aadhaar and document completion is pending"]);
  }
  return base;
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
