import { EmptyState } from "../../components/EmptyState";

export function ProfilePage() {
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>Profile</h1>
        <p>Personal profile details will appear after secure mobile login and person linking.</p>
      </header>
      <EmptyState
        title="No profile loaded"
        message="Coding Pass 1 does not seed people, mobile numbers, or personal data."
      />
    </div>
  );
}
