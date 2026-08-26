import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { generateReferralLink, type ReferralDashboard } from "../../lib/api";
import { copyReferralLink, formatIndianCurrency } from "./referralUtils";
import { useReferralDashboard } from "./useReferralDashboard";

export function ReferralsPage() {
  const { dashboard, error } = useReferralDashboard();
  const [copied, setCopied] = useState(false);
  const [oneTimeLink, setOneTimeLink] = useState<string>("");
  const [linkMessage, setLinkMessage] = useState<string>("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");

  async function handleCopy(personalLink: string) {
    if (!personalLink) return;
    await copyReferralLink(personalLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function handleGenerate() {
    setLinkBusy(true);
    setLinkError("");
    try {
      const result = await generateReferralLink();
      if (result.created) {
        setOneTimeLink(result.link);
        setLinkMessage("Your referral link is ready to copy or open.");
      } else {
        setOneTimeLink("");
        setLinkMessage(result.message);
      }
    } catch (reason) {
      setLinkError(reason instanceof Error ? reason.message : "Could not generate referral link.");
    } finally {
      setLinkBusy(false);
    }
  }

  if (error) {
    return <ErrorState title="Could not load referrals" message="We could not load your referral information. Please try again." />;
  }

  if (!dashboard) {
    return <LoadingState label="Loading your referrals" />;
  }

  return (
    <ReferralsContent
      dashboard={dashboard}
      copied={copied}
      onCopy={(link) => void handleCopy(link)}
      oneTimeLink={oneTimeLink}
      linkMessage={linkMessage}
      linkBusy={linkBusy}
      linkError={linkError}
      onGenerate={() => void handleGenerate()}
    />
  );
}

export function ReferralsContent({
  dashboard,
  copied,
  onCopy,
  oneTimeLink = "",
  linkMessage = "",
  linkBusy = false,
  linkError = "",
  onGenerate,
}: {
  dashboard: ReferralDashboard;
  copied: boolean;
  onCopy: (link: string) => void;
  oneTimeLink?: string;
  linkMessage?: string;
  linkBusy?: boolean;
  linkError?: string;
  onGenerate?: () => void;
}) {
  const linkStatus = dashboard.linkStatus;
  const shareableLink = oneTimeLink || linkStatus.publicUrl || "";

  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>My Referrals</h1>
        <p>Track your friends' enquiries, admissions and referral rewards.</p>
      </header>

      <section className="link-panel" aria-label="Your Referral Link">
        <div>
          <span className="field-label">Your Referral Link</span>
          {shareableLink ? (
            <>
              <strong>{shareableLink}</strong>
              <p>{linkMessage || linkStatus.message}</p>
            </>
          ) : linkStatus.hasActiveLink ? (
            <>
              <strong>Active link ending {linkStatus.lastFour ? `...${linkStatus.lastFour}` : "with hidden token"}</strong>
              <p>{linkStatus.message} {linkStatus.activatedAt ? `Activated ${linkStatus.activatedAt.slice(0, 10)}.` : ""}</p>
            </>
          ) : (
            <>
              <strong>No active referral link</strong>
              <p>{linkStatus.message}</p>
            </>
          )}
          {linkError ? <p className="form-alert">{linkError}</p> : null}
        </div>
        <div className="link-actions">
          {shareableLink ? <button type="button" onClick={() => onCopy(shareableLink)}>
            {copied ? "Copied" : "Copy Link"}
          </button> : null}
          {shareableLink ? <a className="button-link" href={shareableLink} target="_blank" rel="noreferrer">
            Open Link
          </a> : null}
          {!shareableLink && linkStatus.canGenerate ? <button type="button" disabled={linkBusy} onClick={onGenerate}>{linkBusy ? "Generating..." : "Generate referral link"}</button> : null}
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

      <section className="content-stack" aria-labelledby="referral-list-title">
        <div className="section-heading">
          <h2 id="referral-list-title">Referral status</h2>
          <a href="/app/rules">Rewards & Benefits</a>
        </div>
        {dashboard.referrals.length === 0 ? (
          <EmptyState title="No referrals yet" message="Share your personal link with a friend who may benefit from learning a new skill." />
        ) : (
          <div className="referral-list">
            {dashboard.referrals.map((referral) => (
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
