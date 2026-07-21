import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";

export function ShellHomePage() {
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>Overview</h1>
        <p>Secure student access, profile switching, referrals, and rules will live here.</p>
      </header>
      <div className="status-grid">
        <section className="status-panel">
          <h2>Portal foundation</h2>
          <p>Application shell, API health routes, and D1 schema are in place for Phase 1.</p>
        </section>
        <section className="status-panel">
          <h2>Authentication</h2>
          <LoadingState label="Temporary client guard active" />
        </section>
      </div>
      <EmptyState
        title="No dashboard data yet"
        message="Financial, referral, and personal records are deliberately not mocked in this pass."
      />
    </div>
  );
}
