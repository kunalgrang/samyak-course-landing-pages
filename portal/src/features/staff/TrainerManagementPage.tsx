import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  ApiError,
  createManagedTrainer,
  getEnquiryOptions,
  getManagedTrainer,
  getManagedTrainerCandidates,
  getManagedTrainers,
  setManagedTrainerStatus,
  updateManagedTrainer,
  type ManagedTrainer,
  type ManagedTrainerBatch,
  type ManagedTrainerCandidate,
  type ManagedTrainerInput,
} from "../../lib/api";
import type { RoutePath } from "../../routes/types";

const PAGE_SIZE = 20;
const weekdays = new Map([
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
]);

export function TrainerManagementPage({ mode = "list", personId, onNavigate }: { mode?: "list" | "new" | "detail"; personId?: string; onNavigate: (path: RoutePath) => void }) {
  if (mode === "new") return <TrainerCreatePage onNavigate={onNavigate} />;
  if (mode === "detail" && personId) return <TrainerDetailPage personId={personId} onNavigate={onNavigate} />;
  return <TrainerListPage onNavigate={onNavigate} />;
}

function TrainerListPage({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  const [query, setQuery] = useState({ q: "", status: "active", branchId: "", limit: PAGE_SIZE, offset: 0 });
  const [draft, setDraft] = useState({ q: "", status: "active", branchId: "" });
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof getManagedTrainers>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const key = useMemo(() => JSON.stringify(query), [query]);

  useEffect(() => {
    let active = true;
    void getEnquiryOptions().then((options) => {
      if (active) setBranches(options.branches);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getManagedTrainers(query)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key]);

  return (
    <div className="content-stack staff-enquiries-page trainer-management-page">
      <header className="page-header">
        <h1>Trainers</h1>
        <p>Owner and admin managed trainer identities, login readiness and batch assignments.</p>
        <button type="button" className="primary-button" onClick={() => onNavigate("/app/trainers/new")}>Add Trainer</button>
      </header>

      <section className="staff-card referral-ops-filters" aria-label="Trainer filters">
        <label>
          Search
          <input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} placeholder="Name, mobile, email, branch" />
        </label>
        <label>
          Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Branch
          <select value={draft.branchId} onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}>
            <option value="">All branches</option>
            {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setQuery({ ...draft, limit: PAGE_SIZE, offset: 0 })}>Apply</button>
      </section>

      {error ? <ErrorState title="Could not load trainers" message={error} /> : null}
      {loading || !data ? <LoadingState label="Loading trainers" /> : (
        <section className="staff-card referral-ops-table-card">
          <div className="section-heading"><h2>Trainer Directory</h2><span>{data.trainers.length ? `${data.pagination.offset + 1}+` : "0"}</span></div>
          {data.trainers.length ? (
            <div className="table-list">
              {data.trainers.map((trainer) => (
                <article className="table-row trainer-management-row" key={trainer.personId}>
                  <button type="button" className="referral-open-button" onClick={() => onNavigate(`/app/trainers/${trainer.personId}`)}>
                    <strong>{trainer.fullName}</strong>
                    <small>{trainer.branchName || "No branch"} · {label(trainer.trainerStatus)}</small>
                  </button>
                  <span>{trainer.mobileDisplay}</span>
                  <span>{trainer.email || "No email"}</span>
                  <span>{trainer.activeBatchCount} active batches</span>
                </article>
              ))}
            </div>
          ) : <EmptyState title="No trainers found" message="Try another search or add the first trainer." />}
          <div className="certificate-pagination">
            <button type="button" className="secondary-button" disabled={data.pagination.offset === 0} onClick={() => setQuery((current) => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}>Previous</button>
            <span>{data.pagination.offset + 1}-{data.pagination.offset + data.trainers.length}</span>
            <button type="button" className="secondary-button" disabled={!data.pagination.hasMore} onClick={() => setQuery((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))}>Next</button>
          </div>
        </section>
      )}
    </div>
  );
}

function TrainerCreatePage({ onNavigate }: { onNavigate: (path: RoutePath) => void }) {
  const { branches } = useBranches();
  const [form, setForm] = useState<ManagedTrainerInput>({ fullName: "", mobile: "", email: "", branchId: "branch_sion", status: "active" });
  const [candidates, setCandidates] = useState<ManagedTrainerCandidate[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [createSeparate, setCreateSeparate] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkCandidates() {
    setError("");
    setCandidates([]);
    setSelectedPersonId("");
    setCreateSeparate(false);
    if (!form.mobile.trim()) return;
    try {
      const result = await getManagedTrainerCandidates(form.mobile);
      setCandidates(result.candidates);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await createManagedTrainer({
        ...form,
        existingPersonId: selectedPersonId || undefined,
        createSeparatePerson: createSeparate,
      });
      setMessage(result.alreadyTrainer ? "Trainer already exists." : result.reusedPerson ? "Trainer access enabled for this Person." : "Trainer created successfully.");
      onNavigate(`/app/trainers/${result.personId}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "person_choice_required") {
        const nextCandidates = trainerCandidatesFromDetails(caught.details);
        setCandidates(nextCandidates);
        setError(caught.message);
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content-stack staff-enquiries-page trainer-management-page">
      <header className="page-header">
        <button type="button" className="secondary-button" onClick={() => onNavigate("/app/trainers")}>Back</button>
        <h1>Add Trainer</h1>
        <p>Create a Trainer from a new or existing Person identity.</p>
      </header>
      {error ? <ErrorState title="Trainer could not be saved" message={error} /> : null}
      {message ? <div className="notice notice--success" role="status"><strong>{message}</strong></div> : null}

      <section className="staff-card">
        <form className="referral-payout-form trainer-management-form" onSubmit={submit}>
          <label>Full Name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
          <label>Mobile<input value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} onBlur={() => void checkCandidates()} required inputMode="tel" /></label>
          <label>Email<input value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} inputMode="email" /></label>
          <label>
            Branch
            <select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={form.status || "active"} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "inactive" })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <div className="referral-contact-actions">
            <button type="button" className="secondary-button" onClick={() => void checkCandidates()}>Check Mobile</button>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save Trainer"}</button>
          </div>
        </form>
      </section>

      {candidates.length ? (
        <section className="staff-card trainer-candidate-panel">
          <div className="section-heading"><h2>Existing Person Matches</h2><span>{candidates.length}</span></div>
          <div className="trainer-candidate-list">
            {candidates.map((candidate) => (
              <label className="trainer-candidate-row" key={candidate.personId}>
                <input
                  type="radio"
                  name="trainer-person-choice"
                  checked={selectedPersonId === candidate.personId && !createSeparate}
                  onChange={() => {
                    setSelectedPersonId(candidate.personId);
                    setCreateSeparate(false);
                  }}
                />
                <span>
                  <strong>{candidate.displayName}</strong>
                  <small>{candidate.branchName || "No branch"} · {candidate.studentNumber ? `Student ${candidate.studentNumber}` : "No student ID"} · {candidate.roles.length ? candidate.roles.join(", ") : "No roles"}</small>
                </span>
              </label>
            ))}
            <label className="trainer-candidate-row">
              <input
                type="radio"
                name="trainer-person-choice"
                checked={createSeparate}
                onChange={() => {
                  setCreateSeparate(true);
                  setSelectedPersonId("");
                }}
              />
              <span>
                <strong>Create separate Person</strong>
                <small>Use this only when the shared mobile is legitimate.</small>
              </span>
            </label>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TrainerDetailPage({ personId, onNavigate }: { personId: string; onNavigate: (path: RoutePath) => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getManagedTrainer>> | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  async function refresh() {
    setDetail(await getManagedTrainer(personId));
  }

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    void getManagedTrainer(personId)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [personId]);

  async function changeStatus(status: "active" | "inactive") {
    if (status === "inactive" && !window.confirm("Deactivate this trainer? Their Trainer login access will be removed after any active or inactive batches are reassigned.")) return;
    setActionError("");
    try {
      await setManagedTrainerStatus(personId, status);
      await refresh();
    } catch (caught) {
      setActionError(trainerActionErrorMessage(caught));
    }
  }

  if (error) return <ErrorState title="Could not load trainer" message={error} />;
  if (!detail) return <LoadingState label="Loading trainer" />;
  const { trainer, batches } = detail;

  return (
    <div className="content-stack staff-enquiries-page trainer-management-page">
      <header className="page-header">
        <button type="button" className="secondary-button" onClick={() => onNavigate("/app/trainers")}>Back</button>
        <h1>{trainer.fullName}</h1>
        <p>{trainer.branchName || "No branch"} · {label(trainer.trainerStatus)} · {trainer.activeBatchCount} active batches</p>
      </header>
      {actionError ? <ErrorState title="Trainer action failed" message={actionError} /> : null}

      {editing ? (
        <TrainerEditForm
          trainer={trainer}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      ) : (
        <section className="detail-grid">
          <article className="staff-card">
            <h2>Trainer</h2>
            <Detail label="Mobile" value={trainer.mobileDisplay} />
            <Detail label="Email" value={trainer.email || "Not recorded"} />
            <Detail label="Branch" value={trainer.branchName || "No branch"} />
            <Detail label="Trainer Status" value={label(trainer.trainerStatus)} />
            <Detail label="Person Status" value={label(trainer.personStatus)} />
            <Detail label="Trainer Login" value={trainer.trainerLoginUrl} />
            <div className="referral-contact-actions">
              <button type="button" className="primary-button" onClick={() => setEditing(true)}>Edit Details</button>
              {trainer.trainerStatus === "active" ? (
                <button type="button" className="secondary-button" onClick={() => void changeStatus("inactive")}>Deactivate</button>
              ) : (
                <button type="button" className="secondary-button" onClick={() => void changeStatus("active")}>Activate</button>
              )}
            </div>
          </article>
          <article className="staff-card">
            <h2>Batch Summary</h2>
            <Detail label="Active Batches" value={String(trainer.activeBatchCount)} />
            <Detail label="Teaching Assignments" value={String(trainer.teachingBatchCount)} />
            <Detail label="Completed History" value={String(trainer.completedBatchCount)} />
          </article>
        </section>
      )}

      <section className="staff-card">
        <div className="section-heading"><h2>Assigned Batches</h2><span>{batches.length}</span></div>
        {batches.length ? (
          <div className="table-list">
            {batches.map((batch) => <TrainerBatchRow key={batch.id} batch={batch} onNavigate={onNavigate} />)}
          </div>
        ) : <EmptyState title="No batches assigned" message="This trainer has no current or historical primary batch assignment." />}
      </section>
    </div>
  );
}

function TrainerEditForm({ trainer, onCancel, onSaved }: { trainer: ManagedTrainer; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ fullName: trainer.fullName, email: trainer.email });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateManagedTrainer(trainer.personId, form);
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="staff-card">
      <form className="referral-payout-form trainer-management-form" onSubmit={submit}>
        <label>Full Name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
        <label>Mobile<input value={trainer.mobileDisplay} disabled /></label>
        <label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} inputMode="email" /></label>
        <label>Branch<input value={trainer.branchName || "No branch"} disabled /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="referral-contact-actions">
          <button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving..." : "Save Changes"}</button>
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

function TrainerBatchRow({ batch, onNavigate }: { batch: ManagedTrainerBatch; onNavigate: (path: RoutePath) => void }) {
  return (
    <article className="table-row trainer-management-row">
      <button type="button" className="referral-open-button" onClick={() => onNavigate(`/app/batches/${batch.id}`)}>
        <strong>{batch.name}</strong>
        <small>{batch.branchName} · {batch.courses.map((course) => course.name).join(", ") || "No course"}</small>
      </button>
      <span>{formatDays(batch.daysOfWeek)}</span>
      <span>{batch.startTime}-{batch.endTime}</span>
      <span>{batch.activeStudents} students</span>
      <span>{label(batch.status)}</span>
    </article>
  );
}

function useBranches() {
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([{ id: "branch_sion", name: "Sion" }]);
  useEffect(() => {
    let active = true;
    void getEnquiryOptions().then((options) => {
      if (active) setBranches(options.branches);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return { branches };
}

function Detail({ label: fieldLabel, value }: { label: string; value: string }) {
  return <div><small>{fieldLabel}</small><strong>{value}</strong></div>;
}

function trainerCandidatesFromDetails(details: Record<string, unknown> | undefined) {
  const candidates = details?.candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(isTrainerCandidate);
}

function isTrainerCandidate(value: unknown): value is ManagedTrainerCandidate {
  return Boolean(value && typeof value === "object" && typeof (value as ManagedTrainerCandidate).personId === "string");
}

function formatDays(days: string[]) {
  return days.map((day) => weekdays.get(day) || day).join(", ");
}

function label(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The trainer action could not be completed.";
}

function trainerActionErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "active_batch_assignments") {
    const batches = trainerBatchesFromDetails(error.details);
    if (batches.length) return `${error.message} Blocking batches: ${batches.map((batch) => `${batch.name} (${label(batch.status)})`).join(", ")}.`;
  }
  return errorMessage(error);
}

function trainerBatchesFromDetails(details: Record<string, unknown> | undefined) {
  const batches = details?.batches;
  if (!Array.isArray(batches)) return [];
  return batches.filter(isTrainerBatch);
}

function isTrainerBatch(value: unknown): value is ManagedTrainerBatch {
  return Boolean(value && typeof value === "object" && typeof (value as ManagedTrainerBatch).name === "string" && typeof (value as ManagedTrainerBatch).status === "string");
}
