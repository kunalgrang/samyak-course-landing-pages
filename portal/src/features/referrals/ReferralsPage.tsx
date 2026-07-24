import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getReferralDashboard, type ReferralDashboard } from "../../lib/api";

export function ReferralsPage() {
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getReferralDashboard()
      .then((data) => {
        setDashboard(data);
        setError(null);
      })
      .catch(() => setError("Referral dashboard is temporarily unavailable."));
  }, []);

  async function copyLink() {
    if (!dashboard) return;
    await navigator.clipboard.writeText(dashboard.profile.personalLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (error) {
    return <ErrorState title="Could not load referrals" message={error} />;
  }

  if (!dashboard) {
    return <LoadingState label="Loading referral dashboard" />;
  }

  const shareText = encodeURIComponent(
    `Hi, I am sharing my Samyak referral link. Please use this link to enquire at Samyak Computer Classes: ${dashboard.profile.personalLink}`,
  );

  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>Referrals</h1>
        <p>{dashboard.profile.publicName}</p>
      </header>

      <section className="link-panel" aria-label="Personal referral link">
        <div>
          <span className="field-label">Personal link</span>
          <strong>{dashboard.profile.personalLink}</strong>
        </div>
        <div className="link-actions">
          <button type="button" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <a className="button-link" href={`https://wa.me/?text=${shareText}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        </div>
      </section>

      <section className="metric-grid" aria-label="Referral summary">
        <Metric label="Total referrals" value={dashboard.summary.totalReferrals} />
        <Metric label="Successful admissions" value={dashboard.summary.successfulAdmissions} />
        <Metric label="Cash rewards earned" value={dashboard.summary.cashRewardsEarned} prefix="Rs. " />
        <Metric label="Course credit earned" value={dashboard.summary.courseCreditEarned} prefix="Rs. " />
      </section>

      <section className="content-stack" aria-label="Referral status list">
        <div className="section-heading">
          <h2>Status list</h2>
          <a href="/app/rules">Programme rules</a>
        </div>
        {dashboard.referrals.length === 0 ? (
          <EmptyState title="No referrals yet" message="Share your personal link when someone asks about Samyak courses." />
        ) : (
          <div className="referral-list">
            {dashboard.referrals.map((referral) => (
              <article className="referral-row" key={referral.referralId}>
                <div>
                  <strong>{referral.prospectPublicName}</strong>
                  <span>{referral.courseInterested}</span>
                </div>
                <div>
                  <strong>{referral.publicStatus}</strong>
                  <span>{referral.submissionDate}</span>
                </div>
                <div>
                  <strong>{referral.rewardStatus || "Pending"}</strong>
                  <span>{referral.rewardChoice || "Reward choice pending"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, prefix = "" }: { label: string; value: number; prefix?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {prefix}
        {value}
      </strong>
    </div>
  );
}
