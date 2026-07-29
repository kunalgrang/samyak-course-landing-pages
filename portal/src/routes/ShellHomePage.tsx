import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import type { ReferralDashboard } from "../lib/api";
import { buildWhatsAppShareUrl, copyReferralLink, firstName, formatIndianCurrency, recentReferrals } from "../features/referrals/referralUtils";
import { useReferralDashboard } from "../features/referrals/useReferralDashboard";
import { useEffect, useState } from "react";

export function ShellHomePage() {
  const { dashboard, error } = useReferralDashboard();
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  async function handleCopy(personalLink: string) {
    await copyReferralLink(personalLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function handleNativeShare(dashboard: ReferralDashboard) {
    if (!navigator.share) return;
    await navigator.share({
      title: "Samyak Skill Circle",
      text: "Refer your friends to Samyak Computer Classes.",
      url: dashboard.profile.personalLink,
    });
  }

  if (error) {
    return <ErrorState title="Could not load referrals" message="We could not load your referral information. Please try again." />;
  }

  if (!dashboard) {
    return <LoadingState label="Loading your referral information" />;
  }

  return (
    <OverviewContent
      dashboard={dashboard}
      copied={copied}
      canShare={canShare}
      onCopy={() => void handleCopy(dashboard.profile.personalLink)}
      onNativeShare={() => void handleNativeShare(dashboard)}
    />
  );
}

export function OverviewContent({
  dashboard,
  copied,
  canShare,
  onCopy,
  onNativeShare,
}: {
  dashboard: ReferralDashboard;
  copied: boolean;
  canShare: boolean;
  onCopy: () => void;
  onNativeShare: () => void;
}) {
  const referrals = recentReferrals(dashboard);
  const whatsAppUrl = buildWhatsAppShareUrl(dashboard.profile.personalLink);

  return (
    <div className="content-stack">
      <header className="overview-hero">
        <div>
          <h1>Hi, {firstName(dashboard.profile.fullName || dashboard.profile.publicName)} 👋</h1>
          <p>Refer your friends to Samyak and earn up to ₹1,500 cash or ₹2,000 course credit.</p>
        </div>
        <a className="button-link button-link--primary" href="/app/referrals">
          Share Referral Link
        </a>
      </header>

      <section className="link-panel link-panel--feature" aria-label="Personal referral link">
        <div>
          <span className="field-label">Personal referral link</span>
          <strong>{dashboard.profile.personalLink}</strong>
          <p>Your friend can submit a course enquiry through this personal link.</p>
        </div>
        <div className="link-actions">
          <button type="button" onClick={onCopy}>
            {copied ? "Copied" : "Copy Link"}
          </button>
          {canShare ? (
            <button type="button" className="button-secondary" onClick={onNativeShare}>
              Share
            </button>
          ) : null}
          <a className="button-link" href={whatsAppUrl} target="_blank" rel="noreferrer">
            Share on WhatsApp
          </a>
        </div>
        <p className="copy-feedback" aria-live="polite">
          {copied ? "Referral link copied." : ""}
        </p>
      </section>

      <section className="metric-grid" aria-label="Referral summary">
        <Metric label="Total referrals" value={dashboard.summary.totalReferrals} />
        <Metric label="Successful admissions" value={dashboard.summary.successfulAdmissions} />
        <Metric label="Cash rewards earned" value={formatIndianCurrency(dashboard.summary.cashRewardsEarned)} />
        <Metric label="Course credit earned" value={formatIndianCurrency(dashboard.summary.courseCreditEarned)} />
      </section>

      <section className="content-stack" aria-labelledby="recent-referrals-title">
        <div className="section-heading">
          <h2 id="recent-referrals-title">Recent referrals</h2>
          <a href="/app/referrals">View all</a>
        </div>
        {referrals.length === 0 ? (
          <EmptyState title="No referrals yet" message="Share your personal link with a friend who may benefit from learning a new skill." />
        ) : (
          <div className="referral-list">
            {referrals.map((referral) => (
              <article className="referral-row" key={referral.referralId}>
                <div>
                  <strong>{referral.prospectPublicName}</strong>
                  <span>{referral.courseInterested || "Course not selected"}</span>
                </div>
                <div>
                  <strong>{referral.publicStatus}</strong>
                  <span>{referral.submissionDate || "Date not available"}</span>
                </div>
                <div>
                  <strong>{referral.rewardStatus || "Reward pending"}</strong>
                  <span>{referral.rewardChoice || "Choice pending"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="how-it-works" aria-labelledby="how-it-works-title">
        <h2 id="how-it-works-title">How it works</h2>
        <ol>
          <li>Share your personal link</li>
          <li>Your friend submits an enquiry</li>
          <li>Your friend joins an eligible course</li>
          <li>You receive cash or course credit</li>
        </ol>
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
