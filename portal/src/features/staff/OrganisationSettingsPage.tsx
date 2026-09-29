import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useAuth } from "../auth/AuthContext";
import { ApiError, getOrganisationSettings, updateOrganisationSettings, type OrganisationSettings } from "../../lib/api";

const ORGANISATION_TYPE_OPTIONS = [
  ["computer_training_institute", "Computer training institute"],
  ["coaching_centre", "Coaching centre"],
  ["vocational_institute", "Vocational institute"],
  ["language_institute", "Language institute"],
  ["corporate_training_provider", "Corporate training provider"],
  ["tuition_centre", "Tuition centre"],
  ["other", "Other"],
];

const LEGAL_ENTITY_OPTIONS = [
  ["proprietorship", "Proprietorship"],
  ["partnership", "Partnership"],
  ["llp", "LLP"],
  ["private_limited", "Private limited"],
  ["public_limited", "Public limited"],
  ["trust_society", "Trust or society"],
  ["individual", "Individual"],
  ["other", "Other"],
];

const blankSettings: OrganisationSettings = {
  id: "",
  name: "",
  legalName: "",
  organisationType: "computer_training_institute",
  legalEntityType: "proprietorship",
  addressLine1: "",
  city: "",
  stateRegion: "",
  country: "India",
  postcode: "",
  website: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
  pan: "",
  gstin: "",
  updatedAt: "",
};

export function OrganisationSettingsPage() {
  const { refreshSession } = useAuth();
  const [form, setForm] = useState<OrganisationSettings>(blankSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await getOrganisationSettings();
        if (active) setForm(result.organisation);
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

  function change(field: keyof OrganisationSettings) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = field === "pan" || field === "gstin" || field === "currency" ? event.target.value.toUpperCase() : event.target.value;
      setForm((current) => ({ ...current, [field]: value }));
      setSuccess(null);
      setSaveError(null);
      setFieldErrors(null);
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setFieldErrors(null);
    setSuccess(null);
    try {
      const result = await updateOrganisationSettings(settingsPayload(form));
      setForm(result.organisation);
      setSuccess(result.changedFields?.length ? "Organisation settings saved." : "No changes to save.");
      await refreshSession();
    } catch (reason) {
      if (reason instanceof ApiError) setFieldErrors(reason.fieldErrors || null);
      setSaveError(errorMessage(reason));
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading organisation settings" />;
  if (loadError) return <ErrorState title="Could not load organisation settings" message={loadError} />;

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Organisation Settings</h1>
        <p>Owner-managed profile, legal, address and regional settings.</p>
      </header>

      {saveError ? <ErrorState title="Could not save settings" message={saveError} /> : null}
      {success ? <div className="notice notice--success" role="status"><strong>{success}</strong></div> : null}

      <form className="content-stack" onSubmit={submit}>
        <section className="staff-card">
          <div className="section-heading"><h2>Organisation Profile</h2></div>
          <div className="staff-form-grid">
            <Field label="Brand name" field="name" value={form.name} onChange={change("name")} error={fieldErrors?.name?.[0]} required />
            <label>
              Organisation type
              <select value={form.organisationType} onChange={change("organisationType")} required>
                {ORGANISATION_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Legal Details</h2></div>
          <div className="staff-form-grid">
            <Field label="Legal name" field="legalName" value={form.legalName} onChange={change("legalName")} error={fieldErrors?.legalName?.[0]} required />
            <label>
              Legal entity type
              <select value={form.legalEntityType} onChange={change("legalEntityType")} required>
                {LEGAL_ENTITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Field label="PAN" field="pan" value={form.pan} onChange={change("pan")} error={fieldErrors?.pan?.[0]} />
            <Field label="GSTIN" field="gstin" value={form.gstin} onChange={change("gstin")} error={fieldErrors?.gstin?.[0]} />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Registered Address</h2></div>
          <div className="staff-form-grid">
            <Field label="Address" field="addressLine1" value={form.addressLine1} onChange={change("addressLine1")} error={fieldErrors?.addressLine1?.[0]} required />
            <Field label="City" field="city" value={form.city} onChange={change("city")} error={fieldErrors?.city?.[0]} required />
            <Field label="State / region" field="stateRegion" value={form.stateRegion} onChange={change("stateRegion")} error={fieldErrors?.stateRegion?.[0]} required />
            <Field label="Country" field="country" value={form.country} onChange={change("country")} error={fieldErrors?.country?.[0]} required />
            <Field label="Postcode" field="postcode" value={form.postcode} onChange={change("postcode")} error={fieldErrors?.postcode?.[0]} />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Business Details</h2></div>
          <div className="staff-form-grid">
            <Field label="Website" field="website" value={form.website} onChange={change("website")} error={fieldErrors?.website?.[0]} />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Regional Settings</h2></div>
          <div className="staff-form-grid">
            <Field label="Currency" field="currency" value={form.currency} onChange={change("currency")} error={fieldErrors?.currency?.[0]} required />
            <Field label="Timezone" field="timezone" value={form.timezone} onChange={change("timezone")} error={fieldErrors?.timezone?.[0]} required />
          </div>
        </section>

        <div className="staff-form-actions">
          <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Settings"}</button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  field,
  value,
  onChange,
  error,
  required,
}: {
  label: string;
  field: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input name={field} value={value} onChange={onChange} onInput={(event) => onChange(event as unknown as ChangeEvent<HTMLInputElement>)} required={required} aria-invalid={Boolean(error)} />
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

function settingsPayload(form: OrganisationSettings) {
  return {
    name: form.name,
    legalName: form.legalName,
    organisationType: form.organisationType,
    legalEntityType: form.legalEntityType,
    addressLine1: form.addressLine1,
    city: form.city,
    stateRegion: form.stateRegion,
    country: form.country,
    postcode: form.postcode,
    website: form.website,
    currency: form.currency,
    timezone: form.timezone,
    pan: form.pan,
    gstin: form.gstin,
  };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "Please try again.";
}
