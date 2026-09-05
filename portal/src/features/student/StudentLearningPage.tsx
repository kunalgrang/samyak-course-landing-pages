import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getStudentLearningDetail,
  getStudentLearningEnrolments,
  studentMaterialContentUrl,
  type SessionMaterial,
  type StudentLearningDetail,
  type StudentLearningEnrolment,
} from "../../lib/api";

const PAGE_SIZE = 20;

export function StudentLearningPage() {
  const [enrolments, setEnrolments] = useState<StudentLearningEnrolment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<StudentLearningDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStudentLearningEnrolments()
      .then((data) => {
        setEnrolments(data.enrolments);
        setSelectedId(data.enrolments[0]?.enrolmentId || "");
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load learning records."))
      .finally(() => setIsLoadingList(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setIsLoadingDetail(true);
    void getStudentLearningDetail(selectedId, { limit: PAGE_SIZE, offset })
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load class history."))
      .finally(() => setIsLoadingDetail(false));
  }, [selectedId, offset]);

  const selected = useMemo(() => enrolments.find((item) => item.enrolmentId === selectedId) || null, [enrolments, selectedId]);

  if (isLoadingList) return <LoadingState label="Loading learning" />;
  if (error && !detail && !enrolments.length) return <ErrorState title="Learning unavailable" message={error} />;

  return (
    <div className="content-stack student-learning-page">
      <header className="overview-hero">
        <div>
          <h1>Learning</h1>
          <p>Classes, attendance and PDFs shared by your trainer.</p>
        </div>
      </header>

      {enrolments.length === 0 ? (
        <EmptyState title="No courses found" message="Your academic history will appear here after your enrolment is available." />
      ) : (
        <>
          {enrolments.length > 1 ? (
            <label className="student-learning-selector">
              Course
              <select
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setOffset(0);
                }}
              >
                {enrolments.map((item) => (
                  <option value={item.enrolmentId} key={item.enrolmentId}>
                    {item.courseName} · {label(item.status)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <section className="student-learning-grid" aria-label="Academic overview">
            <CurrentBatchCard enrolment={selected} />
            <AttendanceCard detail={detail} isLoading={isLoadingDetail} />
          </section>

          {error ? <ErrorState title="Could not refresh learning" message={error} /> : null}
          {isLoadingDetail ? <LoadingState label="Loading class history" /> : null}
          {detail && !isLoadingDetail ? <SessionHistory detail={detail} offset={offset} onOffsetChange={setOffset} /> : null}
        </>
      )}
    </div>
  );
}

function CurrentBatchCard({ enrolment }: { enrolment: StudentLearningEnrolment | null }) {
  if (!enrolment) return null;
  return (
    <section className="learning-card" aria-labelledby="current-batch-title">
      <span className="field-label">Current course</span>
      <h2 id="current-batch-title">{enrolment.courseName}</h2>
      <dl className="learning-detail-list">
        <div><dt>Course code</dt><dd>{enrolment.courseCode || "—"}</dd></div>
        <div><dt>Enrolment</dt><dd>{enrolment.enrolmentNumber}</dd></div>
        <div><dt>Joining date</dt><dd>{formatDate(enrolment.joiningDate)}</dd></div>
        <div><dt>Status</dt><dd>{label(enrolment.status)}</dd></div>
      </dl>
      {enrolment.currentBatch ? (
        <div className="learning-batch-box">
          <strong>{enrolment.currentBatch.name}</strong>
          <span>{enrolment.currentBatch.trainerName || "Trainer not assigned"}</span>
          <small>{formatDays(enrolment.currentBatch.daysOfWeek)} · {enrolment.currentBatch.startTime}-{enrolment.currentBatch.endTime}</small>
        </div>
      ) : (
        <p className="staff-empty">No batch assigned yet.</p>
      )}
    </section>
  );
}

function AttendanceCard({ detail, isLoading }: { detail: StudentLearningDetail | null; isLoading: boolean }) {
  const summary = detail?.summary;
  return (
    <section className="learning-card" aria-labelledby="attendance-summary-title">
      <span className="field-label">Attendance</span>
      <h2 id="attendance-summary-title">{summary?.attendancePercent === null || !summary ? "—" : `${summary.attendancePercent}%`}</h2>
      {isLoading ? <small>Loading attendance...</small> : null}
      {summary ? (
        <div className="learning-metrics">
          <Metric label="Classes" value={summary.totalClasses} />
          <Metric label="Present" value={summary.present} />
          <Metric label="Absent" value={summary.absent} />
        </div>
      ) : null}
      {summary?.totalClasses === 0 ? <p className="staff-empty">No attendance recorded yet.</p> : null}
    </section>
  );
}

function SessionHistory({ detail, offset, onOffsetChange }: { detail: StudentLearningDetail; offset: number; onOffsetChange: (offset: number) => void }) {
  return (
    <section className="content-stack" aria-labelledby="class-history-title">
      <div className="section-heading">
        <h2 id="class-history-title">Class history</h2>
        <span>{detail.sessions.length}</span>
      </div>
      {detail.sessions.length === 0 ? (
        <EmptyState title="No classes logged yet" message="Completed class sessions will appear here after your trainer saves attendance." />
      ) : (
        <div className="student-session-list">
          {detail.sessions.map((session) => (
            <article className="student-session-card" key={session.id}>
              <div className="student-session-card__header">
                <div>
                  <strong>{formatDate(session.sessionDate)}</strong>
                  <span>{session.batchName}</span>
                </div>
                <span className={`attendance-chip attendance-chip--${session.attendanceStatus || "unmarked"}`}>{label(session.attendanceStatus || "not_marked")}</span>
              </div>
              <dl className="learning-detail-list">
                <div><dt>Trainer</dt><dd>{session.trainerName || "—"}</dd></div>
                <div><dt>Timing</dt><dd>{session.scheduledStartTime || "—"}-{session.scheduledEndTime || "—"}</dd></div>
              </dl>
              <div className="learning-note">
                <span className="field-label">What was taught</span>
                <p>{session.teachingNote || "No teaching note was recorded."}</p>
              </div>
              <MaterialList materials={session.materials} />
            </article>
          ))}
        </div>
      )}
      <div className="certificate-pagination">
        <button type="button" className="secondary-button" disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
        <span>{offset + 1}-{offset + detail.sessions.length}</span>
        <button type="button" className="secondary-button" disabled={!detail.pagination.hasMore} onClick={() => onOffsetChange(offset + PAGE_SIZE)}>Next</button>
      </div>
    </section>
  );
}

function MaterialList({ materials }: { materials: SessionMaterial[] }) {
  if (!materials.length) return <p className="staff-empty">No PDFs shared for this class.</p>;
  return (
    <div className="student-material-list" aria-label="Session PDFs">
      {materials.map((material) => (
        <a className="student-material-link" href={studentMaterialContentUrl(material.id)} target="_blank" rel="noreferrer" key={material.id}>
          <span>View PDF: {material.title}</span>
          <small>{materialTypeLabel(material.materialType)} · {formatBytes(material.sizeBytes)}</small>
        </a>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
  return days.map((day) => labels.get(day) || day).join(" / ") || "Days not set";
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : value;
}

function label(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function materialTypeLabel(value: string) {
  if (value === "notes") return "Notes";
  if (value === "homework") return "Homework";
  return "Study Material";
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
