import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getOrganisationOnboarding, type OrganisationOnboarding } from "../../lib/api";

type OnboardingData = OrganisationOnboarding;

export function OrganisationOnboardingPage() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await getOrganisationOnboarding();
        if (active) setData(result);
      } catch (reason) {
        if (active) setLoadError(errorMessage(reason));
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const doneCount = useMemo(() => data?.onboarding.checklist.filter((item) => item.done).length || 0, [data]);
  const totalCount = data?.onboarding.checklist.length || 0;
  const trialStatus = data ? trialStatusText(data.trial.state, data.trial.endsAt) : null;

  if (isLoading) return <LoadingState label="Loading onboarding" />;
  if (loadError) return <ErrorState title="Could not load onboarding" message={loadError} />;
  if (!data) return <ErrorState title="Could not load onboarding" message="Onboarding details are unavailable." />;

  return (
    <div className="content-stack staff-enquiries-page organisation-onboarding-page">
      <header className="page-header">
        <h1>Organisation Onboarding</h1>
        <p>Owner setup progress for your trial organisation.</p>
      </header>

      <section className="metric-grid" aria-label="Trial status">
        <article className="metric">
          <span>{trialStatus?.label}</span>
          <strong>{trialStatus?.value}</strong>
        </article>
        <article className="metric">
          <span>{trialStatus?.dateLabel}</span>
          <strong>{trialStatus?.dateValue}</strong>
        </article>
        <article className="metric">
          <span>Setup progress</span>
          <strong>{doneCount}/{totalCount}</strong>
        </article>
      </section>

      <section className="content-stack" aria-labelledby="setup-progress-title">
        <div className="section-heading">
          <h2 id="setup-progress-title">Setup progress</h2>
          <span>{label(data.onboarding.status)}</span>
        </div>
        <div className="onboarding-checklist">
          {data.onboarding.checklist.map((item) => (
            <div className={item.done ? "onboarding-checklist__item onboarding-checklist__item--done" : "onboarding-checklist__item"} key={item.code}>
              <span aria-hidden="true">{item.done ? "✓" : "○"}</span>
              <strong>{item.label}</strong>
            </div>
          ))}
        </div>
      </section>

      {data.onboarding.reportedCentreCount && data.onboarding.reportedCentreCount > 1 ? (
        <div className="notice">
          <strong>Additional Centres</strong>
          <p>You reported {data.onboarding.reportedCentreCount} Centres. Additional Centres can be configured from Organisation Settings when you are ready.</p>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function trialStatusText(state: string, endsAt: string) {
  if (state === "trial") {
    return {
      label: "15-day trial",
      value: "Trial",
      dateLabel: "Active until",
      dateValue: formatDate(endsAt),
    };
  }
  return {
    label: "Commercial status",
    value: label(state),
    dateLabel: "Trial ended",
    dateValue: formatDate(endsAt),
  };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}
