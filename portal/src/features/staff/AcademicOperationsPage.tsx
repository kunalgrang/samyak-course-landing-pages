import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getStaffAcademicBatch,
  getStaffAcademicOverview,
  getStaffAcademicSession,
  getStaffAcademicStudentAttendance,
  getStaffAcademicTrainerActivity,
  staffAcademicMaterialContentUrl,
  type StaffAcademicBatchDetail,
  type StaffAcademicOverview,
  type StaffAcademicSessionDetail,
  type StaffAcademicSessionSummary,
  type StaffAcademicStudentAttendance,
  type StaffAcademicTrainerActivity,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";

type AcademicOperationsPageProps =
  | { mode?: "overview"; onNavigate: (path: RoutePath) => void }
  | { mode: "batch"; batchId: string; onNavigate: (path: RoutePath) => void }
  | { mode: "session"; sessionId: string; onNavigate: (path: RoutePath) => void }
  | { mode: "trainer"; personId: string; onNavigate: (path: RoutePath) => void }
  | { mode: "student"; studentId: string; onNavigate: (path: RoutePath) => void };

export function AcademicOperationsPage(props: AcademicOperationsPageProps) {
  if (props.mode === "batch") return <BatchAcademicDetail batchId={props.batchId} onNavigate={props.onNavigate} />;
  if (props.mode === "session") return <SessionAcademicDetail sessionId={props.sessionId} onNavigate={props.onNavigate} />;
  if (props.mode === "trainer") return <TrainerActivityDetail personId={props.personId} onNavigate={props.onNavigate} />;
  if (props.mode === "student") return <StudentAttendanceDetail studentId={props.studentId} onNavigate={props.onNavigate} />;
  return <AcademicOverview onNavigate={props.onNavigate} />;
}

function AcademicOverview({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  const [data, setData] = useState<StaffAcademicOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    getStaffAcademicOverview()
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
        }
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load academic view.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (isLoading) return <LoadingState label="Loading academic operations" />;
  if (error) return <ErrorState title="Academic view unavailable" message={error} />;
  if (!data) return <EmptyState title="No academic data" message="No academic operations data is available yet." />;

  return (
    <div className="content-stack staff-enquiries-page academic-page">
      <header className="page-header">
        <h1>Academic</h1>
        <p>Teaching operations for batches, class sessions, attendance and materials.</p>
      </header>

      <section className="metric-grid academic-metrics" aria-label="Academic summary">
        <Metric label="Classes Today" value={data.summary.classesToday} />
        <Metric label="Present Today" value={data.summary.studentsPresentToday} />
        <Metric label="Absent Today" value={data.summary.studentsAbsentToday} />
        <Metric label="Active Batches" value={data.summary.activeBatches} />
        <Metric label="No Recent Class" value={data.summary.batchesWithoutRecentClass} />
      </section>

      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Today's Classes</h2><span>{data.today}</span></div>
        {data.todayClasses.length ? (
          <div className="academic-list">
            {data.todayClasses.map((session) => (
              <SessionRow key={session.id} session={session} onNavigate={onNavigate} />
            ))}
          </div>
        ) : <EmptyState title="No classes logged today" message="No Trainer session has been opened or completed for today yet." />}
      </section>

      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Needs Attention</h2><span>{data.needsAttention.length}</span></div>
        {data.needsAttention.length ? data.needsAttention.map((item) => (
          <article className="table-row academic-attention-row" key={`${item.type}-${item.batchId}`}>
            <strong>{item.message}</strong>
            <span>{item.batchName}</span>
            <button type="button" className="button-link" onClick={() => onNavigate(`/app/academic/batches/${item.batchId}`)}>View Academic Detail</button>
          </article>
        )) : <p className="staff-empty">No operational academic warnings for the current schedule.</p>}
      </section>

      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Active Batches</h2><span>{data.activeBatches.length}</span></div>
        {data.activeBatches.length ? (
          <div className="academic-list">
            {data.activeBatches.map((batch) => (
              <article className="table-row academic-batch-row" key={batch.id}>
                <div>
                  <strong>{batch.name}</strong>
                  <span>{courseLabel(batch.courses)} · {batch.branchName} · {formatDays(batch.daysOfWeek)} · {batch.startTime}-{batch.endTime}</span>
                  <small>{batch.trainerName || "Trainer not assigned"} · {batch.activeStudents} students · Last class {batch.lastClassDate || "Never"} · {batch.lastMaterialCount} files</small>
                </div>
                <button type="button" className="button-link" onClick={() => onNavigate(`/app/academic/batches/${batch.id}`)}>View Academic Detail</button>
              </article>
            ))}
          </div>
        ) : <EmptyState title="No active batches" message="Active teaching batches will appear here." />}
      </section>
    </div>
  );
}

function BatchAcademicDetail({ batchId, onNavigate }: { batchId: string; onNavigate: (path: RoutePath) => void }) {
  const [data, setData] = useState<StaffAcademicBatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [batchId]);

  async function load() {
    setIsLoading(true);
    try {
      setData(await getStaffAcademicBatch(batchId));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load batch academic detail.");
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading batch academic detail" />;
  if (error) return <ErrorState title="Batch academic view unavailable" message={error} />;
  if (!data) return null;

  return (
    <div className="content-stack staff-enquiries-page academic-page">
      <BackButton onNavigate={onNavigate} />
      <header className="page-header page-header--compact">
        <h1>{data.batch.name}</h1>
        <p>{courseLabel(data.batch.courses)} · {data.batch.branchName} · {formatDays(data.batch.daysOfWeek)} {data.batch.startTime}-{data.batch.endTime}</p>
      </header>
      <section className="staff-card">
        <div className="detail-grid">
          <Detail label="Trainer" value={data.batch.trainerName || "Trainer not assigned"} />
          <Detail label="Roster" value={`${data.batch.activeStudents} students`} />
          <Detail label="Last Class" value={data.summary.lastClassDate || "Never"} />
          <Detail label="Classes Logged" value={String(data.summary.classesLogged)} />
          <Detail label="Attendance" value={formatPercent(data.summary.attendancePercent)} />
          <Detail label="Materials Shared" value={String(data.summary.materialsShared)} />
        </div>
        <div className="staff-form-actions">
          <button type="button" className="button-link" onClick={() => onNavigate(`/app/batches/${batchId}`)}>Open Batch Management</button>
        </div>
      </section>
      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Recent Session History</h2><span>{data.pagination.hasMore ? "20+" : data.sessions.length}</span></div>
        {data.sessions.length ? data.sessions.map((session) => <SessionRow key={session.id} session={session} onNavigate={onNavigate} />) : <EmptyState title="No sessions yet" message="Class session history will appear after Trainers log sessions." />}
      </section>
    </div>
  );
}

function SessionAcademicDetail({ sessionId, onNavigate }: { sessionId: string; onNavigate: (path: RoutePath) => void }) {
  const [data, setData] = useState<StaffAcademicSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStaffAcademicSession(sessionId).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load class session."));
  }, [sessionId]);

  if (error) return <ErrorState title="Session unavailable" message={error} />;
  if (!data) return <LoadingState label="Loading class session" />;

  return (
    <div className="content-stack staff-enquiries-page academic-page">
      <BackButton onNavigate={onNavigate} />
      <header className="page-header page-header--compact">
        <h1>{data.session.batchName}</h1>
        <p>{data.session.sessionDate} · {timeRange(data.session)} · {data.session.trainerName}</p>
      </header>
      <section className="staff-card">
        <div className="detail-grid">
          <Detail label="Status" value={titleCase(data.session.status)} />
          <Detail label="Present" value={String(data.session.presentCount)} />
          <Detail label="Absent" value={String(data.session.absentCount)} />
        </div>
        <div className="academic-note">
          <small>Teaching Note</small>
          <p>{data.session.teachingNote || "No teaching note recorded."}</p>
        </div>
      </section>
      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Attendance</h2><span>{data.roster.length}</span></div>
        {data.roster.length ? data.roster.map((student) => (
          <article className="table-row academic-roster-row" key={`${student.enrolmentId}-${student.studentId}`}>
            <div>
              <strong>{student.studentName}</strong>
              <span>{student.studentNumber} · {student.enrolmentNumber} · {student.courseName}</span>
            </div>
            <span className={`attendance-chip attendance-chip--${student.attendanceStatus || "unmarked"}`}>{student.attendanceStatus ? titleCase(student.attendanceStatus) : "Unmarked"}</span>
          </article>
        )) : <EmptyState title="No roster" message="No students were eligible for this session date." />}
      </section>
      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Materials</h2><span>{data.materials.length}</span></div>
        {data.materials.length ? data.materials.map((material) => (
          <a className="student-material-link" href={staffAcademicMaterialContentUrl(material.id)} target="_blank" rel="noreferrer" key={material.id}>
            <span><strong>{material.title}</strong><small>{titleCase(material.materialType.replace("_", " "))} · {formatBytes(material.sizeBytes)}</small></span>
            <small>View PDF</small>
          </a>
        )) : <p className="staff-empty">No active materials uploaded for this session.</p>}
      </section>
    </div>
  );
}

function TrainerActivityDetail({ personId, onNavigate }: { personId: string; onNavigate: (path: RoutePath) => void }) {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<StaffAcademicTrainerActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStaffAcademicTrainerActivity(personId, { range }).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load trainer activity."));
  }, [personId, range]);

  if (error) return <ErrorState title="Trainer activity unavailable" message={error} />;
  if (!data) return <LoadingState label="Loading trainer activity" />;

  return (
    <div className="content-stack staff-enquiries-page academic-page">
      <BackButton onNavigate={onNavigate} />
      <header className="page-header page-header--compact">
        <h1>{data.trainer.name}</h1>
        <p>{data.trainer.branchName || "All branches"} · {titleCase(data.trainer.trainerStatus)}</p>
      </header>
      <section className="staff-card">
        <div className="segmented-control" aria-label="Activity range">
          <button type="button" className={`segmented-control__option ${range === "7d" ? "segmented-control__option--active" : ""}`} onClick={() => setRange("7d")}>Last 7 days</button>
          <button type="button" className={`segmented-control__option ${range === "30d" ? "segmented-control__option--active" : ""}`} onClick={() => setRange("30d")}>Last 30 days</button>
        </div>
        <div className="detail-grid">
          <Detail label="Active Batches" value={String(data.summary.activeBatches)} />
          <Detail label="This Week" value={String(data.summary.classesThisWeek)} />
          <Detail label="This Month" value={String(data.summary.classesThisMonth)} />
          <Detail label="Last Class" value={data.summary.lastClassDate || "Never"} />
        </div>
      </section>
      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Recent Activity</h2><span>{data.range}</span></div>
        {data.sessions.length ? data.sessions.map((session) => <SessionRow key={session.id} session={session} onNavigate={onNavigate} />) : <EmptyState title="No teaching activity" message="No class sessions were logged in this period." />}
      </section>
    </div>
  );
}

function StudentAttendanceDetail({ studentId, onNavigate }: { studentId: string; onNavigate: (path: RoutePath) => void }) {
  const [data, setData] = useState<StaffAcademicStudentAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStaffAcademicStudentAttendance(studentId).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load student attendance."));
  }, [studentId]);

  if (error) return <ErrorState title="Student attendance unavailable" message={error} />;
  if (!data) return <LoadingState label="Loading student attendance" />;

  return (
    <div className="content-stack staff-enquiries-page academic-page">
      <BackButton onNavigate={onNavigate} />
      <header className="page-header page-header--compact">
        <h1>{data.student.name}</h1>
        <p>{data.student.studentNumber} · {data.student.branchName} · {titleCase(data.student.status)}</p>
      </header>
      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Enrolment Attendance</h2><span>{data.enrolments.length}</span></div>
        {data.enrolments.length ? data.enrolments.map((enrolment) => (
          <article className="table-row" key={enrolment.enrolmentId}>
            <strong>{enrolment.courseName}</strong>
            <span>{enrolment.enrolmentNumber} · {titleCase(enrolment.status)}</span>
            <small>{enrolment.present} Present · {enrolment.absent} Absent · {formatPercent(enrolment.attendancePercent)}</small>
          </article>
        )) : <EmptyState title="No enrolments" message="Attendance is grouped by enrolment when records exist." />}
      </section>
      <section className="staff-card academic-section">
        <div className="section-heading"><h2>Session History</h2><span>{data.pagination.hasMore ? "20+" : data.sessions.length}</span></div>
        {data.sessions.length ? data.sessions.map((session) => (
          <article className="table-row academic-session-row" key={`${session.enrolmentId}-${session.id}`}>
            <div>
              <strong>{session.sessionDate} · {session.batchName}</strong>
              <span>{session.courseName} · {session.trainerName} · {timeRange(session)}</span>
              <small>{session.teachingNoteExcerpt || "No note"} · {session.materialCount} files</small>
            </div>
            <span className={`attendance-chip attendance-chip--${session.attendanceStatus || "unmarked"}`}>{session.attendanceStatus ? titleCase(session.attendanceStatus) : "Unmarked"}</span>
          </article>
        )) : <EmptyState title="No attendance recorded yet" message="Completed class sessions with attendance will appear here." />}
      </section>
    </div>
  );
}

function SessionRow({ session, onNavigate }: { session: StaffAcademicSessionSummary; onNavigate: (path: RoutePath) => void }) {
  return (
    <article className="table-row academic-session-row">
      <div>
        <strong>{session.batchName} <span className={`status-pill status-pill--${session.status}`}>{titleCase(session.status)}</span></strong>
        <span>{session.trainerName} · {session.sessionDate} · {timeRange(session)}</span>
        <small>{session.presentCount} Present · {session.absentCount} Absent · {session.teachingNoteExcerpt || "No note"} · {session.materialCount} files</small>
      </div>
      <button type="button" className="button-link" onClick={() => onNavigate(`/app/academic/sessions/${session.id}`)}>Open Session</button>
    </article>
  );
}

function BackButton({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  return <button type="button" className="button-link academic-back" onClick={() => onNavigate("/app/academic")}>Back to Academic</button>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function courseLabel(courses: Array<{ name: string }>) {
  if (!courses.length) return "Courses";
  if (courses.length === 1) return courses[0].name;
  return `${courses[0].name} +${courses.length - 1}`;
}

function formatDays(days: string[]) {
  const labels = new Map([
    ["mon", "Mon"],
    ["tue", "Tue"],
    ["wed", "Wed"],
    ["thu", "Thu"],
    ["fri", "Fri"],
    ["sat", "Sat"],
    ["sun", "Sun"],
  ]);
  return days.map((day) => labels.get(day) || day).join(", ");
}

function timeRange(session: Pick<StaffAcademicSessionSummary, "scheduledStartTime" | "scheduledEndTime">) {
  if (!session.scheduledStartTime && !session.scheduledEndTime) return "Unscheduled";
  return `${session.scheduledStartTime || "--:--"}-${session.scheduledEndTime || "--:--"}`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPercent(value: number | null) {
  return value == null ? "-" : `${value}%`;
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
