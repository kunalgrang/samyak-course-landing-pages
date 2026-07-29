import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { selectProfile, type ReferralDashboard, type SessionResponse } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { maskedMobileFromLastFour, memberTypeLabel, programmeStatus } from "../referrals/referralUtils";
import { useReferralDashboard } from "../referrals/useReferralDashboard";

export function ProfilePage() {
  const { session, setAuthenticatedSession } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const { dashboard, error } = useReferralDashboard(refreshKey);
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
    return <ErrorState title="Could not load profile" message="We could not load your referral information. Please try again." />;
  }

  if (!dashboard || !session?.activeProfile) {
    return <LoadingState label="Loading your profile" />;
  }

  return (
    <ProfileContent
      dashboard={dashboard}
      session={session}
      switchingPersonId={switchingPersonId}
      switchError={switchError}
      onSwitch={(personId) => void handleSwitch(personId)}
    />
  );
}

export function ProfileContent({
  dashboard,
  session,
  switchingPersonId,
  switchError,
  onSwitch,
}: {
  dashboard: ReferralDashboard;
  session: SessionResponse;
  switchingPersonId: string | null;
  switchError: boolean;
  onSwitch: (personId: string) => void;
}) {
  const profile = dashboard.profile;
  const memberType = memberTypeLabel(profile.referrerType);
  const activePersonId = session.activeProfile?.personId;

  return (
    <div className="content-stack profile-page">
      <header className="profile-header">
        <div>
          <h1>{profile.fullName}</h1>
          <div className="badge-row" aria-label="Profile badges">
            <span>{memberType}</span>
            <span>{programmeStatus(profile.active)}</span>
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
        <ProfileField label="Full name" value={profile.fullName} />
        <ProfileField label="Course studied" value={profile.courseStudied || "Course information not available"} />
        <ProfileField label="Member type" value={memberType} />
        <ProfileField label="Member since" value={profile.memberSince || "Not available"} />
        <ProfileField label="Registered mobile" value={maskedMobileFromLastFour(session.mobileLastFour)} />
        <ProfileField label="Referral programme status" value={programmeStatus(profile.active)} />
        <ProfileField label="Personal referral link" value={profile.personalLink} wrap />
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
