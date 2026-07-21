import { EmptyState } from "../components/EmptyState";

export function RulesPage() {
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>Rules</h1>
        <p>Referral rules and eligibility copy will be loaded from approved operations content.</p>
      </header>
      <EmptyState
        title="Rules are not published here yet"
        message="This shell avoids duplicating or drifting from the live referral operations source."
      />
    </div>
  );
}
