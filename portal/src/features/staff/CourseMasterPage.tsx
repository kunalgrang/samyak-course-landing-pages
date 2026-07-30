import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { createCourse, getStaffCourses, updateCourse, type StaffCourse } from "../../lib/api";

type CourseForm = {
  code: string;
  name: string;
  durationLabel: string;
  standardFeeRupees: string;
  nsdcAvailable: boolean;
  status: "active" | "inactive" | "archived";
};

const emptyCourseForm: CourseForm = {
  code: "",
  name: "",
  durationLabel: "",
  standardFeeRupees: "",
  nsdcAvailable: false,
  status: "active",
};

export function CourseMasterPage() {
  const [courses, setCourses] = useState<StaffCourse[]>([]);
  const [form, setForm] = useState<CourseForm>(emptyCourseForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadCourses();
  }, []);

  async function loadCourses() {
    setIsLoading(true);
    try {
      setCourses((await getStaffCourses()).courses);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load courses.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const input = courseInputFromForm(form);
      if (editingId) await updateCourse(editingId, input);
      else await createCourse(input);
      setForm(emptyCourseForm);
      setEditingId(null);
      await loadCourses();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save course.");
    } finally {
      setIsSaving(false);
    }
  }

  function edit(course: StaffCourse) {
    setEditingId(course.id);
    setForm({
      code: course.code,
      name: course.name,
      durationLabel: course.duration_label || "",
      standardFeeRupees: paiseToRupees(course.default_fee_paise || 0),
      nsdcAvailable: Boolean(course.nsdc_available),
      status: course.status as CourseForm["status"],
    });
  }

  if (isLoading) return <LoadingState label="Loading courses" />;

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Course Master</h1>
        <p>Manage configured courses available for admission.</p>
      </header>

      {error ? <ErrorState title="Could not continue" message={error} /> : null}

      <section className="staff-card">
        <div className="section-heading"><h2>{editingId ? "Edit course" : "Create course"}</h2></div>
        <form className="staff-form staff-form-grid" onSubmit={handleSubmit}>
          <label>Course code<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></label>
          <label>Course name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>Duration label<input value={form.durationLabel} onChange={(event) => setForm({ ...form, durationLabel: event.target.value })} placeholder="e.g. 6 months" /></label>
          <label>Standard fee<input type="number" min="0" value={form.standardFeeRupees} onChange={(event) => setForm({ ...form, standardFeeRupees: event.target.value })} required /></label>
          <label>NSDC available<select value={form.nsdcAvailable ? "yes" : "no"} onChange={(event) => setForm({ ...form, nsdcAvailable: event.target.value === "yes" })}><option value="no">No</option><option value="yes">Yes</option></select></label>
          <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CourseForm["status"] })}><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
          <div className="staff-form-actions">
            {editingId ? <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setForm(emptyCourseForm); }}>Cancel</button> : null}
            <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save course"}</button>
          </div>
        </form>
      </section>

      <section className="staff-card">
        <div className="section-heading"><h2>Configured courses</h2><span>{courses.length}</span></div>
        <div className="table-list">
          {courses.map((course) => (
            <article key={course.id} className="table-row">
              <strong>{course.code}</strong>
              <span>{course.name}</span>
              <small>{course.duration_label || "Duration not set"} · {formatMoney(course.default_fee_paise || 0)} · {course.nsdc_available ? "NSDC" : "Non-NSDC"} · {course.status}</small>
              <button type="button" onClick={() => edit(course)}>Edit</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function courseInputFromForm(form: CourseForm) {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    durationLabel: form.durationLabel.trim() || null,
    standardFeePaise: Math.round(Number(form.standardFeeRupees || 0) * 100),
    nsdcAvailable: form.nsdcAvailable,
    status: form.status,
  };
}

function paiseToRupees(value: number) {
  return String(Math.round(value / 100));
}

function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
