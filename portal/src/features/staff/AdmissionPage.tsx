import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  confirmAdmission,
  ApiError,
  getAdmissionDraft,
  getAdmissionConfiguration,
  getEnquiryDetail,
  getActiveCourses,
  requestDiscountApproval,
  saveAdmissionDraft,
  type AdmissionConfiguration,
  type AdmissionConfirmation,
  type EnquiryDetail,
  type FieldErrors,
  type PaymentPlanRule,
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
  const [configuration, setConfiguration] = useState<AdmissionConfiguration>({ options: [], paymentPlanRules: [] });
  const [payload, setPayload] = useState<AdmissionPayload>(defaultAdmissionPayload());
  const [currentStep, setCurrentStep] = useState("identity");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<AdmissionConfirmation | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const confirmPendingRef = useRef(false);

  useEffect(() => {
    async function load() {
      const [detailData, courseData, draftData, configData] = await Promise.all([
        getEnquiryDetail(enquiryId),
        getActiveCourses(),
        getAdmissionDraft(enquiryId),
        getAdmissionConfiguration(),
      ]);
      setDetail(detailData);
      setCourses(courseData.courses);
      setConfiguration(configData);
      const next = draftData.draft?.payload ? mergeAdmissionPayload(defaultAdmissionPayload(detailData), draftData.draft.payload) : defaultAdmissionPayload(detailData);
      setPayload(next);
      setCurrentStep(draftData.draft?.currentStep || "identity");
      setIsLocked(Boolean(draftData.draft?.confirmationLockedAt));
    }
    void load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load admission."))
      .finally(() => setIsLoading(false));
  }, [enquiryId]);

  const admissionCourses = useMemo(() => configuredAdmissionCourses(courses), [courses]);
  const selectedCourse = useMemo(() => admissionCourses.find((course) => course.id === payload.course.courseId), [admissionCourses, payload.course.courseId]);
  const reviewCourse = useMemo(() => courseForReview(payload, selectedCourse, isLocked), [isLocked, payload, selectedCourse]);
  const review = useMemo(() => admissionReview(payload, reviewCourse), [payload, reviewCourse]);
  const optionGroups = useMemo(() => groupOptions(configuration), [configuration]);
  const allowedPaymentRules = useMemo(() => allowedPaymentRulesForCourse(selectedCourse, configuration.paymentPlanRules), [configuration.paymentPlanRules, selectedCourse]);

  useEffect(() => {
    if (!selectedCourse || isLocked) return;
    setPayload((current) => ({
      ...current,
      fee: {
        ...current.fee,
        standardFeePaise: selectedCourse.default_fee_paise || 0,
        finalAgreedFeePaise: current.fee.finalAgreedFeePaise || selectedCourse.default_fee_paise || 0,
      },
    }));
  }, [isLocked, selectedCourse]);

  async function handleSave(event?: FormEvent) {
    event?.preventDefault();
    if (isLocked) {
      setSaved(null);
      setError("Admission confirmation has started. Retry confirmation to finish recovery.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, currentStep);
      setPayload(mergeAdmissionPayload(payload, result.payload));
      setFieldErrors(result.fieldErrors || {});
      setSaved(Object.keys(result.fieldErrors || {}).length ? "Draft saved with warnings." : "Draft saved.");
      setError(null);
    } catch (reason) {
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, "Could not save draft.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm() {
    if (confirmPendingRef.current) return;
    confirmPendingRef.current = true;
    setIsConfirming(true);
    try {
      if (shouldSaveDraftBeforeConfirm(isLocked)) await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, "review");
      const result = await confirmAdmission(enquiryId);
      setConfirmation(result);
      setError(null);
    } catch (reason) {
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, "Could not confirm admission.");
    } finally {
      confirmPendingRef.current = false;
      setIsConfirming(false);
    }
  }

  function setSection(section: keyof AdmissionPayload, key: string, value: string | boolean | number | null) {
    if (isLocked) return;
    setPayload((current) => normalizeDependentFields({ ...current, [section]: { ...current[section], [key]: value } } as AdmissionPayload, section, key));
    setSaved(null);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`${section}.${key}`];
      return next;
    });
  }

  function setOption(section: keyof AdmissionPayload, codeKey: string, labelKey: string, category: string, code: string) {
    if (isLocked) return;
    const option = optionGroups[category]?.find((item) => item.code === code);
    const label = option && !Boolean(option.requires_custom_label) ? option.label : "";
    setPayload((current) => ({ ...current, [section]: { ...current[section], [codeKey]: code, [labelKey]: label } }));
    setSaved(null);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`${section}.${codeKey}`];
      delete next[`${section}.${labelKey}`];
      return next;
    });
  }

  async function handleRequestApproval() {
    if (isLocked) {
      setError("Admission confirmation has started. Retry confirmation to finish recovery.");
      return;
    }
    setIsSaving(true);
    try {
      await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, "fee");
      const result = await requestDiscountApproval(enquiryId);
      setApprovalStatus(result.status === "approved" ? "Approved" : "Requested");
      setError(null);
    } catch (reason) {
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, "Could not request approval.");
    } finally {
      setIsSaving(false);
    }
  }

  function errorFor(path: string) {
    return fieldErrors[path]?.[0] || "";
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
      {Object.keys(fieldErrors).length ? <ErrorSummary fieldErrors={fieldErrors} /> : null}
      {saved ? <div className="notice notice--success" role="status"><strong>{saved}</strong></div> : null}
      {isLocked ? <AdmissionRecoveryNotice isConfirming={isConfirming} onRetry={() => void handleConfirm()} /> : null}

      <AdmissionLockedFieldset isLocked={isLocked}>
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
        <OptionSelect
          label="Preferred language"
          required
          options={optionGroups.preferred_language || []}
          code={String(payload.contact.preferredLanguageCode || "")}
          customLabel={String(payload.contact.preferredLanguage || "")}
          onCodeChange={(code) => setOption("contact", "preferredLanguageCode", "preferredLanguage", "preferred_language", code)}
          onCustomLabelChange={(value) => setSection("contact", "preferredLanguage", value)}
          error={errorFor("contact.preferredLanguageCode") || errorFor("contact.preferredLanguage")}
        />
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
        <OptionSelect
          label="Highest/current qualification"
          required
          options={optionGroups.qualification_level || []}
          code={String(payload.education.qualificationLevelCode || "")}
          customLabel={String(payload.education.qualificationLevel || "")}
          onCodeChange={(code) => setOption("education", "qualificationLevelCode", "qualificationLevel", "qualification_level", code)}
          onCustomLabelChange={(value) => setSection("education", "qualificationLevel", value)}
          error={errorFor("education.qualificationLevelCode") || errorFor("education.qualificationLevel")}
        />
        <label>Qualification/course name<input value={String(payload.education.qualificationName)} onChange={(e) => setSection("education", "qualificationName", e.target.value)} /></label>
        <OptionSelect
          label="Stream"
          options={optionGroups.stream || []}
          code={String(payload.education.streamCode || "")}
          customLabel={String(payload.education.stream || "")}
          onCodeChange={(code) => setOption("education", "streamCode", "stream", "stream", code)}
          onCustomLabelChange={(value) => setSection("education", "stream", value)}
          error={errorFor("education.streamCode") || errorFor("education.stream")}
        />
        <label>Institution<input value={String(payload.education.institutionName)} onChange={(e) => setSection("education", "institutionName", e.target.value)} /></label>
        <label>Currently pursuing<select value={payload.education.currentlyPursuing ? "yes" : "no"} onChange={(e) => setSection("education", "currentlyPursuing", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
        <label>Current year/semester{payload.education.currentlyPursuing ? <RequiredMark /> : null}<input value={String(payload.education.currentYearSemester)} onChange={(e) => setSection("education", "currentYearSemester", e.target.value)} disabled={!payload.education.currentlyPursuing} aria-invalid={Boolean(errorFor("education.currentYearSemester"))} /></label>
        <label>Passing year{!payload.education.currentlyPursuing ? <RequiredMark /> : null}<input type="number" value={String(payload.education.passingYear || "")} onChange={(e) => setSection("education", "passingYear", e.target.value ? Number(e.target.value) : null)} disabled={Boolean(payload.education.currentlyPursuing)} aria-invalid={Boolean(errorFor("education.passingYear"))} /></label>
        <OptionSelect
          label="Occupation status"
          required
          options={optionGroups.occupation_status || []}
          code={String(payload.education.occupationStatusCode || "")}
          customLabel={String(payload.education.occupationStatus || "")}
          onCodeChange={(code) => setOption("education", "occupationStatusCode", "occupationStatus", "occupation_status", code)}
          onCustomLabelChange={(value) => setSection("education", "occupationStatus", value)}
          error={errorFor("education.occupationStatusCode") || errorFor("education.occupationStatus")}
        />
      </AdmissionSection>

      <AdmissionSection title="E · Course enrolment">
        <label>Configured active course<select value={String(payload.course.courseId)} onChange={(e) => setSection("course", "courseId", e.target.value)} required><option value="">Select course</option>{admissionCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <label>Branch<input value={branchDisplay(detail)} readOnly aria-readonly="true" /></label>
        <label>Training mode<select value={String(payload.course.trainingMode)} onChange={(e) => setSection("course", "trainingMode", e.target.value)} required><option value="classroom">Classroom</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
        <OptionSelect
          label="Batch preference"
          options={optionGroups.batch_preference || []}
          code={String(payload.course.batchPreferenceCode || "")}
          customLabel={String(payload.course.batchPreference || "")}
          onCodeChange={(code) => setOption("course", "batchPreferenceCode", "batchPreference", "batch_preference", code)}
          onCustomLabelChange={(value) => setSection("course", "batchPreference", value)}
          error={errorFor("course.batchPreferenceCode") || errorFor("course.batchPreference")}
        />
        <label>Admission date<input type="date" value={String(payload.course.admissionDate)} onChange={(e) => setSection("course", "admissionDate", e.target.value)} required /></label>
        <label>Joining date<input type="date" value={String(payload.course.joiningDate)} onChange={(e) => setSection("course", "joiningDate", e.target.value)} required /></label>
        <label>Expected completion<input type="date" value={String(payload.course.expectedCompletionDate)} onChange={(e) => setSection("course", "expectedCompletionDate", e.target.value)} /></label>
        <label>NSDC preference<select value={String(payload.course.nsdcPreference)} onChange={(e) => setSection("course", "nsdcPreference", e.target.value)}><option value="no">No</option><option value="yes">Yes</option><option value="decide_later">Decide later</option></select></label>
      </AdmissionSection>

      <AdmissionSection title="F · Fee agreement">
        <label>Standard fee<input type="number" value={Number(selectedCourse?.default_fee_paise ?? payload.fee.standardFeePaise ?? 0) / 100} disabled /></label>
        <label>Final agreed fee<input type="number" min="0" value={Number(payload.fee.finalAgreedFeePaise || 0) / 100} onChange={(e) => setSection("fee", "finalAgreedFeePaise", Math.round(Number(e.target.value || 0) * 100))} required /></label>
        <label>Discount<input value={formatMoney(review.discountPaise)} disabled /></label>
        <OptionSelect
          label="Discount reason"
          required={review.discountPaise > 0}
          options={optionGroups.discount_reason || []}
          code={String(payload.fee.discountReasonCode || "")}
          customLabel={String(payload.fee.discountReason || "")}
          onCodeChange={(code) => setOption("fee", "discountReasonCode", "discountReason", "discount_reason", code)}
          onCustomLabelChange={(value) => setSection("fee", "discountReason", value)}
          error={errorFor("fee.discountReasonCode") || errorFor("fee.discountReason")}
        />
        <label>Payment plan<RequiredMark /><select value={String(payload.fee.paymentPlanType)} onChange={(e) => setSection("fee", "paymentPlanType", e.target.value)} aria-invalid={Boolean(errorFor("fee.paymentPlanType"))}><option value="">Select plan</option>{allowedPaymentRules.map((rule) => <option key={rule.plan_type} value={rule.plan_type}>{paymentPlanLabel(rule.plan_type)}</option>)}</select><FieldMessage message={errorFor("fee.paymentPlanType")} /></label>
        <label>Number of instalments<input type="number" min="1" value={String(payload.fee.numberOfInstalments)} onChange={(e) => setSection("fee", "numberOfInstalments", Number(e.target.value || 1))} disabled={String(payload.fee.paymentPlanType) !== "custom"} aria-invalid={Boolean(errorFor("fee.numberOfInstalments"))} /><FieldMessage message={errorFor("fee.numberOfInstalments")} /></label>
        <label>Initial payment expected<input type="number" min="0" value={Number(payload.fee.initialPaymentExpectedPaise || 0) / 100} onChange={(e) => setSection("fee", "initialPaymentExpectedPaise", Math.round(Number(e.target.value || 0) * 100))} required /></label>
        {review.ownerApprovalRequired ? <div className="staff-form-actions"><button type="button" className="secondary-button" disabled={isSaving} onClick={() => void handleRequestApproval()}>{approvalStatus || "Request owner approval"}</button></div> : null}
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
          <Review label="Course Master standard fee" value={formatMoney(Number(reviewCourse?.default_fee_paise ?? payload.fee.standardFeePaise ?? 0))} />
          <Review label="Final fee" value={formatMoney(Number(payload.fee.finalAgreedFeePaise || 0))} />
          <Review label="Discount" value={formatMoney(review.discountPaise)} />
          <Review label="Payment plan" value={String(payload.fee.paymentPlanType)} />
          <Review label="Regular admission" value={review.canConfirmRegularAdmission ? "Ready" : "Missing required fields"} />
          <Review label="NSDC readiness" value={review.nsdcReady ? "Ready for pending profile" : "Regular admission can continue separately"} />
        </div>
        <div className="staff-form-actions">
          <button type="submit" disabled={isSaving || isLocked}>{isSaving ? "Saving..." : "Save Draft"}</button>
          <button type="button" className="secondary-button" disabled={isLocked} onClick={() => setCurrentStep("identity")}>Return for Correction</button>
          <button type="button" disabled={isConfirming} onClick={() => void handleConfirm()}>{isConfirming ? "Confirming..." : isLocked ? "Retry Confirmation" : "Confirm Admission"}</button>
        </div>
      </section>
      </AdmissionLockedFieldset>
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
      preferredLanguageCode: "",
    },
    locality: { locality: "", city: "", postalCode: "", state: "Maharashtra", residenceType: "", fullAddress: "", homeLocality: "" },
    education: { qualificationLevel: "", qualificationLevelCode: "", qualificationName: "", stream: "", streamCode: "", institutionName: "", currentlyPursuing: false, currentYearSemester: "", passingYear: null, occupationStatus: "", occupationStatusCode: "" },
    course: { courseId: String(detail?.enquiry.course_id || ""), branchId: String(detail?.enquiry.branch_id || ""), trainingMode: "classroom", batchPreference: "", batchPreferenceCode: "", admissionDate: today, joiningDate: today, expectedCompletionDate: "", nsdcPreference: "no", placementSupport: false },
    fee: { standardFeePaise: 0, finalAgreedFeePaise: 0, discountReason: "", discountReasonCode: "", paymentPlanType: "full", numberOfInstalments: 1, initialPaymentExpectedPaise: 0, feeRemarks: "" },
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
  const ownerApprovalRequired = finalFee < Number(selectedCourse?.lowest_acceptable_fee_paise ?? 0);
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
      (!discountPaise || payload.fee.discountReasonCode),
  );
  const nsdcReady = !nsdcYes || Boolean(payload.identity.fatherName && payload.declarations.nsdcProcessingAccepted && payload.declarations.nsdcPendingDocumentsUnderstood);
  return { discountPaise, canConfirmRegularAdmission: regularReady, nsdcReady, ownerApprovalRequired };
}

export function courseForReview(payload: AdmissionPayload, selectedCourse: StaffCourse | undefined, isLocked: boolean) {
  if (!isLocked || !selectedCourse) return selectedCourse;
  return {
    ...selectedCourse,
    default_fee_paise: Number(payload.fee.standardFeePaise ?? selectedCourse.default_fee_paise ?? 0),
  };
}

export function shouldSaveDraftBeforeConfirm(isLocked: boolean) {
  return !isLocked;
}

export function configuredAdmissionCourses(courses: StaffCourse[]) {
  return courses.filter((course) => course.status === "active" && Boolean(course.admission_configuration_complete));
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

function groupOptions(configuration: AdmissionConfiguration) {
  return configuration.options.reduce<Record<string, AdmissionConfiguration["options"]>>((groups, option) => {
    groups[option.category] ||= [];
    groups[option.category].push(option);
    return groups;
  }, {});
}

function allowedPaymentRulesForCourse(course: StaffCourse | undefined, rules: PaymentPlanRule[]) {
  const duration = Number(course?.duration_months || 0);
  return rules.filter((rule) => duration >= rule.min_duration_months && (rule.max_duration_months == null || duration <= rule.max_duration_months));
}

function normalizeDependentFields(payload: AdmissionPayload, section: keyof AdmissionPayload, key: string) {
  const next = { ...payload, education: { ...payload.education }, fee: { ...payload.fee } };
  if (section === "education" && key === "currentlyPursuing") {
    if (next.education.currentlyPursuing) next.education.passingYear = null;
    else next.education.currentYearSemester = "";
  }
  if (section === "fee" && key === "paymentPlanType") {
    if (next.fee.paymentPlanType === "full") next.fee.numberOfInstalments = 1;
    if (next.fee.paymentPlanType === "two_instalments") next.fee.numberOfInstalments = 2;
    if (next.fee.paymentPlanType === "three_instalments") next.fee.numberOfInstalments = 3;
  }
  return next;
}

function branchDisplay(detail: EnquiryDetail) {
  const branchName = detail.enquiry.branch_name || detail.enquiry.branch_code || detail.enquiry.branch_id;
  return String(branchName || "Enquiry branch");
}

export function isAdmissionLockedError(reason: unknown) {
  return reason instanceof ApiError && reason.code === "admission_confirmation_locked";
}

function captureAdmissionError(reason: unknown, setError: (message: string | null) => void, setFieldErrors: (errors: FieldErrors) => void, setIsLocked: (isLocked: boolean) => void, fallback: string) {
  if (isAdmissionLockedError(reason)) setIsLocked(true);
  if (reason instanceof ApiError) {
    setError(reason.message);
    setFieldErrors(reason.fieldErrors || {});
    return;
  }
  setError(reason instanceof Error ? reason.message : fallback);
}

export function AdmissionRecoveryNotice({ isConfirming, onRetry }: { isConfirming: boolean; onRetry: () => void }) {
  return (
    <div className="notice admission-recovery-notice" role="status">
      <strong>Admission confirmation is locked for recovery.</strong>
      <span>The saved details are frozen while the system finishes the admission. Retry confirmation to continue from the locked snapshot.</span>
      <button type="button" disabled={isConfirming} onClick={onRetry}>{isConfirming ? "Confirming..." : "Retry Confirmation"}</button>
    </div>
  );
}

export function AdmissionLockedFieldset({ isLocked, children }: { isLocked: boolean; children: ReactNode }) {
  return <fieldset className="admission-locked-fieldset" disabled={isLocked}>{children}</fieldset>;
}

function ErrorSummary({ fieldErrors }: { fieldErrors: FieldErrors }) {
  const entries = Object.entries(fieldErrors).flatMap(([path, messages]) => messages.map((message) => ({ path, message })));
  return (
    <div className="notice admission-error-summary" role="alert" tabIndex={-1}>
      <strong>Review required fields</strong>
      <ul>{entries.map((entry) => <li key={`${entry.path}-${entry.message}`}>{entry.message}</li>)}</ul>
    </div>
  );
}

function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

function FieldMessage({ message }: { message?: string }) {
  return message ? <span className="field-error">{message}</span> : null;
}

function OptionSelect({
  label,
  required = false,
  options,
  code,
  customLabel,
  onCodeChange,
  onCustomLabelChange,
  error,
}: {
  label: string;
  required?: boolean;
  options: AdmissionConfiguration["options"];
  code: string;
  customLabel: string;
  onCodeChange: (code: string) => void;
  onCustomLabelChange: (value: string) => void;
  error?: string;
}) {
  const selected = options.find((option) => option.code === code);
  const needsCustom = Boolean(selected?.requires_custom_label);
  return (
    <label>
      {label}{required ? <RequiredMark /> : null}
      <select value={code} onChange={(event) => onCodeChange(event.target.value)} aria-invalid={Boolean(error)}>
        <option value="">Select</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
      {needsCustom ? <input value={customLabel} onChange={(event) => onCustomLabelChange(event.target.value)} aria-invalid={Boolean(error)} /> : null}
      <FieldMessage message={error} />
    </label>
  );
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

function paymentPlanLabel(value: string) {
  if (value === "full") return "Full payment";
  if (value === "two_instalments") return "Two instalments";
  if (value === "three_instalments") return "Three instalments";
  if (value === "custom") return "Custom";
  return value || "Not selected";
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
