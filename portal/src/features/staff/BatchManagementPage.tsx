import { useEffect, useState } from "react";
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
  courseId: string;
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

  const selectedBatch = detail?.batch || batches.find((batch) => batch.id === selectedBatchId) || null;
  const branchIdForForm = form.branchId || selectedBatch?.branchId || branches[0]?.id || "";

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
    setIsSaving(true);
    setMessage(null);
    try {
      const input = {
        name: form.name,
        branchId: form.branchId,
        courseId: form.courseId,
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
    await assignEnrolmentToStaffBatch(selectedBatchId, selectedEnrolmentId);
    setSelectedEnrolmentId("");
    setMessage("Student assigned.");
    await loadDetail(selectedBatchId);
    await load();
  }

  async function removeMembership(membershipId: string) {
    if (!selectedBatchId) return;
    await removeStaffBatchMembership(selectedBatchId, membershipId);
    setMessage("Student removed from batch.");
    await loadDetail(selectedBatchId);
    await load();
  }

  async function transferMembership(membershipId: string) {
    if (!selectedBatchId || !targetBatchId) return;
    await transferStaffBatchMembership(selectedBatchId, membershipId, targetBatchId);
    setMessage("Student transferred.");
    await loadDetail(selectedBatchId);
    await load();
  }

  function editBatch(batch: StaffBatch) {
    setEditingId(batch.id);
    setForm({
      name: batch.name,
      branchId: batch.branchId,
      courseId: batch.courseId,
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
          <label>Course<select value={form.courseId} onChange={(event) => setFormValue("courseId", event.target.value)}><option value="">Select course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
          <label>Trainer<select value={form.trainerPersonId} onChange={(event) => setFormValue("trainerPersonId", event.target.value)}><option value="">Unassigned</option>{trainers.map((trainer) => <option key={String(trainer.id)} value={String(trainer.id)}>{String(trainer.name)}</option>)}</select></label>
          <label>Start time<input type="time" value={form.startTime} onChange={(event) => setFormValue("startTime", event.target.value)} /></label>
          <label>End time<input type="time" value={form.endTime} onChange={(event) => setFormValue("endTime", event.target.value)} /></label>
          <label>Capacity<input type="number" min="1" value={form.capacity} onChange={(event) => setFormValue("capacity", event.target.value)} placeholder="Optional" /></label>
          <label>Status<select value={form.status} onChange={(event) => setFormValue("status", event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="completed">Completed</option></select></label>
        </div>
        <div className="weekday-toggle-group" aria-label="Class days">
          {weekdays.map(([value, label]) => (
            <label key={value} className="check-row weekday-toggle">
              <input type="checkbox" checked={form.daysOfWeek.includes(value)} onChange={(event) => setDays(value, event.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
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
              <span>{batch.courseName} · {batch.branchName} · {formatDays(batch.daysOfWeek)} · {batch.startTime}-{batch.endTime}</span>
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
            <Detail label="Course" value={selectedBatch.courseName} />
            <Detail label="Branch" value={selectedBatch.branchName} />
            <Detail label="Trainer" value={selectedBatch.trainerName || "Unassigned"} />
            <Detail label="Schedule" value={`${formatDays(selectedBatch.daysOfWeek)} ${selectedBatch.startTime}-${selectedBatch.endTime}`} />
          </div>
          <div className="staff-form-grid batch-assignment-row">
            <label>Assign enrolment<select value={selectedEnrolmentId} onChange={(event) => setSelectedEnrolmentId(event.target.value)}><option value="">Select eligible student</option>{eligible.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.student_name)} · {String(row.enrolment_number)}</option>)}</select></label>
            <button type="button" disabled={!selectedEnrolmentId} onClick={() => void assignStudent()}>Assign</button>
          </div>
          <div className="section-heading"><h2>Roster</h2><span>{detail?.roster.length || 0}</span></div>
          {detail?.roster.length ? detail.roster.map((row) => (
            <article className="table-row" key={String(row.membership_id)}>
              <strong>{String(row.student_name)}</strong>
              <span>{String(row.student_number)} · {String(row.enrolment_number)} · Joined {String(row.joined_at).slice(0, 10)}</span>
              <small>{String(row.enrolment_status)}</small>
              <select value={targetBatchId} onChange={(event) => setTargetBatchId(event.target.value)}>
                <option value="">Transfer to</option>
                {batches.filter((batch) => batch.id !== selectedBatch.id && batch.courseId === selectedBatch.courseId && batch.branchId === selectedBatch.branchId && batch.status === "active").map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
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
}

function defaultForm(): BatchForm {
  return {
    name: "",
    branchId: "",
    courseId: "",
    trainerPersonId: "",
    daysOfWeek: ["mon", "wed", "fri"],
    startTime: "08:00",
    endTime: "10:00",
    capacity: "",
    status: "active",
  };
}

function formatDays(days: string[]) {
  const labels = new Map<string, string>(weekdays.map(([value, label]) => [value, label]));
  return days.map((day) => labels.get(day) || day).join(", ");
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}
