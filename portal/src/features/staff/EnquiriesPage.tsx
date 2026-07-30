import { FormEvent, useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import {
  createEnquiry,
  getEnquiryOptions,
  searchStudentByMobile,
  type EnquiryOptions,
  type StudentSearchResult,
} from "../../lib/api";

type FormState = {
  fullName: string;
  branchId: string;
  courseInterestId: string;
  courseInterestText: string;
  source: string;
  sourceDetail: string;
  preferredTiming: string;
  preferredJoiningDate: string;
  existingPersonId: string;
};

const emptyForm: FormState = {
  fullName: "",
  branchId: "",
  courseInterestId: "",
  courseInterestText: "",
  source: "",
  sourceDetail: "",
  preferredTiming: "",
  preferredJoiningDate: "",
  existingPersonId: "",
};

export function EnquiriesPage() {
  const [options, setOptions] = useState<EnquiryOptions | null>(null);
  const [mobile, setMobile] = useState("");
  const [searchResult, setSearchResult] = useState<StudentSearchResult | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void getEnquiryOptions()
      .then((data) => {
        setOptions(data);
        setForm((current) => ({
          ...current,
          branchId: current.branchId || data.branches[0]?.id || "",
          source: current.source || data.sources[0] || "",
        }));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load enquiry options."))
      .finally(() => setIsLoadingOptions(false));
  }, []);

  const selectedPerson = useMemo(
    () => searchResult?.possiblePeople.find((person) => person.person_id === form.existingPersonId) || null,
    [form.existingPersonId, searchResult],
  );

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSearching(true);
    try {
      const result = await searchStudentByMobile(mobile);
      setSearchResult(result);
      const firstPerson = result.possiblePeople[0];
      setForm((current) => ({
        ...current,
        existingPersonId: firstPerson?.person_id || "",
        fullName: firstPerson?.full_name || "",
      }));
    } catch (reason) {
      setSearchResult(null);
      setError(reason instanceof Error ? reason.message : "Could not search this mobile number.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const created = await createEnquiry({
        mobile,
        fullName: selectedPerson?.full_name || form.fullName,
        branchId: form.branchId,
        courseInterestId: form.courseInterestId || null,
        courseInterestText: form.courseInterestId ? null : form.courseInterestText,
        source: form.source,
        sourceDetail: form.sourceDetail || null,
        preferredTiming: form.preferredTiming || null,
        preferredJoiningDate: form.preferredJoiningDate || null,
        existingPersonId: form.existingPersonId || null,
      });
      setSuccess(`Enquiry ${created.enquiryNumber} created successfully.`);
      setSearchResult(await searchStudentByMobile(mobile));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the enquiry.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingOptions) return <LoadingState label="Loading enquiry form" />;
  if (!options) return <ErrorState title="Could not load enquiry tools" message={error || "Please try again."} />;

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Student & Enquiry Search</h1>
        <p>Search by mobile number before creating an enquiry to prevent duplicate student records.</p>
      </header>

      <section className="staff-card">
        <form className="staff-form staff-search-form" onSubmit={handleSearch}>
          <label htmlFor="student-mobile">Mobile number</label>
          <div className="staff-search-row">
            <input
              id="student-mobile"
              type="tel"
              inputMode="numeric"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="98765 43210"
              required
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </button>
          </div>
        </form>
      </section>

      {error ? <ErrorState title="Could not continue" message={error} /> : null}
      {success ? <div className="notice notice--success"><strong>Saved</strong><span>{success}</span></div> : null}

      {searchResult ? (
        <>
          <section className="staff-card">
            <div className="section-heading">
              <h2>Possible matching people</h2>
              <span>{searchResult.possiblePeople.length}</span>
            </div>
            {searchResult.possiblePeople.length ? (
              <div className="match-list">
                {searchResult.possiblePeople.map((person) => (
                  <label key={person.person_id} className="match-card">
                    <input
                      type="radio"
                      name="existing-person"
                      checked={form.existingPersonId === person.person_id}
                      onChange={() => setForm((current) => ({ ...current, existingPersonId: person.person_id, fullName: person.full_name }))}
                    />
                    <span>
                      <strong>{person.full_name}</strong>
                      <small>
                        {person.student_number || "No Student ID yet"}
                        {person.student_status ? ` · ${formatLabel(person.student_status)}` : ""}
                        {person.date_of_birth ? ` · DOB ${person.date_of_birth}` : ""}
                      </small>
                    </span>
                  </label>
                ))}
                <label className="match-card">
                  <input
                    type="radio"
                    name="existing-person"
                    checked={!form.existingPersonId}
                    onChange={() => setForm((current) => ({ ...current, existingPersonId: "", fullName: "" }))}
                  />
                  <span><strong>Create a new person</strong><small>Use only when none of the matches are the same person.</small></span>
                </label>
              </div>
            ) : (
              <p className="staff-empty">No existing person was found for this mobile number.</p>
            )}
          </section>

          <section className="staff-card">
            <div className="section-heading">
              <h2>Previous enquiries on this mobile</h2>
              <span>{searchResult.enquiries.length}</span>
            </div>
            {searchResult.enquiries.length ? (
              <div className="enquiry-history">
                {searchResult.enquiries.map((enquiry) => (
                  <article key={enquiry.id}>
                    <strong>{enquiry.enquiry_number}</strong>
                    <span>{enquiry.course_name || "Course not recorded"}</span>
                    <small>{formatLabel(enquiry.status)} · {enquiry.source} · {formatDate(enquiry.created_at)}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="staff-empty">No previous enquiries were found.</p>
            )}
          </section>

          <section className="staff-card">
            <div className="section-heading"><h2>Create a new enquiry</h2></div>
            <form className="staff-form staff-form-grid" onSubmit={handleCreate}>
              <label>
                Student name
                <input
                  value={selectedPerson?.full_name || form.fullName}
                  onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                  disabled={Boolean(selectedPerson)}
                  placeholder="Full name"
                  required
                />
              </label>

              <label>
                Branch
                <select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} required>
                  {options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>

              <label>
                Course from master
                <select value={form.courseInterestId} onChange={(event) => setForm((current) => ({ ...current, courseInterestId: event.target.value }))}>
                  <option value="">Enter course manually</option>
                  {options.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                </select>
              </label>

              {!form.courseInterestId ? (
                <label>
                  Course interested in
                  <input
                    value={form.courseInterestText}
                    onChange={(event) => setForm((current) => ({ ...current, courseInterestText: event.target.value }))}
                    placeholder="e.g. Data Analytics"
                    required
                  />
                </label>
              ) : null}

              <label>
                Enquiry source
                <select value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} required>
                  {options.sources.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
              </label>

              <label>
                Source details
                <input value={form.sourceDetail} onChange={(event) => setForm((current) => ({ ...current, sourceDetail: event.target.value }))} placeholder="Campaign, referrer or notes" />
              </label>

              <label>
                Preferred timing
                <input value={form.preferredTiming} onChange={(event) => setForm((current) => ({ ...current, preferredTiming: event.target.value }))} placeholder="e.g. 7:00 PM" />
              </label>

              <label>
                Preferred joining date
                <input type="date" value={form.preferredJoiningDate} onChange={(event) => setForm((current) => ({ ...current, preferredJoiningDate: event.target.value }))} />
              </label>

              <div className="staff-form-actions">
                <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create enquiry"}</button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
