import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { NotificationToast, nextNotification, type AppNotification } from "../../components/NotificationToast";
import {
  ApiError,
  createEnquiry,
  getEnquiryOptions,
  getCrmEnquiries,
  recordEnquiryFollowUp,
  searchStudentByMobile,
  type CreateEnquiryInput,
  type CreateEnquiryResponse,
  type CrmEnquiryItem,
  type EnquiryOptions,
  type StudentSearchResult,
} from "../../lib/api";

export type FormState = {
  fullName: string;
  branchId: string;
  courseInterestId: string;
  courseInterestText: string;
  source: string;
  sourceDetail: string;
  preferredTiming: string;
  preferredJoiningDate: string;
  existingPersonId: string;
};

export type EnquiryPageState = {
  mobile: string;
  searchResult: StudentSearchResult | null;
  form: FormState;
  error: string | null;
  success: string | null;
};

const emptyFormFields: FormState = {
  fullName: "",
  branchId: "",
  courseInterestId: "",
  courseInterestText: "",
  source: "",
  sourceDetail: "",
  preferredTiming: "",
  preferredJoiningDate: "",
  existingPersonId: "",
};

export const defaultCrmQueue = "hot";

export const queueOptions = [
  ["my", "My enquiries"],
  ["hot", "Hot Enquiries"],
  ["hot_urgent", "Hot Urgent"],
  ["warm", "Warm"],
  ["cold", "Cold"],
  ["today", "Today"],
  ["overdue", "Overdue"],
  ["new", "New"],
  ["upcoming", "Upcoming"],
  ["considering", "Considering"],
  ["deferred", "Deferred"],
  ["admission_ready", "Admission Ready"],
  ["unassigned", "Unassigned"],
  ["all", "All"],
] as const;

const followUpOutcomes = [
  "call_connected",
  "call_no_answer",
  "call_busy",
  "whatsapp_sent",
  "whatsapp_replied",
  "whatsapp_no_response",
  "callback_requested",
  "course_details_shared",
  "fee_discussed",
  "batch_discussed",
  "visit_scheduled",
  "demo_scheduled",
  "demo_completed",
  "thinking",
  "deferred_joining",
  "not_interested",
  "joined_elsewhere",
  "invalid_contact",
  "other",
] as const;

const pipelineStages = ["new", "contacting", "engaged", "considering", "deferred", "admission_ready", "lost", "invalid", "duplicate"] as const;
const terminalPipelineStages = new Set(["converted", "lost", "invalid", "duplicate"]);
const IST_TIME_ZONE = "Asia/Kolkata";

export function EnquiriesPage() {
  const [options, setOptions] = useState<EnquiryOptions | null>(null);
  const [crmItems, setCrmItems] = useState<CrmEnquiryItem[]>([]);
  const [crmQueue, setCrmQueue] = useState(defaultCrmQueue);
  const [crmSearch, setCrmSearch] = useState("");
  const [crmTotal, setCrmTotal] = useState(0);
  const [isLoadingCrm, setIsLoadingCrm] = useState(true);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [loggingFollowUpId, setLoggingFollowUpId] = useState<string | null>(null);
  const [logForm, setLogForm] = useState(initialLogForm());
  const [mobile, setMobile] = useState("");
  const [searchResult, setSearchResult] = useState<StudentSearchResult | null>(null);
  const [form, setForm] = useState<FormState>(initialEnquiryForm());
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notification, setNotification] = useState<AppNotification | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    void getEnquiryOptions()
      .then((data) => {
        setOptions(data);
        const initialForm = initialEnquiryForm(data);
        setForm((current) => ({ ...initialForm, ...current, branchId: current.branchId || initialForm.branchId }));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load enquiry options."))
      .finally(() => setIsLoadingOptions(false));
  }, []);

  useEffect(() => {
    void loadCrmQueue();
  }, [crmQueue]);

  const selectedPerson = useMemo(
    () => searchResult?.possiblePeople.find((person) => person.person_id === form.existingPersonId) || null,
    [form.existingPersonId, searchResult],
  );

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSearching(true);
    try {
      const result = await searchStudentByMobile(mobile);
      setSearchResult(result);
      const firstPerson = result.possiblePeople[0];
      setForm((current) => ({
        ...current,
        existingPersonId: firstPerson?.person_id || "",
        fullName: firstPerson?.full_name || "",
      }));
    } catch (reason) {
      setSearchResult(null);
      setError(reason instanceof Error ? reason.message : "Could not search this mobile number.");
    } finally {
      setIsSearching(false);
    }
  }

  async function loadCrmQueue(search = crmSearch) {
    setIsLoadingCrm(true);
    try {
      const data = await getCrmEnquiries({
        queue: crmQueue === "my" ? "all" : crmQueue,
        assignedTo: crmQueue === "my" ? "me" : undefined,
        search: search || undefined,
        limit: 30,
      });
      setCrmItems(data.items);
      setCrmTotal(data.pagination.total);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load CRM queue.");
    } finally {
      setIsLoadingCrm(false);
    }
  }

  async function handleCrmSearch(event: FormEvent) {
    event.preventDefault();
    await loadCrmQueue(crmSearch);
  }

  async function handleLogFollowUp(event: FormEvent, enquiry: CrmEnquiryItem) {
    event.preventDefault();
    if (loggingFollowUpId) return;
    const sanitized = sanitizeLogForm(logForm);
    const validationMessage = validateLogForm(sanitized);
    if (validationMessage) {
      showNotification("error", validationMessage);
      setLogForm(sanitized);
      return;
    }
    const payload = buildFollowUpPayload(sanitized);
    setLoggingFollowUpId(enquiry.enquiry.id);
    try {
      await recordEnquiryFollowUp(enquiry.enquiry.id, payload);
      setActiveLogId(null);
      setLogForm(initialLogForm());
      await loadCrmQueue();
      showNotification("success", payload.nextFollowUpAt ? `Follow-up saved. Next follow-up scheduled for ${formatDateTime(payload.nextFollowUpAt)}.` : "Follow-up saved.");
    } catch (reason) {
      showNotification("error", followUpErrorMessage(reason));
    } finally {
      setLoggingFollowUpId(null);
    }
  }

  function showNotification(kind: "success" | "error", message: string) {
    setNotification((current) => nextNotification(kind, message, current));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const created = await guardedCreateEnquiry(isSubmittingRef, () =>
        createEnquiry(buildCreateEnquiryInput({
          mobile,
          form,
          selectedPerson,
        })),
      );
      if (!created) return;
      const nextState = enquiryStateAfterSuccess(options, created);
      setMobile(nextState.mobile);
      setSearchResult(nextState.searchResult);
      setForm(nextState.form);
      setError(nextState.error);
      setSuccess(nextState.success);
      focusMobileSearchInput(mobileInputRef);
    } catch (reason) {
      const nextState = enquiryStateAfterFailure(
        { mobile, searchResult, form, error: null, success: null },
        reason instanceof Error ? reason.message : "Could not create the enquiry.",
      );
      setError(nextState.error);
      setSuccess(nextState.success);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingOptions) return <LoadingState label="Loading enquiry form" />;
  if (!options) return <ErrorState title="Could not load enquiry tools" message={error || "Please try again."} />;

  return (
    <div className="content-stack staff-enquiries-page">
      <NotificationToast notification={notification} onDismiss={() => setNotification(null)} />
      <header className="page-header">
        <h1>Enquiries</h1>
        <p>Follow up active leads and manage admissions.</p>
      </header>

      <section className="staff-card crm-queue-card">
        <div className="section-heading">
          <h2>Work queue</h2>
          <span>{crmTotal}</span>
        </div>
        <form className="crm-toolbar" onSubmit={handleCrmSearch}>
          <label>
            Queue
            <select value={crmQueue} onChange={(event) => setCrmQueue(event.target.value)}>
              {queueOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Search
            <input value={crmSearch} onChange={(event) => setCrmSearch(event.target.value)} placeholder="Name, Student ID, mobile, enquiry no., course" />
          </label>
          <button type="submit">{crmSearch.trim() ? "Search" : "Apply"}</button>
        </form>
        {isLoadingCrm ? <LoadingState label="Loading CRM queue" /> : null}
        {!isLoadingCrm && crmItems.length ? (
          <div className="crm-list">
            {crmItems.map((item) => (
              <article className="crm-card" key={item.enquiry.id}>
                <div className="crm-card-main">
                  {isConvertedCrmEnquiry(item) ? <span className="temperature-chip temperature-chip--admitted">ADMITTED</span> : <span className={`temperature-chip temperature-chip--${item.leadTemperature || "inactive"}`}>{temperatureLabel(item.leadTemperature)}</span>}
                  <strong>{item.prospect.displayName}</strong>
                  <small>{crmLeadContext(item)}</small>
                  <span>{item.course.name}</span>
                  <small>{formatLabel(item.pipelineStage)} · {item.source}{item.referral ? " · Referral" : ""}</small>
                </div>
                <div className="crm-card-meta">
                  <CrmContactLine contact={item.contact} />
                  <DetailLine label="Next" value={formatDateTime(item.nextFollowUpAt)} />
                  <DetailLine label="Expected" value={item.expectedJoiningDate || "Not set"} />
                  <DetailLine label="Assigned" value={assignedCounsellorLabel(item)} />
                </div>
                <div className="crm-actions">
                  {item.contact.whatsappUrl ? <a className="contact-action contact-action--whatsapp" href={item.contact.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                  {item.contact.callUrl ? <a className="contact-action" href={item.contact.callUrl}>Call</a> : null}
                  <a className="button-link" href={crmPrimaryAction(item).href}>{crmPrimaryAction(item).label}</a>
                  {crmPaymentPath(item) ? <a className="button-link button-link--primary" href={crmPaymentPath(item)!}>Payments</a> : null}
                  {canLogCrmFollowUp(item) ? <button type="button" className="secondary-button" onClick={() => setActiveLogId(activeLogId === item.enquiry.id ? null : item.enquiry.id)}>Log follow-up</button> : null}
                </div>
                {activeLogId === item.enquiry.id ? (
                  <form className="staff-form crm-log-form" onSubmit={(event) => void handleLogFollowUp(event, item)}>
                    <label>Channel<select value={logForm.channel} onChange={(event) => setLogForm((current) => ({ ...current, channel: event.target.value }))}><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="in_person">In person</option><option value="email">Email</option><option value="other">Other</option></select></label>
                    <label>Outcome<select value={logForm.outcome} onChange={(event) => setLogForm((current) => sanitizeLogForm({ ...current, outcome: event.target.value }))}>{followUpOutcomes.map((outcome) => <option key={outcome} value={outcome}>{formatLabel(outcome)}</option>)}</select></label>
                    <label>Pipeline<select value={logForm.pipelineStage} onChange={(event) => setLogForm((current) => sanitizeLogForm({ ...current, pipelineStage: event.target.value }))}>{pipelineStages.map((stage) => <option key={stage} value={stage}>{formatLabel(stage)}</option>)}</select></label>
                    {isTerminalPipelineStage(logForm.pipelineStage) ? <p className="crm-terminal-note">No active next follow-up for terminal stages.</p> : <label>Next follow-up<input type="datetime-local" step={900} value={logForm.nextFollowUpAt} onChange={(event) => setLogForm((current) => ({ ...current, nextFollowUpAt: event.target.value }))} /></label>}
                    <label>Expected joining<input type="date" value={logForm.expectedJoiningDate} onChange={(event) => setLogForm((current) => ({ ...current, expectedJoiningDate: event.target.value }))} /></label>
                    {logForm.pipelineStage === "lost" ? <label>Lost reason<select required value={logForm.closedReason} onChange={(event) => setLogForm((current) => ({ ...current, closedReason: event.target.value }))}><option value="">Select lost reason</option><option value="not_interested">Not interested</option><option value="joined_elsewhere">Joined elsewhere</option><option value="fee_budget_issue">Fee/budget issue</option><option value="batch_timing_issue">Batch timing issue</option><option value="location_travel_issue">Location/travel issue</option><option value="course_not_suitable">Course not suitable</option><option value="no_response">No response</option><option value="postponed_indefinitely">Postponed indefinitely</option><option value="other">Other</option></select></label> : null}
                    <label className="crm-log-note">Note<input value={logForm.note} onChange={(event) => setLogForm((current) => ({ ...current, note: event.target.value }))} placeholder="Internal note" /></label>
                    <div className="staff-form-actions">
                      <button type="submit" disabled={loggingFollowUpId === item.enquiry.id}>{loggingFollowUpId === item.enquiry.id ? "Saving..." : "Save follow-up"}</button>
                    </div>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        {!isLoadingCrm && !crmItems.length ? <p className="staff-empty">No enquiries in this queue.</p> : null}
      </section>

      <header className="page-header page-header--compact">
        <h1>New Enquiry</h1>
        <p>Search by mobile number before creating an enquiry to prevent duplicate student records.</p>
      </header>

      <section className="staff-card">
        <form className="staff-form staff-search-form" onSubmit={handleSearch}>
          <label htmlFor="student-mobile">Mobile number</label>
          <div className="staff-search-row">
            <input
              ref={mobileInputRef}
              id="student-mobile"
              type="tel"
              inputMode="numeric"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="98765 43210"
              required
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>
        </form>
      </section>

      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      {success ? <EnquirySuccessNotice message={success} /> : null}

      {searchResult ? (
        <>
          <section className="staff-card">
            <div className="section-heading">
              <h2>Possible matching people</h2>
              <span>{searchResult.possiblePeople.length}</span>
            </div>
            {searchResult.possiblePeople.length ? (
              <div className="match-list">
                {searchResult.possiblePeople.map((person) => (
                  <label key={person.person_id} className="match-card">
                    <input
                      type="radio"
                      name="existing-person"
                      checked={form.existingPersonId === person.person_id}
                      onChange={() => setForm((current) => ({ ...current, existingPersonId: person.person_id, fullName: person.full_name }))}
                    />
                    <span>
                      <strong>{person.full_name}</strong>
                      <small>
                        {person.student_number || "No Student ID yet"}
                        {person.student_status ? ` · ${formatLabel(person.student_status)}` : ""}
                        {person.date_of_birth ? ` · DOB ${person.date_of_birth}` : ""}
                      </small>
                      {person.student_id ? <a href={`/app/students/${person.student_id}`}>Open student profile</a> : null}
                    </span>
                  </label>
                ))}
                <label className="match-card">
                  <input
                    type="radio"
                    name="existing-person"
                    checked={!form.existingPersonId}
                    onChange={() => setForm((current) => ({ ...current, existingPersonId: "", fullName: "" }))}
                  />
                  <span><strong>Create a new person</strong><small>Use only when none of the matches are the same person.</small></span>
                </label>
              </div>
            ) : (
              <p className="staff-empty">No existing person was found for this mobile number.</p>
            )}
          </section>

          <section className="staff-card">
            <div className="section-heading">
              <h2>Previous enquiries on this mobile</h2>
              <span>{searchResult.enquiries.length}</span>
            </div>
            {searchResult.enquiries.length ? (
              <div className="enquiry-history">
                {searchResult.enquiries.map((enquiry) => (
                  <article key={enquiry.id}>
                    <strong>{enquiry.enquiry_number}</strong>
                    <span>{enquiry.course_name || "Course not recorded"}</span>
                    <small>{formatLabel(enquiry.status)} · {enquiry.source} · {formatDate(enquiry.created_at)}</small>
                    <a href={`/app/enquiries/${enquiry.id}`}>Open enquiry</a>
                  </article>
                ))}
              </div>
            ) : (
              <p className="staff-empty">No previous enquiries were found.</p>
            )}
          </section>

          <section className="staff-card">
            <div className="section-heading"><h2>Create a new enquiry</h2></div>
            <form className="staff-form staff-form-grid" onSubmit={handleCreate}>
              <label>
                Student name
                <input
                  value={selectedPerson?.full_name || form.fullName}
                  onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                  disabled={Boolean(selectedPerson)}
                  placeholder="Full name"
                  required
                />
              </label>

              <label>
                Branch
                <select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} required>
                  {options.branches.length !== 1 ? <option value="">Select branch</option> : null}
                  {options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>

              <label>
                Course from master
                <select value={form.courseInterestId} onChange={(event) => setForm((current) => ({ ...current, courseInterestId: event.target.value }))}>
                  <option value="">Enter course manually</option>
                  {options.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                </select>
              </label>

              {!form.courseInterestId ? (
                <label>
                  Course interested in
                  <input
                    value={form.courseInterestText}
                    onChange={(event) => setForm((current) => ({ ...current, courseInterestText: event.target.value }))}
                    placeholder="e.g. Data Analytics"
                    required
                  />
                </label>
              ) : null}

              <label>
                Enquiry source
                <select value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} required>
                  <option value="">Select source</option>
                  {options.sources.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
              </label>

              <label>
                Source details
                <input value={form.sourceDetail} onChange={(event) => setForm((current) => ({ ...current, sourceDetail: event.target.value }))} placeholder="Campaign, referrer or notes" />
              </label>

              <label>
                Preferred timing
                <input value={form.preferredTiming} onChange={(event) => setForm((current) => ({ ...current, preferredTiming: event.target.value }))} placeholder="e.g. 7:00 PM" />
              </label>

              <label>
                Preferred joining date
                <input type="date" value={form.preferredJoiningDate} onChange={(event) => setForm((current) => ({ ...current, preferredJoiningDate: event.target.value }))} />
              </label>

              <div className="staff-form-actions">
                <CreateEnquirySubmitButton isSubmitting={isSubmitting} />
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}

function initialLogForm() {
  return {
    channel: "call",
    outcome: "call_connected",
    pipelineStage: "engaged",
    nextFollowUpAt: "",
    expectedJoiningDate: "",
    closedReason: "",
    note: "",
  };
}

type LogFormState = ReturnType<typeof initialLogForm>;

export function sanitizeLogForm(form: LogFormState): LogFormState {
  const pipelineStage = pipelineStageForOutcome(form.outcome, form.pipelineStage);
  const terminal = isTerminalPipelineStage(pipelineStage);
  return {
    ...form,
    pipelineStage,
    nextFollowUpAt: terminal ? "" : form.nextFollowUpAt,
    closedReason: pipelineStage === "lost" ? form.closedReason || lostReasonForOutcome(form.outcome) : "",
  };
}

export function buildFollowUpPayload(form: LogFormState) {
  const sanitized = sanitizeLogForm(form);
  return {
    channel: sanitized.channel,
    outcome: sanitized.outcome,
    note: sanitized.note || null,
    pipelineStage: sanitized.pipelineStage,
    nextFollowUpAt: toIsoDateTime(sanitized.nextFollowUpAt),
    expectedJoiningDate: sanitized.expectedJoiningDate || null,
    closedReason: sanitized.pipelineStage === "lost" ? sanitized.closedReason || null : null,
  };
}

export function validateLogForm(form: LogFormState) {
  const sanitized = sanitizeLogForm(form);
  if (sanitized.pipelineStage === "lost" && !sanitized.closedReason) return "Lost reason is required.";
  if (sanitized.pipelineStage === "deferred" && !sanitized.expectedJoiningDate) return "Expected joining date is required for Deferred Joining.";
  if (sanitized.pipelineStage === "deferred" && !sanitized.nextFollowUpAt) return "Next follow-up is required for Deferred Joining.";
  if (sanitized.nextFollowUpAt && !isQuarterHourLocalInput(sanitized.nextFollowUpAt)) {
    return "Next follow-up must use 15-minute increments.";
  }
  return null;
}

export function followUpErrorMessage(reason: unknown) {
  if (reason instanceof ApiError && reason.message) return reason.message;
  return "Could not save follow-up. Please try again.";
}

function pipelineStageForOutcome(outcome: string, currentStage: string) {
  if (outcome === "deferred_joining") return "deferred";
  if (outcome === "not_interested" || outcome === "joined_elsewhere") return "lost";
  if (outcome === "invalid_contact") return "invalid";
  return currentStage;
}

function lostReasonForOutcome(outcome: string) {
  return outcome === "not_interested" || outcome === "joined_elsewhere" ? outcome : "";
}

export function isTerminalPipelineStage(stage: string) {
  return terminalPipelineStages.has(stage);
}

export function isConvertedCrmEnquiry(item: Pick<CrmEnquiryItem, "pipelineStage" | "admission">) {
  return item.pipelineStage === "converted" && Boolean(item.admission.convertedEnrolmentId && item.admission.studentId);
}

export function crmPaymentPath(item: Pick<CrmEnquiryItem, "pipelineStage" | "admission">) {
  return isConvertedCrmEnquiry(item) && item.admission.paymentLedgerAvailable && item.admission.convertedEnrolmentId
    ? `/app/enrolments/${encodeURIComponent(item.admission.convertedEnrolmentId)}/payments`
    : null;
}

export function crmPrimaryAction(item: Pick<CrmEnquiryItem, "enquiry" | "pipelineStage" | "admission">) {
  if (isConvertedCrmEnquiry(item) && item.admission.studentId) {
    return { label: "Profile", href: `/app/students/${encodeURIComponent(item.admission.studentId)}` };
  }
  return { label: "Open Enquiry", href: `/app/enquiries/${encodeURIComponent(item.enquiry.id)}` };
}

export function canLogCrmFollowUp(item: Pick<CrmEnquiryItem, "pipelineStage">) {
  return !isTerminalPipelineStage(item.pipelineStage);
}

export function crmLeadContext(item: Pick<CrmEnquiryItem, "leadTemperatureReason" | "admission"> & { admission: Pick<CrmEnquiryItem["admission"], "studentNumber" | "enrolmentNumber"> }) {
  if (item.admission.studentNumber) return `Student ID ${item.admission.studentNumber}${item.admission.enrolmentNumber ? ` · ${item.admission.enrolmentNumber}` : ""}`;
  return item.leadTemperatureReason;
}

export function EnquirySuccessNotice({ message }: { message: string }) {
  return (
    <div className="notice notice--success" role="status" aria-live="polite">
      <strong>Saved</strong>
      <span>{message}</span>
    </div>
  );
}

export function CreateEnquirySubmitButton({ isSubmitting }: { isSubmitting: boolean }) {
  return <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating enquiry…" : "Create enquiry"}</button>;
}

export function initialEnquiryForm(options?: EnquiryOptions | null): FormState {
  return {
    ...emptyFormFields,
    branchId: options?.branches.length === 1 ? options.branches[0].id : "",
  };
}

export function createEnquirySuccessMessage(created: Pick<CreateEnquiryResponse, "enquiryNumber">) {
  return created.enquiryNumber
    ? `Enquiry ${created.enquiryNumber} was created successfully.`
    : "Enquiry was created successfully.";
}

export function enquiryStateAfterSuccess(options: EnquiryOptions | null, created: Pick<CreateEnquiryResponse, "enquiryNumber">): EnquiryPageState {
  return {
    mobile: "",
    searchResult: null,
    form: initialEnquiryForm(options),
    error: null,
    success: createEnquirySuccessMessage(created),
  };
}

export function enquiryStateAfterFailure(current: EnquiryPageState, message: string): EnquiryPageState {
  return {
    ...current,
    error: message,
    success: null,
  };
}

export function buildCreateEnquiryInput({
  mobile,
  form,
  selectedPerson,
}: {
  mobile: string;
  form: FormState;
  selectedPerson: StudentSearchResult["possiblePeople"][number] | null;
}): CreateEnquiryInput {
  return {
    mobile,
    fullName: selectedPerson?.full_name || form.fullName,
    branchId: form.branchId,
    courseInterestId: form.courseInterestId || null,
    courseInterestText: form.courseInterestId ? null : form.courseInterestText,
    source: form.source,
    sourceDetail: form.sourceDetail || null,
    preferredTiming: form.preferredTiming || null,
    preferredJoiningDate: form.preferredJoiningDate || null,
    existingPersonId: form.existingPersonId || null,
  };
}

export async function guardedCreateEnquiry(
  pendingRef: { current: boolean },
  submit: () => Promise<CreateEnquiryResponse>,
) {
  if (pendingRef.current) return null;
  pendingRef.current = true;
  try {
    return await submit();
  } finally {
    pendingRef.current = false;
  }
}

export function focusMobileSearchInput(ref: RefObject<HTMLInputElement | null>) {
  ref.current?.focus();
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function temperatureLabel(value: string | null) {
  if (!value) return "Inactive";
  return value === "hot_urgent" ? "HOT URGENT" : value.toUpperCase();
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}

export function assignedCounsellorLabel(item: Pick<CrmEnquiryItem, "assignedCounsellor" | "assignedCounsellorLoginAccountId">) {
  if (!item.assignedCounsellorLoginAccountId) return "Unassigned";
  return item.assignedCounsellor?.displayName || "Unknown staff";
}

export function CrmContactLine({ contact }: { contact: CrmEnquiryItem["contact"] }) {
  return <DetailLine label="Mobile" value={contact.mobileDisplay || "Contact number unavailable"} />;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { timeZone: IST_TIME_ZONE, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(`${value.length === 16 ? `${value}:00` : value}+05:30`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function toIstDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function isQuarterHourLocalInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return false;
  return ["00", "15", "30", "45"].includes(match[5]);
}
