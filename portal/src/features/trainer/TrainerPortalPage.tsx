import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  getTrainerBatch,
  getTrainerBatches,
  getTrainerClassSession,
  getTrainerSession,
  getTrainerSessions,
  logoutTrainer,
  openTrainerTodaySession,
  saveTrainerClassSession,
  type TrainerBatch,
  type TrainerClassSession,
  type TrainerRosterItem,
  type TrainerSessionResponse,
  type TrainerSessionSummary,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";

type AttendanceStatus = "present" | "absent";
type AttendanceDraft = Record<string, AttendanceStatus | "">;

const trainerNavigation = [
  { path: "/trainer/dashboard" as const, label: "My Batches", shortLabel: "Batches" },
  { path: "/trainer/sessions" as const, label: "Classes", shortLabel: "Classes" },
];

export function TrainerPortalPage({ path, onNavigate }: { path: RoutePath; onNavigate: (path: RoutePath, replace?: boolean) => void }) {
  const [session, setSession] = useState<TrainerSessionResponse | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const batchMatch = path.match(/^\/trainer\/batches\/([^/]+)$/);
  const classMatch = path.match(/^\/trainer\/sessions\/([^/]+)$/);

  useEffect(() => {
    void getTrainerSession()
      .then((next) => {
        setSession(next);
        if (!next.authenticated || !next.activeTrainer) onNavigate("/trainer/login", true);
      })
      .catch(() => setError("Could not check trainer session."))
      .finally(() => setIsChecking(false));
  }, [onNavigate]);

  async function signOut() {
    await logoutTrainer().catch(() => undefined);
    setSession(null);
    onNavigate("/trainer/login", true);
  }

  if (isChecking) {
    return (
      <main className="trainer-shell">
        <LoadingState label="Checking trainer session" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="trainer-shell">
        <ErrorState title="Could not continue" message={error} />
      </main>
    );
  }

  if (!session?.activeTrainer) return null;

  return (
    <main className="trainer-shell">
      <header className="trainer-topbar">
        <div>
          <span className="trainer-eyebrow">Trainer Portal</span>
          <h1>{session.activeTrainer.publicName}</h1>
        </div>
        <button type="button" className="secondary-button" onClick={() => void signOut()}>Sign Out</button>
      </header>
      <nav className="trainer-nav" aria-label="Trainer navigation">
        {trainerNavigation.map((item) => (
          <button key={item.path} type="button" aria-pressed={path === item.path || (item.path === "/trainer/dashboard" && path.startsWith("/trainer/batches/"))} onClick={() => onNavigate(item.path)}>
            <span className="nav-label-full">{item.label}</span>
            <span className="nav-label-short">{item.shortLabel}</span>
          </button>
        ))}
      </nav>
      {path === "/trainer/dashboard" ? <TrainerDashboard onNavigate={onNavigate} /> : null}
      {path === "/trainer/sessions" ? <TrainerSessionHistory onNavigate={onNavigate} /> : null}
      {batchMatch ? <TrainerBatchDetail batchId={batchMatch[1]} onNavigate={onNavigate} /> : null}
      {classMatch ? <TrainerSessionDetail sessionId={classMatch[1]} onNavigate={onNavigate} /> : null}
    </main>
  );
}

function TrainerDashboard({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  const [batches, setBatches] = useState<TrainerBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTrainerBatches("active")
      .then((data) => {
        setBatches(data.batches);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load batches."))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <LoadingState label="Loading your batches" />;
  if (error) return <ErrorState title="Could not load trainer dashboard" message={error} />;

  return (
    <section className="trainer-section">
      <div className="section-heading">
        <h2>My Batches</h2>
        <span>{batches.length}</span>
      </div>
      <div className="trainer-batch-grid">
        {batches.map((batch) => (
          <article className="trainer-batch-card" key={batch.id}>
            <div>
              <strong>{batch.name}</strong>
              <span>{compactCourseLabel(batch)}</span>
              <small>{formatDays(batch.daysOfWeek)} · {batch.startTime}-{batch.endTime}</small>
              <small>{batch.activeStudents} students · {label(batch.status)}</small>
            </div>
            <div className="trainer-card-actions">
              <button type="button" onClick={() => onNavigate(`/trainer/batches/${batch.id}`)}>Open Batch</button>
              {batch.status === "active" ? <button type="button" className="secondary-button" onClick={() => onNavigate(`/trainer/batches/${batch.id}`)}>Take Attendance</button> : null}
            </div>
          </article>
        ))}
        {!batches.length ? <p className="staff-empty">No batches are currently assigned to you.</p> : null}
      </div>
    </section>
  );
}

function TrainerSessionHistory({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTrainerSessions()
      .then((data) => {
        setSessions(data.sessions);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load class history."))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <LoadingState label="Loading class history" />;
  if (error) return <ErrorState title="Could not load class history" message={error} />;

  return (
    <section className="trainer-section">
      <div className="section-heading">
        <h2>Class History</h2>
        <span>{sessions.length}</span>
      </div>
      <div className="trainer-list trainer-session-history-list">
        {sessions.map((session) => (
          <button type="button" className="trainer-row trainer-row-button trainer-session-history-row" key={session.id} onClick={() => onNavigate(`/trainer/sessions/${session.id}`)}>
            <div>
              <strong>{formatDate(session.sessionDate)} · {session.scheduledStartTime || "--:--"}</strong>
              <span>{session.batchName || "Class Session"}{session.courseLabel ? ` · ${session.courseLabel}` : ""}</span>
              <small>{session.presentCount} Present · {session.absentCount} Absent · {label(session.status)}</small>
            </div>
            <small>{session.teachingNoteExcerpt || "No note yet"}</small>
          </button>
        ))}
        {!sessions.length ? <p className="staff-empty">No class sessions recorded yet.</p> : null}
      </div>
    </section>
  );
}

function TrainerBatchDetail({ batchId, onNavigate }: { batchId: string; onNavigate: (path: RoutePath) => void }) {
  const [batch, setBatch] = useState<TrainerBatch | null>(null);
  const [roster, setRoster] = useState<TrainerRosterItem[]>([]);
  const [sessions, setSessions] = useState<Array<TrainerClassSession & { presentCount: number; absentCount: number; teachingNoteExcerpt: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTrainerBatch(batchId)
      .then((data) => {
        setBatch(data.batch);
        setRoster(data.roster);
        setSessions(data.sessions);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load batch."))
      .finally(() => setIsLoading(false));
  }, [batchId]);

  async function startToday() {
    setIsStarting(true);
    setError(null);
    try {
      const data = await openTrainerTodaySession(batchId);
      onNavigate(`/trainer/sessions/${data.session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open today's session.");
    } finally {
      setIsStarting(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading batch" />;
  if (error) return <ErrorState title="Batch unavailable" message={error} />;
  if (!batch) return null;

  return (
    <section className="trainer-section">
      <button type="button" className="link-button trainer-back-link" onClick={() => onNavigate("/trainer/dashboard")}>Back to batches</button>
      <div className="trainer-detail-header">
        <div>
          <h2>{batch.name}</h2>
          <p>{compactCourseLabel(batch)} · {formatDays(batch.daysOfWeek)} · {batch.startTime}-{batch.endTime}</p>
        </div>
        <button type="button" disabled={isStarting || batch.status !== "active"} onClick={() => void startToday()}>
          {isStarting ? "Opening..." : batch.todaySessionId ? "Open Today's Session" : "Start Today's Class"}
        </button>
      </div>
      {batch.status !== "active" ? <div className="notice"><strong>New sessions are available only for active batches.</strong></div> : null}
      <div className="trainer-two-column">
        <section>
          <div className="section-heading"><h3>Roster</h3><span>{roster.length}</span></div>
          <div className="trainer-list">
            {roster.map((student) => (
              <article className="trainer-row" key={student.batchMembershipId}>
                <strong>{student.studentName}</strong>
                <span>{student.studentNumber} · {student.courseName}</span>
                <small>Joined {student.joinedAt.slice(0, 10)}</small>
              </article>
            ))}
            {!roster.length ? <p className="staff-empty">No active students for today's roster.</p> : null}
          </div>
        </section>
        <section>
          <div className="section-heading"><h3>Recent Sessions</h3><span>{sessions.length}</span></div>
          <div className="trainer-list">
            {sessions.map((session) => (
              <button type="button" className="trainer-row trainer-row-button" key={session.id} onClick={() => onNavigate(`/trainer/sessions/${session.id}`)}>
                <strong>{formatDate(session.sessionDate)}</strong>
                <span>{session.presentCount} Present · {session.absentCount} Absent · {label(session.status)}</span>
                <small>{session.teachingNoteExcerpt || "No note yet"}</small>
              </button>
            ))}
            {!sessions.length ? <p className="staff-empty">No class sessions recorded yet.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function TrainerSessionDetail({ sessionId, onNavigate }: { sessionId: string; onNavigate: (path: RoutePath) => void }) {
  const [session, setSession] = useState<TrainerClassSession | null>(null);
  const [batch, setBatch] = useState<TrainerBatch | null>(null);
  const [roster, setRoster] = useState<TrainerRosterItem[]>([]);
  const [draft, setDraft] = useState<AttendanceDraft>({});
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTrainerClassSession(sessionId)
      .then((data) => {
        setSession(data.session);
        setBatch(data.batch);
        setRoster(data.roster);
        setNote(data.session.teachingNote);
        setDraft(Object.fromEntries(data.roster.map((item) => [item.batchMembershipId, item.attendanceStatus === "present" || item.attendanceStatus === "absent" ? item.attendanceStatus : ""])));
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load class session."))
      .finally(() => setIsLoading(false));
  }, [sessionId]);

  const markedCount = useMemo(() => Object.values(draft).filter(Boolean).length, [draft]);
  const canSave = Boolean(session?.canEdit && note.trim() && roster.every((student) => draft[student.batchMembershipId]));

  async function save() {
    if (!session) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const data = await saveTrainerClassSession(session.id, {
        expectedVersion: session.version,
        teachingNote: note,
        attendance: roster.map((student) => ({ batchMembershipId: student.batchMembershipId, status: draft[student.batchMembershipId] as AttendanceStatus })),
      });
      setSession(data.session);
      setRoster(data.roster);
      setNote(data.session.teachingNote);
      setDraft(Object.fromEntries(data.roster.map((item) => [item.batchMembershipId, item.attendanceStatus === "present" || item.attendanceStatus === "absent" ? item.attendanceStatus : ""])));
      setMessage("Session saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save session.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading session" />;
  if (error && !session) return <ErrorState title="Session unavailable" message={error} />;
  if (!session) return null;

  return (
    <section className="trainer-section trainer-session-page">
      <button type="button" className="link-button trainer-back-link" onClick={() => onNavigate(batch ? `/trainer/batches/${batch.id}` : "/trainer/dashboard")}>Back to batch</button>
      <div className="trainer-detail-header">
        <div>
          <h2>{batch?.name || "Class Session"}</h2>
          <p>{formatDate(session.sessionDate)} · {session.scheduledStartTime || ""}-{session.scheduledEndTime || ""} · {label(session.status)}</p>
        </div>
        <span className="status-pill">{markedCount}/{roster.length} marked</span>
      </div>
      {message ? <div className="notice notice--success"><strong>{message}</strong></div> : null}
      {error ? <ErrorState title="Could not save" message={error} /> : null}
      {!session.canEdit ? <div className="notice"><strong>This session is outside the trainer edit window.</strong></div> : null}

      <section className="trainer-attendance-panel">
        <div className="section-heading">
          <h3>Attendance</h3>
          <button type="button" className="secondary-button" disabled={!session.canEdit} onClick={() => setDraft(Object.fromEntries(roster.map((student) => [student.batchMembershipId, "present"])))}>
            Mark All Present
          </button>
        </div>
        <div className="trainer-attendance-list">
          {roster.map((student) => (
            <article className="trainer-attendance-row" key={student.batchMembershipId}>
              <div>
                <strong>{student.studentName}</strong>
                <span>{student.studentNumber} · {student.courseName}</span>
              </div>
              <div className="attendance-toggle" role="group" aria-label={`Attendance for ${student.studentName}`}>
                <button type="button" disabled={!session.canEdit} aria-pressed={draft[student.batchMembershipId] === "present"} onClick={() => setDraft((current) => ({ ...current, [student.batchMembershipId]: "present" }))}>Present</button>
                <button type="button" disabled={!session.canEdit} aria-pressed={draft[student.batchMembershipId] === "absent"} onClick={() => setDraft((current) => ({ ...current, [student.batchMembershipId]: "absent" }))}>Absent</button>
              </div>
            </article>
          ))}
          {!roster.length ? <p className="staff-empty">No students were eligible for this session date.</p> : null}
        </div>
      </section>

      <label className="trainer-note-field">
        What was taught today?
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={!session.canEdit} placeholder="Example: Power BI relationships and basic DAX measures." />
      </label>
      <div className="form-actions">
        <button type="button" disabled={!canSave || isSaving} onClick={() => void save()}>{isSaving ? "Saving..." : "Save Session"}</button>
      </div>
    </section>
  );
}

function compactCourseLabel(batch: TrainerBatch) {
  const courses = batch.courses.length ? batch.courses : [{ id: batch.courseId, name: batch.courseName }];
  return courses.map((course) => course.name).join(" / ");
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
  return days.map((day) => labels.get(day) || day).join(" / ");
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : value;
}

function label(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}
