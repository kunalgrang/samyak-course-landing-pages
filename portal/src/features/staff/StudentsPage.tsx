import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getStaffStudents, type StaffStudentDirectory, type StaffStudentDirectoryItem } from "../../lib/api";

export type StudentDirectoryStatus = "all" | "current" | "alumni";

const statusOptions: Array<{ value: StudentDirectoryStatus; label: string }> = [
  { value: "all", label: "All Students" },
  { value: "current", label: "Current" },
  { value: "alumni", label: "Alumni" },
];

const pageSize = 25;

export function StudentsPage() {
  const [status, setStatus] = useState<StudentDirectoryStatus>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [directory, setDirectory] = useState<StaffStudentDirectory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    void getStaffStudents({ status, search, limit: pageSize, offset })
      .then((data) => {
        setDirectory(data);
        setError(null);
      })
      .catch((reason) => {
        setDirectory(null);
        setError(reason instanceof Error ? reason.message : "Could not load students.");
      })
      .finally(() => setIsLoading(false));
  }, [offset, search, status]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchDraft.trim());
  }

  function changeStatus(nextStatus: StudentDirectoryStatus) {
    setStatus(nextStatus);
    setOffset(0);
  }

  return (
    <StudentDirectoryContent
      directory={directory}
      error={error}
      isLoading={isLoading}
      searchDraft={searchDraft}
      status={status}
      onSearchDraftChange={setSearchDraft}
      onSearchSubmit={submitSearch}
      onStatusChange={changeStatus}
      onNextPage={() => setOffset((current) => current + pageSize)}
      onPreviousPage={() => setOffset((current) => Math.max(current - pageSize, 0))}
    />
  );
}

export function StudentDirectoryContent({
  directory,
  error,
  isLoading,
  searchDraft,
  status,
  onSearchDraftChange,
  onSearchSubmit,
  onStatusChange,
  onNextPage,
  onPreviousPage,
}: {
  directory: StaffStudentDirectory | null;
  error: string | null;
  isLoading: boolean;
  searchDraft: string;
  status: StudentDirectoryStatus;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent) => void;
  onStatusChange: (status: StudentDirectoryStatus) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
}) {
  const total = directory?.pagination.total || 0;
  const hasSearch = Boolean(directory?.filters.search);
  const emptyMessage = emptyStateMessage(status, hasSearch);

  return (
    <div className="content-stack staff-enquiries-page students-page">
      <header className="page-header">
        <h1>Students</h1>
        <p>Find current students and alumni.</p>
      </header>

      <section className="staff-card student-directory-card">
        <div className="section-heading">
          <h2>Directory</h2>
          <span>{total}</span>
        </div>
        <form className="student-directory-toolbar" onSubmit={onSearchSubmit}>
          <div className="segmented-control" aria-label="Student status">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={status === option.value ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"}
                onClick={() => onStatusChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label>
            Search
            <input value={searchDraft} onChange={(event) => onSearchDraftChange(event.target.value)} placeholder="Name, Student ID, mobile, course" />
          </label>
          <button type="submit">Search</button>
        </form>

        {error ? <ErrorState title="Could not load students" message={error} /> : null}
        {isLoading ? <LoadingState label="Loading students" /> : null}
        {!isLoading && !error && directory && directory.items.length === 0 ? <p className="empty-copy">{emptyMessage}</p> : null}
        {!isLoading && !error && directory && directory.items.length > 0 ? <StudentDirectoryList items={directory.items} /> : null}
        {directory ? (
          <div className="pagination-controls">
            <button type="button" onClick={onPreviousPage} disabled={directory.pagination.offset === 0 || isLoading}>Previous</button>
            <span>{pageRange(directory)}</span>
            <button type="button" onClick={onNextPage} disabled={!directory.pagination.hasMore || isLoading}>Next</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StudentDirectoryList({ items }: { items: StaffStudentDirectoryItem[] }) {
  return (
    <div className="student-directory-list">
      <div className="student-directory-header" aria-hidden="true">
        <span>Student ID</span>
        <span>Name</span>
        <span>Status</span>
        <span>Course / enrolment</span>
        <span>Mobile</span>
        <span>Actions</span>
      </div>
      {items.map((item) => (
        <article className="student-directory-row" key={item.studentId}>
          <div>
            <small>Student ID</small>
            <strong>{item.studentNumber}</strong>
          </div>
          <div>
            <small>Name</small>
            <strong>{item.displayName}</strong>
          </div>
          <div>
            <small>Status</small>
            <span className={`student-status-chip student-status-chip--${statusKind(item.currentStatus)}`}>{statusLabel(item.currentStatus)}</span>
          </div>
          <div>
            <small>Course / enrolment</small>
            <strong>{item.latestCourseName || "No enrolment recorded"}</strong>
            <span>{enrolmentSummary(item)}</span>
          </div>
          <div>
            <small>Mobile</small>
            <span>{item.mobileDisplay || "Protected"}</span>
          </div>
          <div className="student-directory-actions">
            <a className="button-link button-link--primary" href={`/app/students/${encodeURIComponent(item.studentId)}`}>Profile</a>
            {item.paymentShortcutEnrolmentId ? <a className="button-link" href={`/app/enrolments/${encodeURIComponent(item.paymentShortcutEnrolmentId)}/payments`}>Payments</a> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function emptyStateMessage(status: StudentDirectoryStatus, hasSearch: boolean) {
  if (hasSearch) return "No students match your search.";
  if (status === "current") return "No current students found.";
  if (status === "alumni") return "No alumni found.";
  return "No students found.";
}

export function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "current") return "CURRENT";
  if (normalized === "alumni" || normalized === "completed" || normalized === "former") return "ALUMNI";
  return status.replace(/_/g, " ").toUpperCase();
}

function statusKind(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "current") return "current";
  if (normalized === "alumni" || normalized === "completed" || normalized === "former") return "alumni";
  return "other";
}

function enrolmentSummary(item: StaffStudentDirectoryItem) {
  const count = item.enrolmentCount === 1 ? "1 enrolment" : `${item.enrolmentCount} enrolments`;
  return item.latestEnrolmentNumber ? `${item.latestEnrolmentNumber} · ${count}` : count;
}

function pageRange(directory: StaffStudentDirectory) {
  if (directory.pagination.total === 0) return "0 of 0";
  const start = directory.pagination.offset + 1;
  const end = directory.pagination.offset + directory.items.length;
  return `${start}-${end} of ${directory.pagination.total}`;
}
