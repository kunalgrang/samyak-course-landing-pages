import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { selectProfile, type SessionResponse, type StudentHome } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { maskedMobileFromLastFour, memberTypeLabel } from "../referrals/referralUtils";
import { useStudentHome } from "../student/useStudentHome";

export function ProfilePage() {
  const { session, setAuthenticatedSession } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const { home, error } = useStudentHome(refreshKey);
  const [switchError, setSwitchError] = useState(false);
  const [switchingPersonId, setSwitchingPersonId] = useState<string | null>(null);

  async function handleSwitch(personId: string) {
    if (personId === session?.activeProfile?.personId) return;
    setSwitchError(false);
    setSwitchingPersonId(personId);
    try {
      const result = await selectProfile(personId);
      if (!result.success || !result.session) {
        setSwitchError(true);
        return;
      }
      setAuthenticatedSession(result.session);
      setRefreshKey((value) => value + 1);
    } catch {
      setSwitchError(true);
    } finally {
      setSwitchingPersonId(null);
    }
  }

  if (error) {
    return <ErrorState title="Could not load profile" message="We could not load your student information. Please try again." />;
  }

  if (!home || !session?.activeProfile) {
    return <LoadingState label="Loading your profile" />;
  }

  return (
    <ProfileContent
      home={home}
      session={session}
      switchingPersonId={switchingPersonId}
      switchError={switchError}
      onSwitch={(personId) => void handleSwitch(personId)}
    />
  );
}

export function ProfileContent({
  home,
  session,
  switchingPersonId,
  switchError,
  onSwitch,
}: {
  home: StudentHome;
  session: SessionResponse;
  switchingPersonId: string | null;
  switchError: boolean;
  onSwitch: (personId: string) => void;
}) {
  const activePersonId = session.activeProfile?.personId;
  const memberType = memberTypeLabel(session.activeProfile?.roles.join(" ") || home.identity.lifecycleStatus);

  return (
    <div className="content-stack profile-page">
      <header className="profile-header">
        <div>
          <h1>{home.identity.fullName}</h1>
          <div className="badge-row" aria-label="Profile badges">
            <span>{memberType}</span>
            <span>{home.identity.lifecycleStatus}</span>
          </div>
        </div>
      </header>

      {session.profiles.length > 1 ? (
        <section className="profile-switcher" aria-labelledby="profile-switcher-title">
          <h2 id="profile-switcher-title">Active profile</h2>
          <div className="profile-choice-list">
            {session.profiles.map((choice) => (
              <button
                key={choice.personId}
                type="button"
                className="profile-choice"
                aria-pressed={choice.personId === activePersonId}
                disabled={switchingPersonId === choice.personId}
                onClick={() => onSwitch(choice.personId)}
              >
                <span>{choice.publicName}</span>
                <small>{choice.personId === activePersonId ? "Active" : memberTypeLabel(choice.roles.join(" "))}</small>
              </button>
            ))}
          </div>
          {switchError ? <ErrorState title="Could not switch profile" message="Please try again." /> : null}
        </section>
      ) : null}

      <section className="profile-details" aria-labelledby="profile-details-title">
        <h2 id="profile-details-title">My Profile</h2>
        <ProfileField label="Full name" value={home.identity.fullName} />
        <ProfileField label="Student ID" value={home.identity.studentId} />
        <ProfileField label="Status" value={statusLabel(home.identity.studentStatus)} />
        <ProfileField label="Branch" value={home.identity.branchName || "Not available"} />
        <ProfileField label="Student since" value={home.identity.studentSince || "Not available"} />
        <ProfileField label="Registered mobile" value={maskedMobileFromLastFour(session.mobileLastFour)} />
        <ProfileField label="Referral programme" value={home.skillCircle.programmeName} />
      </section>

      <section className="profile-details" aria-labelledby="profile-courses-title">
        <h2 id="profile-courses-title">Course History</h2>
        {home.courseHistory.length === 0 ? (
          <ProfileField label="Courses" value="No course history available" />
        ) : (
          home.courseHistory.map((course) => (
            <ProfileField
              key={course.enrolmentId}
              label={course.courseCode || "Course"}
              value={`${course.courseName} - ${statusLabel(course.status)}`}
              wrap
            />
          ))
        )}
      </section>
    </div>
  );
}

function ProfileField({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className={wrap ? "profile-field profile-field--wrap" : "profile-field"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusLabel(status: string) {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
