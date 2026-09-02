import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  assignEnrolmentToStaffBatch,
  createStaffBatch,
  getActiveCourses,
  getEligibleBatchEnrolments,
  getEnquiryOptions,
  getStaffBatch,
  getStaffBatches,
  getStaffBatchTrainers,
  removeStaffBatchMembership,
  transferStaffBatchMembership,
  updateStaffBatch,
  type StaffBatch,
  type StaffCourse,
} from "../../lib/api";

const weekdays = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

type BatchForm = {
  name: string;
  branchId: string;
  courseIds: string[];
  trainerPersonId: string;
  daysOfWeek: string[];
  startTime: string;
  endTime: string;
  capacity: string;
  status: string;
};

export function BatchManagementPage({ batchId }: { batchId?: string }) {
  const [batches, setBatches] = useState<StaffBatch[]>([]);
  const [courses, setCourses] = useState<StaffCourse[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [trainers, setTrainers] = useState<Record<string, unknown>[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState(batchId || "");
  const [detail, setDetail] = useState<{ batch: StaffBatch; roster: Record<string, unknown>[] } | null>(null);
  const [eligible, setEligible] = useState<Record<string, unknown>[]>([]);
  const [selectedEnrolmentId, setSelectedEnrolmentId] = useState("");
  const [targetBatchId, setTargetBatchId] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BatchForm>(defaultForm());
  const [courseSearch, setCourseSearch] = useState("");
  const [isCoursePanelOpen, setIsCoursePanelOpen] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const courseSelectorRef = useRef<HTMLDivElement | null>(null);

  const selectedBatch = detail?.batch || batches.find((batch) => batch.id === selectedBatchId) || null;
  const branchIdForForm = form.branchId || selectedBatch?.branchId || branches[0]?.id || "";
  const selectedCourses = useMemo(
    () => form.courseIds.map((courseId) => courses.find((course) => course.id === courseId)).filter((course): course is StaffCourse => Boolean(course)),
    [courses, form.courseIds],
  );
  const filteredCourses = useMemo(() => filterCourses(courses, courseSearch), [courseSearch, courses]);

  useEffect(() => {
    void load();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedBatchId) {
      setDetail(null);
      setEligible([]);
      return;
    }
    void loadDetail(selectedBatchId);
  }, [selectedBatchId]);

  useEffect(() => {
    void getStaffBatchTrainers(branchIdForForm)
      .then((data) => setTrainers(data.trainers))
      .catch(() => setTrainers([]));
  }, [branchIdForForm]);

  useEffect(() => {
    if (!isCoursePanelOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (courseSelectorRef.current && !courseSelectorRef.current.contains(event.target as Node)) {
        setIsCoursePanelOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsCoursePanelOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCoursePanelOpen]);

  async function load() {
    setIsLoading(true);
    try {
      const [batchData, courseData, optionData] = await Promise.all([getStaffBatches({ status: statusFilter }), getActiveCourses(), getEnquiryOptions()]);
      setBatches(batchData.batches);
      setCourses(courseData.courses);
      setBranches(optionData.branches);
      if (batchId && !selectedBatchId) setSelectedBatchId(batchId);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load batches.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDetail(id: string) {
    try {
      const batchData = await getStaffBatch(id);
      setDetail({ batch: batchData.batch, roster: batchData.roster });
      const eligibleData = await getEligibleBatchEnrolments(id);
      setEligible(eligibleData.enrolments);
      setTargetBatchId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load batch details.");
    }
  }

  async function submit() {
    if (!form.courseIds.length) {
      setCourseError("Select at least one course.");
      setError(null);
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      const input = {
        name: form.name,
        branchId: form.branchId,
        courseIds: form.courseIds,
        courseId: form.courseIds[0] || "",
        trainerPersonId: form.trainerPersonId || null,
        daysOfWeek: form.daysOfWeek,
        startTime: form.startTime,
        endTime: form.endTime,
        capacity: form.capacity ? Number(form.capacity) : null,
        status: form.status,
      };
      const saved = editingId ? await updateStaffBatch(editingId, input) : await createStaffBatch(input);
      setMessage(editingId ? "Batch updated." : "Batch created.");
      setEditingId(null);
      setForm(defaultForm());
      setCourseSearch("");
      setIsCoursePanelOpen(false);
      setCourseError(null);
      await load();
      setSelectedBatchId(saved.batchId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save batch.");
    } finally {
      setIsSaving(false);
    }
  }

  async function assignStudent() {
    if (!selectedBatchId || !selectedEnrolmentId) return;
    try {
      await assignEnrolmentToStaffBatch(selectedBatchId, selectedEnrolmentId);
      setSelectedEnrolmentId("");
      setMessage("Student assigned.");
      setError(null);
      await loadDetail(selectedBatchId);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Student could not be assigned.");
    }
  }

  async function removeMembership(membershipId: string) {
    if (!selectedBatchId) return;
    if (!window.confirm("Remove this student from the batch? Batch history will be preserved.")) return;
    try {
      await removeStaffBatchMembership(selectedBatchId, membershipId);
      setMessage("Student removed from batch.");
      setError(null);
      await loadDetail(selectedBatchId);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Student could not be removed from this batch.");
    }
  }

  async function transferMembership(membershipId: string) {
    if (!selectedBatchId || !targetBatchId) return;
    try {
      await transferStaffBatchMembership(selectedBatchId, membershipId, targetBatchId);
      setMessage("Student transferred.");
      setError(null);
      await loadDetail(selectedBatchId);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Student could not be transferred.");
    }
  }

  function editBatch(batch: StaffBatch) {
    setEditingId(batch.id);
    setCourseSearch("");
    setIsCoursePanelOpen(false);
    setCourseError(null);
    setForm({
      name: batch.name,
      branchId: batch.branchId,
      courseIds: batch.courses.length ? batch.courses.map((course) => course.id) : [batch.courseId],
      trainerPersonId: batch.trainerPersonId || "",
      daysOfWeek: batch.daysOfWeek,
      startTime: batch.startTime,
      endTime: batch.endTime,
      capacity: batch.capacity == null ? "" : String(batch.capacity),
      status: batch.status,
    });
  }

  if (isLoading) return <LoadingState label="Loading batches" />;

  return (
    <div className="content-stack staff-enquiries-page batch-management-page">
      <header className="page-header">
        <h1>Batch Management</h1>
        <p>Course batches, trainers, timings, capacity and enrolment assignments.</p>
      </header>
      {error ? <ErrorState title="Batch action failed" message={error} /> : null}
      {message ? <div className="notice notice--success" role="status"><strong>{message}</strong></div> : null}

      <section className="staff-card staff-form batch-form">
        <div className="section-heading"><h2>{editingId ? "Edit Batch" : "Create Batch"}</h2><span>{form.status}</span></div>
        <div className="staff-form-grid">
          <label>Name<input value={form.name} onChange={(event) => setFormValue("name", event.target.value)} /></label>
          <label>Branch<select value={form.branchId} onChange={(event) => setFormValue("branchId", event.target.value)}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <div className="course-selector-field" ref={courseSelectorRef}>
            <label id="batch-courses-label">Courses <span className="required-mark" aria-hidden="true">*</span></label>
            <button
              type="button"
              className="course-selector-trigger"
              aria-haspopup="dialog"
              aria-expanded={isCoursePanelOpen}
              aria-labelledby="batch-courses-label"
              aria-describedby={courseError ? "batch-courses-error" : undefined}
              aria-invalid={courseError ? true : undefined}
              onClick={() => setIsCoursePanelOpen((current) => !current)}
            >
              <span>{selectedCourses.length ? selectedCountLabel(selectedCourses.length) : "Search or select courses..."}</span>
              <span aria-hidden="true">v</span>
            </button>
            {isCoursePanelOpen ? (
              <div className="course-selector-panel" role="dialog" aria-labelledby="batch-courses-label">
                <input
                  type="search"
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="Search courses..."
                  aria-label="Search courses"
                  autoFocus
                />
                <div className="course-selector-list">
                  {filteredCourses.length ? filteredCourses.map((course) => {
                    const inputId = `batch-course-${course.id}`;
                    return (
                      <label key={course.id} className="course-selector-option" htmlFor={inputId}>
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={form.courseIds.includes(course.id)}
                          onChange={(event) => setCourse(course.id, event.target.checked)}
                        />
                        <span>{course.name}</span>
                      </label>
                    );
                  }) : <p className="course-selector-empty">No courses found.</p>}
                </div>
              </div>
            ) : null}
            <div className="selected-course-summary" aria-live="polite">{selectedCourses.length ? selectedCountLabel(selectedCourses.length) : "No courses selected"}</div>
            {selectedCourses.length ? (
              <div className="selected-course-chips" aria-label="Selected courses">
                {selectedCourses.map((course) => (
                  <span className="selected-course-chip" key={course.id}>
                    <span>{course.name}</span>
                    <button type="button" onClick={() => setCourse(course.id, false)} aria-label={`Remove ${course.name}`}>x</button>
                  </span>
                ))}
              </div>
            ) : null}
            {courseError ? <span className="field-error" id="batch-courses-error">{courseError}</span> : null}
          </div>
          <label>Trainer<select value={form.trainerPersonId} onChange={(event) => setFormValue("trainerPersonId", event.target.value)}><option value="">Unassigned</option>{trainers.map((trainer) => <option key={String(trainer.id)} value={String(trainer.id)}>{String(trainer.name)}</option>)}</select></label>
          <div className="weekday-toggle-group batch-days-field" aria-label="Class days">
            {weekdays.map(([value, label]) => (
              <label key={value} className="check-row weekday-toggle">
                <input type="checkbox" checked={form.daysOfWeek.includes(value)} onChange={(event) => setDays(value, event.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <label>Start time<input type="time" value={form.startTime} onChange={(event) => setFormValue("startTime", event.target.value)} /></label>
          <label>End time<input type="time" value={form.endTime} onChange={(event) => setFormValue("endTime", event.target.value)} /></label>
          <label>Capacity<input type="number" min="1" value={form.capacity} onChange={(event) => setFormValue("capacity", event.target.value)} placeholder="Optional" /></label>
          <label>Status<select value={form.status} onChange={(event) => setFormValue("status", event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="completed">Completed</option></select></label>
        </div>
        <div className="form-actions">
          {editingId ? <button type="button" className="button-secondary" onClick={() => { setEditingId(null); setForm(defaultForm()); }}>Cancel</button> : null}
          <button type="button" disabled={isSaving} onClick={() => void submit()}>{isSaving ? "Saving..." : editingId ? "Update Batch" : "Create Batch"}</button>
        </div>
      </section>

      <section className="staff-card">
        <div className="section-heading">
          <h2>Batches</h2>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
        </div>
        {batches.length ? batches.map((batch) => (
          <article className={`table-row ${batch.id === selectedBatchId ? "table-row--selected" : ""}`} key={batch.id}>
            <button className="link-button table-row-main" type="button" onClick={() => setSelectedBatchId(batch.id)}>
              <strong>{batch.name} {batch.capacityWarning ? <span className="status-pill status-pill--warning">Full</span> : null}</strong>
              <span>{compactCourseLabel(batch)} · {batch.branchName} · {formatDays(batch.daysOfWeek)} · {batch.startTime}-{batch.endTime}</span>
              <small>{batch.trainerName || "Trainer unassigned"} · {batch.activeStudents}{batch.capacity ? `/${batch.capacity}` : ""} students · {batch.status}</small>
            </button>
            <button type="button" className="button-link" onClick={() => editBatch(batch)}>Edit</button>
          </article>
        )) : <p className="staff-empty">No batches match this view.</p>}
      </section>

      {selectedBatch ? (
        <section className="staff-card">
          <div className="section-heading"><h2>{selectedBatch.name}</h2><span>{selectedBatch.activeStudents}{selectedBatch.capacity ? `/${selectedBatch.capacity}` : ""}</span></div>
          <div className="detail-grid">
            <div>
              <small>Courses</small>
              <div className="chip-list">{batchCourses(selectedBatch).map((course) => <span className="status-pill" key={course.id}>{course.name}</span>)}</div>
            </div>
            <Detail label="Branch" value={selectedBatch.branchName} />
            <Detail label="Trainer" value={selectedBatch.trainerName || "Unassigned"} />
            <Detail label="Schedule" value={`${formatDays(selectedBatch.daysOfWeek)} ${selectedBatch.startTime}-${selectedBatch.endTime}`} />
          </div>
          <div className="staff-form-grid batch-assignment-row">
            <label>Assign enrolment<select className="batch-assignment-select" value={selectedEnrolmentId} onChange={(event) => setSelectedEnrolmentId(event.target.value)}><option value="">Select eligible student</option>{eligible.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.student_name)} · {String(row.enrolment_number)}</option>)}</select></label>
            <button type="button" disabled={!selectedEnrolmentId} onClick={() => void assignStudent()}>Assign</button>
          </div>
          <div className="section-heading"><h2>Roster</h2><span>{detail?.roster.length || 0}</span></div>
          {detail?.roster.length ? detail.roster.map((row) => (
            <article className="table-row batch-roster-row" key={String(row.membership_id)}>
              <strong>{String(row.student_name)}</strong>
              <span>{String(row.student_number)} · {String(row.enrolment_number)} · {String(row.course_name || "Course")} · Joined {String(row.joined_at).slice(0, 10)}</span>
              <small>{String(row.enrolment_status)}</small>
              <select className="batch-transfer-select" value={targetBatchId} onChange={(event) => setTargetBatchId(event.target.value)}>
                <option value="">Transfer to</option>
                {batches.filter((batch) => batch.id !== selectedBatch.id && batch.branchId === selectedBatch.branchId && batch.status === "active" && batchCourses(batch).some((course) => course.id === String(row.course_id))).map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
              </select>
              <button type="button" className="button-secondary" disabled={!targetBatchId} onClick={() => void transferMembership(String(row.membership_id))}>Transfer</button>
              <button type="button" className="button-link" onClick={() => void removeMembership(String(row.membership_id))}>Remove</button>
            </article>
          )) : <p className="staff-empty">No active students in this batch yet.</p>}
        </section>
      ) : null}
    </div>
  );

  function setFormValue(key: keyof BatchForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setDays(day: string, checked: boolean) {
    setForm((current) => {
      const days = checked ? [...current.daysOfWeek, day] : current.daysOfWeek.filter((item) => item !== day);
      return { ...current, daysOfWeek: weekdays.map(([value]) => value).filter((value) => days.includes(value)) };
    });
  }

  function setCourse(courseId: string, checked: boolean) {
    setForm((current) => {
      const next = checked ? [...current.courseIds, courseId] : current.courseIds.filter((item) => item !== courseId);
      const ordered = courses.map((course) => course.id).filter((id) => next.includes(id));
      return { ...current, courseIds: ordered };
    });
    if (checked) setCourseError(null);
  }
}

function defaultForm(): BatchForm {
  return {
    name: "",
    branchId: "",
    courseIds: [],
    trainerPersonId: "",
    daysOfWeek: ["mon", "wed", "fri"],
    startTime: "08:00",
    endTime: "10:00",
    capacity: "",
    status: "active",
  };
}

function batchCourses(batch: StaffBatch) {
  return batch.courses.length ? batch.courses : [{ id: batch.courseId, name: batch.courseName }];
}

function compactCourseLabel(batch: StaffBatch) {
  const courses = batchCourses(batch);
  return courses.length <= 1 ? courses[0]?.name || "No course" : `${courses[0]?.name || "Courses"} +${courses.length - 1} courses`;
}

function formatDays(days: string[]) {
  const labels = new Map<string, string>(weekdays.map(([value, label]) => [value, label]));
  return days.map((day) => labels.get(day) || day).join(", ");
}

export function filterCourses(courses: StaffCourse[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return courses;
  return courses.filter((course) => course.name.toLowerCase().includes(query));
}

function selectedCountLabel(count: number) {
  return count === 1 ? "1 course selected" : `${count} courses selected`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}
