import { EmptyState } from "../../components/EmptyState";

export function ReferralsPage() {
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>Referrals</h1>
        <p>Referral dashboard access will be backed by the existing Sheet bridge in a later pass.</p>
      </header>
      <EmptyState
        title="Referral data is not connected yet"
        message="The live Google Sheet referral system remains unchanged and is not surfaced in this pass."
      />
    </div>
  );
}
