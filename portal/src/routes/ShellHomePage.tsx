import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../features/auth/AuthContext";
import { firstName } from "../features/referrals/referralUtils";
import { useStudentHome } from "../features/student/useStudentHome";
import type { StudentHome } from "../lib/api";

export function ShellHomePage() {
  const { session } = useAuth();
  const hasStudentProfile = session?.activeProfile?.hasStudentProfile ?? true;
  const { home, error } = useStudentHome(0, hasStudentProfile);

  if (!hasStudentProfile) {
    return <ReferralOnlyHome publicName={session?.activeProfile?.publicName || "there"} />;
  }

  if (error) {
    return <ErrorState title="Could not load dashboard" message="We could not load your student information. Please try again." />;
  }

  if (!home) {
    return <LoadingState label="Loading your student dashboard" />;
  }

  return <OverviewContent home={home} />;
}

function ReferralOnlyHome({ publicName }: { publicName: string }) {
  return (
    <div className="content-stack">
      <header className="overview-hero">
        <div>
          <h1>Hi, {firstName(publicName)}</h1>
          <p>Welcome back to Samyak Skill Circle.</p>
        </div>
        <a className="button-link button-link--primary" href="/app/referrals">
          My Referrals
        </a>
      </header>

      <section className="link-panel link-panel--feature" aria-label="Samyak Skill Circle">
        <div>
          <span className="field-label">Samyak Skill Circle</span>
          <strong>Referral dashboard ready</strong>
          <p>Your referral tools and activity are available in My Referrals.</p>
        </div>
        <div className="link-actions">
          <a className="button-link" href="/app/referrals">
            Open Referrals
          </a>
        </div>
      </section>
    </div>
  );
}

export function OverviewContent({ home }: { home: StudentHome }) {
  const recentCourses = home.courseHistory.slice(0, 3);
  const currentCourses = home.courseHistory.filter((course) => ["active", "on_hold", "confirmed", "not_started"].includes(course.status)).length;

  return (
    <div className="content-stack">
      <header className="overview-hero">
        <div>
          <h1>Hi, {firstName(home.identity.fullName || home.identity.publicName)}</h1>
          <p>
            {home.identity.studentId} - {studentStatusLabel(home.identity.lifecycleStatus, home.identity.studentStatus)}
          </p>
        </div>
        <a className="button-link button-link--primary" href="/app/referrals">
          My Referrals
        </a>
      </header>

      <section className="metric-grid" aria-label="Student summary">
        <Metric label="Student ID" value={home.identity.studentId} />
        <Metric label="Status" value={home.identity.lifecycleStatus} />
        <Metric label="Courses" value={home.courseHistory.length} />
        <Metric label="Current courses" value={currentCourses} />
      </section>

      <section className="link-panel link-panel--feature" aria-label="Samyak Skill Circle">
        <div>
          <span className="field-label">{home.skillCircle.programmeName}</span>
          <strong>{home.skillCircle.hasActiveReferralLink ? "Referral link active" : "Referral dashboard ready"}</strong>
          <p>{home.skillCircle.message}</p>
        </div>
        <div className="link-actions">
          <a className="button-link" href={home.skillCircle.referralDashboardPath}>
            Open Referrals
          </a>
        </div>
      </section>

      <section className="content-stack" aria-labelledby="course-history-title">
        <div className="section-heading">
          <h2 id="course-history-title">Course history</h2>
          <a href="/app/profile">Profile</a>
        </div>
        {recentCourses.length === 0 ? (
          <EmptyState title="No courses found" message="Your imported course history will appear here after it is available." />
        ) : (
          <div className="student-course-list">
            {recentCourses.map((course) => (
              <article className="student-course-row" key={course.enrolmentId}>
                <div>
                  <strong>{course.courseName}</strong>
                  <span>{course.courseCode || "Course code unavailable"}</span>
                </div>
                <div>
                  <strong>{courseStatusLabel(course.status)}</strong>
                  <span>{course.joiningDate || course.admissionDate || "Date not available"}</span>
                </div>
                <div>
                  <strong>{course.enrolmentNumber}</strong>
                  <span>{course.durationLabel || "Duration not available"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
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

function studentStatusLabel(lifecycleStatus: string, status: string) {
  const label = courseStatusLabel(status);
  return lifecycleStatus === "CURRENT" ? `Current student - ${label}` : `Alumni - ${label}`;
}

function courseStatusLabel(status: string) {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
