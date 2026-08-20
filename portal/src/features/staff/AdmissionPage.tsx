import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  confirmAdmission,
  ApiError,
  getAdmissionDraft,
  getAdmissionConfiguration,
  getEnquiryDetail,
  getActiveCourses,
  linkAdmissionEnquiryPerson,
  recordAdmissionReceipt,
  requestDiscountApproval,
  saveAdmissionDraft,
  searchStudentByMobile,
  type AdmissionConfiguration,
  type AdmissionConfirmation,
  type AdmissionFinancialSummary,
  type EnquiryDetail,
  type FieldErrors,
  type PaymentPlanRule,
  type StaffCourse,
  type StudentSearchPerson,
  type StudentSearchResult,
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

export const ADMISSION_CONFIGURATION_MISSING_MESSAGE = "Admission settings are incomplete. Ask an owner or administrator to configure admission options.";
export const PAYMENT_PLAN_MISSING_MESSAGE = "No payment plan is configured for this course duration.";

export const ADMISSION_FIELD_LABELS: Record<string, string> = {
  "identity.officialFullName": "Full name as per Aadhaar",
  "identity.dateOfBirth": "Date of birth as per Aadhaar",
  "identity.gender": "Gender",
  "identity.fatherName": "Father's full name",
  "identity.identityConfirmed": "Name and DOB confirmed against Aadhaar",
  "contact.primaryMobile": "Primary mobile",
  "contact.preferredLanguageCode": "Preferred language",
  "contact.preferredLanguage": "Preferred language",
  "locality.locality": "Locality/area",
  "locality.city": "City",
  "education.qualificationLevelCode": "Highest/current qualification",
  "education.qualificationLevel": "Highest/current qualification",
  "education.currentYearSemester": "Current year/semester",
  "education.passingYear": "Passing year",
  "education.occupationStatusCode": "Occupation status",
  "education.occupationStatus": "Occupation status",
  "course.courseId": "Configured active course",
  "course.trainingMode": "Training mode",
  "course.admissionDate": "Admission date",
  "course.joiningDate": "Joining date",
  "fee.finalAgreedFeePaise": "Final agreed fee",
  "fee.discountReasonCode": "Discount reason",
  "fee.discountReason": "Discount reason",
  "fee.paymentPlanType": "Payment plan",
  "fee.numberOfInstalments": "Number of instalments",
  amountPaise: "Amount received",
  receivedAt: "Received date/time",
  paymentMode: "Payment mode",
  paymentReference: "Payment reference",
  notes: "Notes",
  firstReceipt: "Admission token receipt",
  "declarations.informationCorrect": "Information entered is correct",
  "declarations.nameDobMatchesAadhaar": "Name and DOB match Aadhaar",
  "declarations.courseRulesExplained": "Course rules explained",
  "declarations.feeTermsAccepted": "Fee and cancellation terms accepted",
  "declarations.dataProcessingAccepted": "Data processing for admission accepted",
  "declarations.nsdcProcessingAccepted": "NSDC/Skill India processing authorised",
  "declarations.nsdcPendingDocumentsUnderstood": "Aadhaar and document completion is pending",
};

export function AdmissionPage({ enquiryId }: { enquiryId: string }) {
  const [detail, setDetail] = useState<EnquiryDetail | null>(null);
  const [courses, setCourses] = useState<StaffCourse[]>([]);
  const [configuration, setConfiguration] = useState<AdmissionConfiguration>(emptyAdmissionConfiguration());
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
  const [financialSummary, setFinancialSummary] = useState<AdmissionFinancialSummary | null>(null);
  const [receiptInput, setReceiptInput] = useState(() => defaultReceiptInput());
  const [isRecordingReceipt, setIsRecordingReceipt] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [studentSearchMobile, setStudentSearchMobile] = useState("");
  const [studentSearchResult, setStudentSearchResult] = useState<StudentSearchResult | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [isSearchingPerson, setIsSearchingPerson] = useState(false);
  const [isLinkingPerson, setIsLinkingPerson] = useState(false);
  const [personLinkIdempotencyKey, setPersonLinkIdempotencyKey] = useState(() => randomPersonLinkKey());
  const confirmPendingRef = useRef(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const focusSummaryRequestedRef = useRef(false);

  async function loadAdmissionData() {
    setIsLoading(true);
    try {
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
      setFinancialSummary(draftData.financialSummary || null);
      setCurrentStep(draftData.draft?.currentStep || "identity");
      setIsLocked(Boolean(draftData.draft?.confirmationLockedAt));
      setStudentSearchMobile(draftData.draft ? studentSearchMobile : detailData.personLinkCandidate?.mobile || "");
      setStudentSearchResult(null);
      setSelectedPersonId("");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load admission.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAdmissionData();
  }, [enquiryId]);

  const admissionCourses = useMemo(() => configuredAdmissionCourses(courses), [courses]);
  const selectedCourse = useMemo(() => admissionCourses.find((course) => course.id === payload.course.courseId), [admissionCourses, payload.course.courseId]);
  const reviewCourse = useMemo(() => courseForReview(payload, selectedCourse, isLocked), [isLocked, payload, selectedCourse]);
  const review = useMemo(() => admissionReview(payload, reviewCourse), [payload, reviewCourse]);
  const optionGroups = useMemo(() => groupOptions(configuration), [configuration]);
  const allowedPaymentRules = useMemo(() => allowedPaymentRulesForCourse(selectedCourse, configuration.paymentPlanRules), [configuration.paymentPlanRules, selectedCourse]);
  const paymentPlanNotice = paymentPlanPolicyMessage(selectedCourse, configuration.paymentPlanRules, allowedPaymentRules);
  const configurationReady = isAdmissionConfigurationReady(configuration);
  const tokenReceipt = financialSummary?.tokenReceipt || null;
  const commercialLocked = Boolean(tokenReceipt) || isLocked;
  const needsPersonLink = !detail?.enquiry.person_id;

  useEffect(() => {
    if (!focusSummaryRequestedRef.current) return;
    focusSummaryRequestedRef.current = false;
    if (Object.keys(fieldErrors).length) errorSummaryRef.current?.focus();
  }, [fieldErrors]);

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

  function requestSummaryFocus(errors: FieldErrors) {
    if (Object.keys(errors).length) focusSummaryRequestedRef.current = true;
  }

  async function persistDraft(step: string, focusWarnings: boolean) {
    const result = await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, step);
    const nextErrors = result.fieldErrors || {};
    setPayload(mergeDraftResponsePayload(payload, result.payload));
    setFieldErrors(nextErrors);
    if (focusWarnings) requestSummaryFocus(nextErrors);
    setSaved(draftSavedMessage(nextErrors));
    setError(null);
    return { fieldErrors: nextErrors };
  }

  async function handleSave(event?: FormEvent) {
    event?.preventDefault();
    if (isLocked) {
      setSaved(null);
      setError("Admission confirmation has started. Retry confirmation to finish recovery.");
      return;
    }
    setIsSaving(true);
    try {
      await persistDraft(currentStep, true);
    } catch (reason) {
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, requestSummaryFocus, "Could not save draft.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm() {
    if (confirmPendingRef.current) return;
    if (!isLocked && !configurationReady) {
      setError(ADMISSION_CONFIGURATION_MISSING_MESSAGE);
      return;
    }
    confirmPendingRef.current = true;
    setIsConfirming(true);
    try {
      if (shouldSaveDraftBeforeConfirm(isLocked)) {
        const savedDraft = await persistDraft("review", true);
        if (Object.keys(savedDraft.fieldErrors).length) return;
      }
      const result = await confirmAdmission(enquiryId);
      setConfirmation(result);
      setError(null);
    } catch (reason) {
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, requestSummaryFocus, "Could not confirm admission.");
    } finally {
      confirmPendingRef.current = false;
      setIsConfirming(false);
    }
  }

  async function handleRecordReceipt() {
    setIsRecordingReceipt(true);
    setError(null);
    setFieldErrors({});
    try {
      const draft = await saveAdmissionDraft(enquiryId, payload as unknown as Record<string, unknown>, "receipt");
      const result = await recordAdmissionReceipt(enquiryId, {
        admissionDraftId: draft.draftId,
        amountPaise: Math.round(Number(receiptInput.amount || 0) * 100),
        receivedAt: localDateTimeToIso(receiptInput.receivedAt),
        paymentMode: receiptInput.paymentMode,
        paymentReference: receiptInput.paymentReference,
        notes: receiptInput.notes,
        idempotencyKey: receiptInput.idempotencyKey,
      });
      setFinancialSummary(result.financialSummary);
      setSaved("Token receipt recorded.");
    } catch (reason) {
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, requestSummaryFocus, "Could not record token receipt.");
    } finally {
      setIsRecordingReceipt(false);
    }
  }

  function setSection(section: keyof AdmissionPayload, key: string, value: string | boolean | number | null) {
    if (isLocked) return;
    setPayload((current) => normalizeDependentFields({ ...current, [section]: { ...current[section], [key]: value } } as AdmissionPayload, section, key));
    setSaved(null);
    clearFieldErrors(errorPathsForChange(section, key));
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
      captureAdmissionError(reason, setError, setFieldErrors, setIsLocked, requestSummaryFocus, "Could not request approval.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSearchPerson() {
    setIsSearchingPerson(true);
    setError(null);
    try {
      const result = await searchStudentByMobile(studentSearchMobile || String(detail?.personLinkCandidate?.mobile || ""));
      setStudentSearchResult(result);
      setSelectedPersonId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not search student records.");
    } finally {
      setIsSearchingPerson(false);
    }
  }

  async function handleLinkExistingPerson() {
    if (!selectedPersonId) {
      setError("Select a student record to link.");
      return;
    }
    await linkPerson(async () => linkAdmissionEnquiryPerson(enquiryId, { mode: "existing", personId: selectedPersonId }));
  }

  async function handleCreateLinkedPerson() {
    await linkPerson(async () => linkAdmissionEnquiryPerson(enquiryId, { mode: "create", idempotencyKey: personLinkIdempotencyKey }));
  }

  async function linkPerson(action: () => Promise<unknown>) {
    setIsLinkingPerson(true);
    setError(null);
    try {
      await action();
      setSaved("Student linked successfully.");
      setStudentSearchResult(null);
      setSelectedPersonId("");
      setPersonLinkIdempotencyKey(randomPersonLinkKey());
      await loadAdmissionData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not link student record.");
    } finally {
      setIsLinkingPerson(false);
    }
  }

  function errorFor(path: string) {
    return fieldErrors[path]?.[0] || "";
  }

  function clearFieldErrors(paths: string[]) {
    setFieldErrors((current) => {
      const next = { ...current };
      for (const path of paths) delete next[path];
      return next;
    });
  }

  function controlProps(path: string) {
    const message = errorFor(path);
    return {
      id: admissionFieldId(path),
      "aria-invalid": Boolean(message),
      "aria-describedby": message ? admissionFieldErrorId(path) : undefined,
    };
  }

  function focusAdmissionField(path: string) {
    const control = document.getElementById(admissionFieldId(path)) as HTMLElement | null;
    control?.scrollIntoView({ block: "center" });
    control?.focus();
  }

  if (isLoading) return <LoadingState label="Loading admission" />;
  if (!detail) return <ErrorState title="Could not load admission" message={error || "Please try again."} />;
  if (confirmation) return <AdmissionSuccess confirmation={confirmation} />;

  return (
    <form className="content-stack staff-enquiries-page" onSubmit={handleSave} noValidate>
      <header className="page-header">
        <h1>Admission Form</h1>
        <p>{String(detail.enquiry.enquiry_number)} · {String(detail.enquiry.full_name || "Student")}</p>
      </header>
      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      {Object.keys(fieldErrors).length ? <ErrorSummary fieldErrors={fieldErrors} summaryRef={errorSummaryRef} onFocusField={focusAdmissionField} /> : null}
      {saved ? <div className="notice notice--success" role="status"><strong>{saved}</strong></div> : null}
      {isLocked ? <AdmissionRecoveryNotice isConfirming={isConfirming} onRetry={() => void handleConfirm()} /> : null}
      {!configurationReady ? <AdmissionConfigurationMissing onRetry={() => void loadAdmissionData()} /> : null}

      {needsPersonLink ? (
        <AdmissionPersonLinkPanel
          detail={detail}
          mobile={studentSearchMobile}
          searchResult={studentSearchResult}
          selectedPersonId={selectedPersonId}
          isSearching={isSearchingPerson}
          isLinking={isLinkingPerson}
          onMobileChange={setStudentSearchMobile}
          onSearch={() => void handleSearchPerson()}
          onSelectPerson={setSelectedPersonId}
          onLinkExisting={() => void handleLinkExistingPerson()}
          onCreateNew={() => void handleCreateLinkedPerson()}
        />
      ) : configurationReady ? <AdmissionLockedFieldset isLocked={isLocked}>
      <AdmissionSection title="A · Official identity">
        <label>Full name as per Aadhaar<RequiredMark /><input {...controlProps("identity.officialFullName")} value={String(payload.identity.officialFullName)} onChange={(e) => setSection("identity", "officialFullName", e.target.value)} /><FieldMessage id={admissionFieldErrorId("identity.officialFullName")} message={errorFor("identity.officialFullName")} /></label>
        <label>First name<input value={String(payload.identity.firstName)} onChange={(e) => setSection("identity", "firstName", e.target.value)} /></label>
        <label>Middle name<input value={String(payload.identity.middleName)} onChange={(e) => setSection("identity", "middleName", e.target.value)} /></label>
        <label>Last name<input value={String(payload.identity.lastName)} onChange={(e) => setSection("identity", "lastName", e.target.value)} /></label>
        <label>Date of birth as per Aadhaar<RequiredMark /><input {...controlProps("identity.dateOfBirth")} type="date" value={String(payload.identity.dateOfBirth)} onChange={(e) => setSection("identity", "dateOfBirth", e.target.value)} /><FieldMessage id={admissionFieldErrorId("identity.dateOfBirth")} message={errorFor("identity.dateOfBirth")} /></label>
        <label>Gender<RequiredMark /><select {...controlProps("identity.gender")} value={String(payload.identity.gender)} onChange={(e) => setSection("identity", "gender", e.target.value)}><option value="">Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select><FieldMessage id={admissionFieldErrorId("identity.gender")} message={errorFor("identity.gender")} /></label>
        <label>Father's full name{payload.course.nsdcPreference === "yes" ? <RequiredMark /> : null}<input {...controlProps("identity.fatherName")} value={String(payload.identity.fatherName)} onChange={(e) => setSection("identity", "fatherName", e.target.value)} /><FieldMessage id={admissionFieldErrorId("identity.fatherName")} message={errorFor("identity.fatherName")} /></label>
        <label>Mother's full name<input value={String(payload.identity.motherName)} onChange={(e) => setSection("identity", "motherName", e.target.value)} /></label>
        <label className="checkbox-label"><input {...controlProps("identity.identityConfirmed")} type="checkbox" checked={Boolean(payload.identity.identityConfirmed)} onChange={(e) => setSection("identity", "identityConfirmed", e.target.checked)} /> Name and DOB confirmed against Aadhaar<RequiredMark /><FieldMessage id={admissionFieldErrorId("identity.identityConfirmed")} message={errorFor("identity.identityConfirmed")} /></label>
        <p className="preview-line">Certificate preview: <strong>{String(payload.identity.officialFullName || "").toUpperCase()}</strong></p>
      </AdmissionSection>

      <AdmissionSection title="B · Contact">
        <label>Primary mobile<RequiredMark /><input {...controlProps("contact.primaryMobile")} value={String(payload.contact.primaryMobile)} onChange={(e) => setSection("contact", "primaryMobile", e.target.value)} /><FieldMessage id={admissionFieldErrorId("contact.primaryMobile")} message={errorFor("contact.primaryMobile")} /></label>
        <label>Mobile belongs to<select value={String(payload.contact.belongsTo)} onChange={(e) => setSection("contact", "belongsTo", e.target.value)}><option value="student">Student</option><option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option><option value="family">Family</option><option value="other">Other</option></select></label>
        <label>WhatsApp available<select value={payload.contact.isWhatsapp ? "yes" : "no"} onChange={(e) => setSection("contact", "isWhatsapp", e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></label>
        <label>Alternate mobile<input value={String(payload.contact.alternateMobile)} onChange={(e) => setSection("contact", "alternateMobile", e.target.value)} /></label>
        <label>Email<input type="email" value={String(payload.contact.email)} onChange={(e) => setSection("contact", "email", e.target.value)} /></label>
        <OptionSelect
          label="Preferred language"
          path="contact.preferredLanguageCode"
          customPath="contact.preferredLanguage"
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
        <label>Locality/area<RequiredMark /><input {...controlProps("locality.locality")} value={String(payload.locality.locality)} onChange={(e) => setSection("locality", "locality", e.target.value)} /><FieldMessage id={admissionFieldErrorId("locality.locality")} message={errorFor("locality.locality")} /></label>
        <label>City<RequiredMark /><input {...controlProps("locality.city")} value={String(payload.locality.city)} onChange={(e) => setSection("locality", "city", e.target.value)} /><FieldMessage id={admissionFieldErrorId("locality.city")} message={errorFor("locality.city")} /></label>
        <label>PIN code<input value={String(payload.locality.postalCode)} onChange={(e) => setSection("locality", "postalCode", e.target.value)} /></label>
        <label>State<input value={String(payload.locality.state)} onChange={(e) => setSection("locality", "state", e.target.value)} /></label>
        <label>Residence type<select value={String(payload.locality.residenceType)} onChange={(e) => setSection("locality", "residenceType", e.target.value)}><option value="">Optional</option><option value="family_home">Family home</option><option value="hostel">Hostel</option><option value="pg">PG</option><option value="rented">Rented</option><option value="other">Other</option></select></label>
        <label>Full address<input value={String(payload.locality.fullAddress)} onChange={(e) => setSection("locality", "fullAddress", e.target.value)} placeholder="Optional" /></label>
      </AdmissionSection>

      <AdmissionSection title="D · Education and profile">
        <OptionSelect
          label="Highest/current qualification"
          path="education.qualificationLevelCode"
          customPath="education.qualificationLevel"
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
          path="education.streamCode"
          customPath="education.stream"
          options={optionGroups.stream || []}
          code={String(payload.education.streamCode || "")}
          customLabel={String(payload.education.stream || "")}
          onCodeChange={(code) => setOption("education", "streamCode", "stream", "stream", code)}
          onCustomLabelChange={(value) => setSection("education", "stream", value)}
          error={errorFor("education.streamCode") || errorFor("education.stream")}
        />
        <label>Institution<input value={String(payload.education.institutionName)} onChange={(e) => setSection("education", "institutionName", e.target.value)} /></label>
        <label>Currently pursuing<select value={payload.education.currentlyPursuing ? "yes" : "no"} onChange={(e) => setSection("education", "currentlyPursuing", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
        <label>Current year/semester{payload.education.currentlyPursuing ? <RequiredMark /> : null}<input {...controlProps("education.currentYearSemester")} value={String(payload.education.currentYearSemester)} onChange={(e) => setSection("education", "currentYearSemester", e.target.value)} disabled={!payload.education.currentlyPursuing} /><FieldMessage id={admissionFieldErrorId("education.currentYearSemester")} message={errorFor("education.currentYearSemester")} /></label>
        <label>Passing year{!payload.education.currentlyPursuing ? <RequiredMark /> : null}<input {...controlProps("education.passingYear")} type="number" value={String(payload.education.passingYear || "")} onChange={(e) => setSection("education", "passingYear", e.target.value ? Number(e.target.value) : null)} disabled={Boolean(payload.education.currentlyPursuing)} /><FieldMessage id={admissionFieldErrorId("education.passingYear")} message={errorFor("education.passingYear")} /></label>
        <OptionSelect
          label="Occupation status"
          path="education.occupationStatusCode"
          customPath="education.occupationStatus"
          required
          options={optionGroups.occupation_status || []}
          code={String(payload.education.occupationStatusCode || "")}
          customLabel={String(payload.education.occupationStatus || "")}
          onCodeChange={(code) => setOption("education", "occupationStatusCode", "occupationStatus", "occupation_status", code)}
          onCustomLabelChange={(value) => setSection("education", "occupationStatus", value)}
          error={errorFor("education.occupationStatusCode") || errorFor("education.occupationStatus")}
        />
      </AdmissionSection>

      <fieldset className="plain-fieldset" disabled={commercialLocked}>
      <AdmissionSection title="E · Course enrolment">
        <label>Configured active course<RequiredMark /><select {...controlProps("course.courseId")} value={String(payload.course.courseId)} onChange={(e) => setSection("course", "courseId", e.target.value)}><option value="">Select course</option>{admissionCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select><FieldMessage id={admissionFieldErrorId("course.courseId")} message={errorFor("course.courseId")} /></label>
        <label>Branch<input value={branchDisplay(detail)} readOnly aria-readonly="true" /></label>
        <label>Training mode<RequiredMark /><select {...controlProps("course.trainingMode")} value={String(payload.course.trainingMode)} onChange={(e) => setSection("course", "trainingMode", e.target.value)}><option value="classroom">Classroom</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select><FieldMessage id={admissionFieldErrorId("course.trainingMode")} message={errorFor("course.trainingMode")} /></label>
        <OptionSelect
          label="Batch preference"
          path="course.batchPreferenceCode"
          customPath="course.batchPreference"
          options={optionGroups.batch_preference || []}
          code={String(payload.course.batchPreferenceCode || "")}
          customLabel={String(payload.course.batchPreference || "")}
          onCodeChange={(code) => setOption("course", "batchPreferenceCode", "batchPreference", "batch_preference", code)}
          onCustomLabelChange={(value) => setSection("course", "batchPreference", value)}
          error={errorFor("course.batchPreferenceCode") || errorFor("course.batchPreference")}
        />
        <label>Admission date<RequiredMark /><input {...controlProps("course.admissionDate")} type="date" value={String(payload.course.admissionDate)} onChange={(e) => setSection("course", "admissionDate", e.target.value)} /><FieldMessage id={admissionFieldErrorId("course.admissionDate")} message={errorFor("course.admissionDate")} /></label>
        <label>Joining date<RequiredMark /><input {...controlProps("course.joiningDate")} type="date" value={String(payload.course.joiningDate)} onChange={(e) => setSection("course", "joiningDate", e.target.value)} /><FieldMessage id={admissionFieldErrorId("course.joiningDate")} message={errorFor("course.joiningDate")} /></label>
        <label>Expected completion<input type="date" value={String(payload.course.expectedCompletionDate)} onChange={(e) => setSection("course", "expectedCompletionDate", e.target.value)} /></label>
        <label>NSDC preference<select value={String(payload.course.nsdcPreference)} onChange={(e) => setSection("course", "nsdcPreference", e.target.value)}><option value="no">No</option><option value="yes">Yes</option><option value="decide_later">Decide later</option></select></label>
      </AdmissionSection>

      <AdmissionSection title="F · Fee agreement">
        <label>Standard fee<input type="number" value={Number(selectedCourse?.default_fee_paise ?? payload.fee.standardFeePaise ?? 0) / 100} disabled /></label>
        <label>Final agreed fee<RequiredMark /><input {...controlProps("fee.finalAgreedFeePaise")} type="number" min="0" value={Number(payload.fee.finalAgreedFeePaise || 0) / 100} onChange={(e) => setSection("fee", "finalAgreedFeePaise", Math.round(Number(e.target.value || 0) * 100))} /><FieldMessage id={admissionFieldErrorId("fee.finalAgreedFeePaise")} message={errorFor("fee.finalAgreedFeePaise")} /></label>
        <label>Discount<input value={formatMoney(review.discountPaise)} disabled /></label>
        <OptionSelect
          label="Discount reason"
          path="fee.discountReasonCode"
          customPath="fee.discountReason"
          required={review.discountPaise > 0}
          options={optionGroups.discount_reason || []}
          code={String(payload.fee.discountReasonCode || "")}
          customLabel={String(payload.fee.discountReason || "")}
          onCodeChange={(code) => setOption("fee", "discountReasonCode", "discountReason", "discount_reason", code)}
          onCustomLabelChange={(value) => setSection("fee", "discountReason", value)}
          error={errorFor("fee.discountReasonCode") || errorFor("fee.discountReason")}
        />
        <PaymentPlanField
          path="fee.paymentPlanType"
          value={String(payload.fee.paymentPlanType)}
          rules={allowedPaymentRules}
          message={paymentPlanNotice || errorFor("fee.paymentPlanType")}
          onChange={(value) => setSection("fee", "paymentPlanType", value)}
        />
        <label>Number of instalments<input {...controlProps("fee.numberOfInstalments")} type="number" min="1" value={String(payload.fee.numberOfInstalments)} onChange={(e) => setSection("fee", "numberOfInstalments", Number(e.target.value || 1))} disabled={String(payload.fee.paymentPlanType) !== "custom"} /><FieldMessage id={admissionFieldErrorId("fee.numberOfInstalments")} message={errorFor("fee.numberOfInstalments")} /></label>
        <label>Initial payment expected<input type="number" min="0" value={Number(payload.fee.initialPaymentExpectedPaise || 0) / 100} onChange={(e) => setSection("fee", "initialPaymentExpectedPaise", Math.round(Number(e.target.value || 0) * 100))} /></label>
        {review.ownerApprovalRequired ? <div className="staff-form-actions"><button type="button" className="secondary-button" disabled={isSaving} onClick={() => void handleRequestApproval()}>{approvalStatus || "Request owner approval"}</button></div> : null}
      </AdmissionSection>
      </fieldset>
      {tokenReceipt ? <div className="notice notice--success" role="status"><strong>Commercial terms locked.</strong> Token receipt has been recorded.</div> : null}

      <AdmissionSection title="G · Declarations">
        {requiredDeclarations(payload.course.nsdcPreference === "yes").map(([key, label]) => (
          <label key={key} className="checkbox-label"><input {...controlProps(`declarations.${key}`)} type="checkbox" checked={Boolean(payload.declarations[key])} onChange={(e) => setSection("declarations", key, e.target.checked)} /> {label}{requiredDeclarationKeys.has(key) ? <RequiredMark /> : null}<FieldMessage id={admissionFieldErrorId(`declarations.${key}`)} message={errorFor(`declarations.${key}`)} /></label>
        ))}
      </AdmissionSection>

      <AdmissionSection title="H · Admission token / first receipt">
        <FinancialSummary summary={financialSummary} fallbackFinalFee={Number(payload.fee.finalAgreedFeePaise || 0)} />
        {tokenReceipt ? (
          <ReceiptRecorded summary={financialSummary} />
        ) : (
          <>
            <label>Amount received<RequiredMark /><input {...controlProps("amountPaise")} type="number" min="1" value={receiptInput.amount} onChange={(e) => setReceiptInput((current) => ({ ...current, amount: e.target.value }))} /><FieldMessage id={admissionFieldErrorId("amountPaise")} message={errorFor("amountPaise")} /></label>
            <label>Received date/time<RequiredMark /><input {...controlProps("receivedAt")} type="datetime-local" value={receiptInput.receivedAt} onChange={(e) => setReceiptInput((current) => ({ ...current, receivedAt: e.target.value }))} /><FieldMessage id={admissionFieldErrorId("receivedAt")} message={errorFor("receivedAt")} /></label>
            <label>Payment mode<RequiredMark /><select {...controlProps("paymentMode")} value={receiptInput.paymentMode} onChange={(e) => setReceiptInput((current) => ({ ...current, paymentMode: e.target.value }))}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select><FieldMessage id={admissionFieldErrorId("paymentMode")} message={errorFor("paymentMode")} /></label>
            <label>Reference<input {...controlProps("paymentReference")} value={receiptInput.paymentReference} onChange={(e) => setReceiptInput((current) => ({ ...current, paymentReference: e.target.value }))} /><FieldMessage id={admissionFieldErrorId("paymentReference")} message={errorFor("paymentReference")} /></label>
            <label>Notes<input {...controlProps("notes")} value={receiptInput.notes} onChange={(e) => setReceiptInput((current) => ({ ...current, notes: e.target.value }))} /><FieldMessage id={admissionFieldErrorId("notes")} message={errorFor("notes")} /></label>
            <div className="staff-form-actions">
              <button type="button" disabled={isRecordingReceipt || isLocked} onClick={() => void handleRecordReceipt()}>{isRecordingReceipt ? "Recording..." : "Record Token Receipt"}</button>
            </div>
          </>
        )}
      </AdmissionSection>

      <section className="staff-card">
        <div className="section-heading"><h2>I · Review</h2></div>
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
          <Review label="Token receipt" value={tokenReceipt ? tokenReceipt.receiptNumber : "Required before confirmation"} />
          <Review label="Ready to Start Classes" value={financialSummary?.classStartEligible ? "Yes" : "No"} />
          <Review label="Regular admission" value={review.canConfirmRegularAdmission ? "Ready" : "Missing required fields"} />
          <Review label="NSDC readiness" value={review.nsdcReady ? "Ready for pending profile" : "Regular admission can continue separately"} />
        </div>
        <div className="staff-form-actions">
          <button type="button" disabled={isSaving || isLocked} onClick={() => void handleSave()}>{isSaving ? "Saving..." : "Save Draft"}</button>
          <button type="button" className="secondary-button" disabled={isLocked} onClick={() => setCurrentStep("identity")}>Return for Correction</button>
          <button type="button" disabled={isConfirming} onClick={() => void handleConfirm()}>{isConfirming ? "Confirming..." : isLocked ? "Retry Confirmation" : "Confirm Admission"}</button>
        </div>
      </section>
      </AdmissionLockedFieldset> : null}
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

function defaultReceiptInput() {
  return {
    amount: "",
    receivedAt: formatDateTimeLocal(new Date()),
    paymentMode: "cash",
    paymentReference: "",
    notes: "",
    idempotencyKey: randomIdempotencyKey(),
  };
}

function randomIdempotencyKey() {
  return `receipt_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function randomPersonLinkKey() {
  return `person_link_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function formatDateTimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
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
      payload.contact.primaryMobile &&
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
  const nsdcReady = !nsdcYes || Boolean(payload.identity.fatherName && payload.declarations.nsdcProcessingAccepted);
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

export function admissionFieldId(path: string) {
  return `admission-field-${path.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export function admissionFieldErrorId(path: string) {
  return `${admissionFieldId(path)}-error`;
}

export function draftSavedMessage(fieldErrors: FieldErrors) {
  const count = Object.keys(fieldErrors).length;
  if (!count) return "Draft saved.";
  return `Draft saved. ${count} ${count === 1 ? "field is" : "fields are"} still required before confirmation.`;
}

export function emptyAdmissionConfiguration(): AdmissionConfiguration {
  return {
    options: [],
    paymentPlanRules: [],
    configuration: { ready: false, missingCategories: [], paymentPlanRulesConfigured: false },
  };
}

export function isAdmissionConfigurationReady(configuration: AdmissionConfiguration) {
  return configuration.configuration.ready;
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

export function mergeDraftResponsePayload(base: AdmissionPayload, incoming: Record<string, unknown>): AdmissionPayload {
  const merged = mergeAdmissionPayload(base, incoming);
  const incomingContact = (incoming.contact as Record<string, unknown>) || {};
  for (const key of ["primaryMobile", "alternateMobile"] as const) {
    if (incomingContact[key] === "" && base.contact[key]) merged.contact[key] = base.contact[key];
  }
  return merged;
}

function groupOptions(configuration: AdmissionConfiguration) {
  return configuration.options.reduce<Record<string, AdmissionConfiguration["options"]>>((groups, option) => {
    groups[option.category] ||= [];
    groups[option.category].push(option);
    return groups;
  }, {});
}

export function allowedPaymentRulesForCourse(course: StaffCourse | undefined, rules: PaymentPlanRule[]) {
  const duration = Number(course?.duration_months || 0);
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const allowed = duration >= rule.min_duration_months && (rule.max_duration_months == null || duration <= rule.max_duration_months);
    if (!allowed || seen.has(rule.plan_type)) return false;
    seen.add(rule.plan_type);
    return true;
  });
}

export function paymentPlanPolicyMessage(course: StaffCourse | undefined, rules: PaymentPlanRule[], allowedRules: PaymentPlanRule[]) {
  if (!course || !rules.length || allowedRules.length) return "";
  return PAYMENT_PLAN_MISSING_MESSAGE;
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

function errorPathsForChange(section: keyof AdmissionPayload, key: string) {
  const path = `${section}.${key}`;
  const related: Record<string, string[]> = {
    "education.currentlyPursuing": ["education.currentYearSemester", "education.passingYear"],
    "course.nsdcPreference": ["identity.fatherName", "declarations.nsdcProcessingAccepted", "declarations.nsdcPendingDocumentsUnderstood"],
    "fee.finalAgreedFeePaise": ["fee.discountReasonCode", "fee.discountReason"],
    "fee.paymentPlanType": ["fee.numberOfInstalments"],
  };
  return [path, ...(related[path] || [])];
}

function branchDisplay(detail: EnquiryDetail) {
  const branchName = detail.enquiry.branch_name || detail.enquiry.branch_code || detail.enquiry.branch_id;
  return String(branchName || "Enquiry branch");
}

export function isAdmissionLockedError(reason: unknown) {
  return reason instanceof ApiError && reason.code === "admission_confirmation_locked";
}

function captureAdmissionError(
  reason: unknown,
  setError: (message: string | null) => void,
  setFieldErrors: (errors: FieldErrors) => void,
  setIsLocked: (isLocked: boolean) => void,
  requestSummaryFocus: (errors: FieldErrors) => void,
  fallback: string,
) {
  if (isAdmissionLockedError(reason)) setIsLocked(true);
  if (reason instanceof ApiError) {
    const nextErrors = reason.fieldErrors || {};
    setError(reason.message);
    setFieldErrors(nextErrors);
    requestSummaryFocus(nextErrors);
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

export function AdmissionConfigurationMissing({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="notice admission-configuration-missing" role="alert">
      <strong>{ADMISSION_CONFIGURATION_MISSING_MESSAGE}</strong>
      <span>Save only when the draft does not depend on missing dropdown values. Confirmation is blocked until configuration is available.</span>
      <button type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}

export function AdmissionPersonLinkPanel({
  detail,
  mobile,
  searchResult,
  selectedPersonId,
  isSearching,
  isLinking,
  onMobileChange,
  onSearch,
  onSelectPerson,
  onLinkExisting,
  onCreateNew,
}: {
  detail: EnquiryDetail;
  mobile: string;
  searchResult: StudentSearchResult | null;
  selectedPersonId: string;
  isSearching: boolean;
  isLinking: boolean;
  onMobileChange: (value: string) => void;
  onSearch: () => void;
  onSelectPerson: (personId: string) => void;
  onLinkExisting: () => void;
  onCreateNew: () => void;
}) {
  const candidate = detail.personLinkCandidate;
  return (
    <section className="staff-card admission-person-link-card" aria-labelledby="admission-person-link-title">
      <div className="section-heading">
        <h2 id="admission-person-link-title">Student record not linked</h2>
        <p>This enquiry must be linked to a student record before admission can continue.</p>
      </div>
      <div className="detail-grid">
        <Review label="Enquiry" value={String(detail.enquiry.enquiry_number || candidate?.enquiryNumber || "Current enquiry")} />
        <Review label="Prospect" value={String(candidate?.displayName || detail.enquiry.full_name || "Referral prospect")} />
        <Review label="Prospect mobile" value={candidate?.mobileDisplay || detail.mobileDisplay || "Contact unavailable"} />
      </div>
      <div className="admission-person-link-actions">
        <label>
          Search existing by mobile
          <input value={mobile} onChange={(event) => onMobileChange(event.target.value)} placeholder="10-digit mobile" />
        </label>
        <button type="button" className="secondary-button" disabled={isSearching || isLinking} onClick={onSearch}>{isSearching ? "Searching..." : "Find Existing Student"}</button>
        <button type="button" disabled={isLinking} onClick={onCreateNew}>{isLinking ? "Linking..." : "Create New Student"}</button>
      </div>
      {searchResult ? (
        <div className="admission-person-results" role="list" aria-label="Existing student matches">
          {searchResult.possiblePeople.length ? searchResult.possiblePeople.map((person) => (
            <label key={person.person_id} className="match-card" role="listitem">
              <input type="radio" name="admission-person" checked={selectedPersonId === person.person_id} onChange={() => onSelectPerson(person.person_id)} />
              <span>
                <strong>{person.full_name}</strong>
                <small>{person.student_number || "No Student ID"} · {person.student_status || "Person record"} · mobile ending {person.mobile_last_four || searchResult.mobileLastFour}</small>
              </span>
            </label>
          )) : <p className="staff-empty">No existing student record was found for this mobile.</p>}
          {searchResult.possiblePeople.length ? (
            <div className="staff-form-actions">
              <button type="button" disabled={!selectedPersonId || isLinking} onClick={onLinkExisting}>{isLinking ? "Linking..." : "Link this student"}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function AdmissionLockedFieldset({ isLocked, children }: { isLocked: boolean; children: ReactNode }) {
  return <fieldset className="admission-locked-fieldset" disabled={isLocked}>{children}</fieldset>;
}

export function PaymentPlanField({ path, value, rules, message, onChange }: { path?: string; value: string; rules: PaymentPlanRule[]; message?: string; onChange: (value: string) => void }) {
  const errorId = path ? admissionFieldErrorId(path) : undefined;
  return (
    <label>
      Payment plan<RequiredMark />
      <select
        id={path ? admissionFieldId(path) : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(message)}
        aria-describedby={message ? errorId : undefined}
        disabled={!rules.length}
      >
        <option value="">Select plan</option>
        {rules.map((rule) => <option key={rule.plan_type} value={rule.plan_type}>{paymentPlanLabel(rule.plan_type)}</option>)}
      </select>
      <FieldMessage id={errorId} message={message} />
    </label>
  );
}

function ErrorSummary({ fieldErrors, summaryRef, onFocusField }: { fieldErrors: FieldErrors; summaryRef: RefObject<HTMLDivElement | null>; onFocusField: (path: string) => void }) {
  const entries = Object.entries(fieldErrors).map(([path, messages]) => ({ path, message: messages[0] || "This field is required." }));
  return (
    <div id="admission-error-summary" ref={summaryRef} className="notice admission-error-summary" role="alert" tabIndex={-1}>
      <strong>Please complete the following fields</strong>
      <span>{entries.length} {entries.length === 1 ? "field needs" : "fields need"} attention before confirmation.</span>
      <ul>
        {entries.map((entry) => (
          <li key={entry.path}>
            <button type="button" className="link-button" onClick={() => onFocusField(entry.path)}>
              {ADMISSION_FIELD_LABELS[entry.path] || entry.path}: {entry.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}

function FieldMessage({ id, message }: { id?: string; message?: string }) {
  return message ? <span id={id} className="field-error">{message}</span> : null;
}

export function OptionSelect({
  label,
  path,
  customPath,
  required = false,
  options,
  code,
  customLabel,
  onCodeChange,
  onCustomLabelChange,
  error,
}: {
  label: string;
  path?: string;
  customPath?: string;
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
  const errorId = path ? admissionFieldErrorId(path) : undefined;
  const customErrorId = customPath ? admissionFieldErrorId(customPath) : errorId;
  return (
    <label>
      {label}{required ? <RequiredMark /> : null}
      <select
        id={path ? admissionFieldId(path) : undefined}
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      >
        <option value="">Select</option>
        {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
      {needsCustom ? (
        <input
          id={customPath ? admissionFieldId(customPath) : undefined}
          value={customLabel}
          onChange={(event) => onCustomLabelChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? customErrorId : undefined}
        />
      ) : null}
      <FieldMessage id={errorId} message={error} />
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
      <AdmissionSection title="Financial summary">
        <FinancialSummary summary={confirmation.financialSummary} fallbackFinalFee={confirmation.financialSummary.finalAgreedFeePaise} />
      </AdmissionSection>
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

function FinancialSummary({ summary, fallbackFinalFee }: { summary: AdmissionFinancialSummary | null; fallbackFinalFee: number }) {
  const finalFee = summary?.finalAgreedFeePaise ?? fallbackFinalFee;
  return (
    <div className="detail-grid">
      <Review label="Final Agreed Fee" value={formatMoney(finalFee)} />
      <Review label="First Instalment Required" value={formatMoney(summary?.firstInstalmentRequiredPaise ?? finalFee)} />
      <Review label="Token / Amount Received" value={formatMoney(summary?.totalReceivedPaise ?? 0)} />
      <Review label="Pending before classes start" value={formatMoney(summary?.firstInstalmentBalancePaise ?? finalFee)} />
      <Review label="Overall Balance" value={formatMoney(summary?.overallBalancePaise ?? finalFee)} />
      <Review label="Ready to Start Classes" value={summary?.classStartEligible ? "Yes" : "No"} />
    </div>
  );
}

function ReceiptRecorded({ summary }: { summary: AdmissionFinancialSummary | null }) {
  const receipt = summary?.tokenReceipt;
  if (!receipt) return null;
  return (
    <div className="detail-grid">
      <Review label="Receipt No." value={receipt.receiptNumber} />
      <Review label="Amount" value={formatMoney(receipt.amountPaise)} />
      <Review label="Mode" value={paymentModeLabel(receipt.paymentMode)} />
      <Review label="Date/Time" value={formatDisplayDateTime(receipt.receivedAt)} />
      <Review label="Reference" value={receipt.paymentReference || "Not recorded"} />
      <Review label="Status" value="Recorded" />
      <p className="notice notice--success">Token receipt recorded. Admission can now be confirmed once all other admission requirements are complete.</p>
    </div>
  );
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
    base.splice(5, 0, ["nsdcProcessingAccepted", "NSDC/Skill India processing authorised"], ["nsdcPendingDocumentsUnderstood", "Aadhaar and document completion is pending (optional if complete)"]);
  }
  return base;
}

const requiredDeclarationKeys = new Set<keyof AdmissionPayload["declarations"]>([
  "informationCorrect",
  "nameDobMatchesAadhaar",
  "courseRulesExplained",
  "feeTermsAccepted",
  "dataProcessingAccepted",
  "nsdcProcessingAccepted",
]);

function paymentPlanLabel(value: string) {
  if (value === "full") return "Full payment";
  if (value === "two_instalments") return "Two instalments";
  if (value === "three_instalments") return "Three instalments";
  if (value === "custom") return "Custom";
  return value || "Not selected";
}

function paymentModeLabel(value: string) {
  if (value === "upi") return "UPI";
  if (value === "bank_transfer") return "Bank transfer";
  return value ? value.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()) : "Not recorded";
}

function formatDisplayDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
