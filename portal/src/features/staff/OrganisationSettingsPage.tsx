import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useAuth } from "../auth/AuthContext";
import {
  ApiError,
  createCentre,
  getCentres,
  getOrganisationSettings,
  getPaymentPlanPolicy,
  updateCentre,
  updateOrganisationSettings,
  updatePaymentPlanPolicy,
  type CreateCentreInput,
  type OrganisationSettings,
  type PaymentPlanPolicy,
  type StaffCentre,
  type UpdateCentreInput,
} from "../../lib/api";

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

const OPERATING_MODEL_OPTIONS = [
  ["company_owned", "Company owned"],
  ["franchise_operated", "Franchise operated"],
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

const blankCentreForm: CreateCentreInput & { newMobile: string } = {
  name: "",
  mobile: "",
  newMobile: "",
  email: "",
  addressLine1: "",
  city: "",
  stateRegion: "",
  postcode: "",
  country: "India",
  operatingModel: "company_owned",
  currency: "INR",
  timezone: "Asia/Kolkata",
  pan: "",
  gstin: "",
};

type Tab = "organisation" | "centres" | "paymentPlans";
type FieldErrors = Record<string, string[]> | null;
type CentreForm = typeof blankCentreForm;
type PaymentPlanFormRule = {
  key: "twoInstalments" | "threeInstalments" | "flexibleInstalments";
  isActive: boolean;
  minimumCourseDurationMonths: string;
};

export function OrganisationSettingsPage() {
  const { refreshSession } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("organisation");
  const [form, setForm] = useState<OrganisationSettings>(blankSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [centres, setCentres] = useState<StaffCentre[]>([]);
  const [centresLoaded, setCentresLoaded] = useState(false);
  const [centresLoading, setCentresLoading] = useState(false);
  const [centresError, setCentresError] = useState<string | null>(null);
  const [centreSaving, setCentreSaving] = useState(false);
  const [centreSuccess, setCentreSuccess] = useState<string | null>(null);
  const [centreSaveError, setCentreSaveError] = useState<string | null>(null);
  const [centreFieldErrors, setCentreFieldErrors] = useState<FieldErrors>(null);
  const [selectedCentreId, setSelectedCentreId] = useState<string | null>(null);
  const [centreForm, setCentreForm] = useState<CentreForm>(blankCentreForm);

  const [paymentPolicy, setPaymentPolicy] = useState<PaymentPlanPolicy | null>(null);
  const [paymentPlanForm, setPaymentPlanForm] = useState<PaymentPlanFormRule[]>(defaultPaymentPlanRows());
  const [paymentPlansLoaded, setPaymentPlansLoaded] = useState(false);
  const [paymentPlansLoading, setPaymentPlansLoading] = useState(false);
  const [paymentPlansSaving, setPaymentPlansSaving] = useState(false);
  const [paymentPlansLoadError, setPaymentPlansLoadError] = useState<string | null>(null);
  const [paymentPlansSaveError, setPaymentPlansSaveError] = useState<string | null>(null);
  const [paymentPlanFieldErrors, setPaymentPlanFieldErrors] = useState<FieldErrors>(null);
  const [paymentPlansSuccess, setPaymentPlansSuccess] = useState<string | null>(null);

  const selectedCentre = useMemo(() => centres.find((centre) => centre.id === selectedCentreId) || null, [centres, selectedCentreId]);

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

  useEffect(() => {
    if (activeTab !== "centres" || centresLoaded) return;
    let active = true;
    async function loadCentres() {
      setCentresLoading(true);
      setCentresError(null);
      try {
        const result = await getCentres();
        if (active) {
          setCentres(result.centres);
          setCentresLoaded(true);
          if (!selectedCentreId && result.centres.length) {
            setSelectedCentreId(result.centres[0].id);
            setCentreForm(formFromCentre(result.centres[0]));
          }
        }
      } catch (reason) {
        if (active) setCentresError(errorMessage(reason));
      } finally {
        if (active) setCentresLoading(false);
      }
    }
    void loadCentres();
    return () => {
      active = false;
    };
  }, [activeTab, centresLoaded]);

  useEffect(() => {
    if (activeTab !== "paymentPlans" || paymentPlansLoaded) return;
    let active = true;
    async function loadPaymentPlans() {
      setPaymentPlansLoading(true);
      setPaymentPlansLoadError(null);
      try {
        const result = await getPaymentPlanPolicy();
        if (active) {
          setPaymentPolicy(result.policy);
          setPaymentPlanForm(formFromPaymentPolicy(result.policy));
          setPaymentPlansLoaded(true);
        }
      } catch (reason) {
        if (active) setPaymentPlansLoadError(errorMessage(reason));
      } finally {
        if (active) setPaymentPlansLoading(false);
      }
    }
    void loadPaymentPlans();
    return () => {
      active = false;
    };
  }, [activeTab, paymentPlansLoaded]);

  function change(field: keyof OrganisationSettings) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = field === "pan" || field === "gstin" || field === "currency" ? event.target.value.toUpperCase() : event.target.value;
      setForm((current) => ({ ...current, [field]: value }));
      setSuccess(null);
      setSaveError(null);
      setFieldErrors(null);
    };
  }

  function changeCentre(field: keyof CentreForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = field === "pan" || field === "gstin" || field === "currency" ? event.target.value.toUpperCase() : event.target.value;
      setCentreForm((current) => ({ ...current, [field]: value }));
      setCentreSuccess(null);
      setCentreSaveError(null);
      setCentreFieldErrors(null);
    };
  }

  function selectCentre(centre: StaffCentre) {
    setSelectedCentreId(centre.id);
    setCentreForm(formFromCentre(centre));
    setCentreSuccess(null);
    setCentreSaveError(null);
    setCentreFieldErrors(null);
  }

  function startNewCentre() {
    setSelectedCentreId(null);
    setCentreForm(blankCentreForm);
    setCentreSuccess(null);
    setCentreSaveError(null);
    setCentreFieldErrors(null);
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

  async function submitCentre(event: FormEvent) {
    event.preventDefault();
    if (centreSaving) return;
    setCentreSaving(true);
    setCentreSaveError(null);
    setCentreFieldErrors(null);
    setCentreSuccess(null);
    try {
      const result = selectedCentre
        ? await updateCentre(selectedCentre.id, updateCentrePayload(centreForm))
        : await createCentre(createCentrePayload(centreForm));
      setCentres((current) => upsertCentre(current, result.centre));
      setSelectedCentreId(result.centre.id);
      setCentreForm(formFromCentre(result.centre));
      setCentreSuccess(selectedCentre ? "Centre details saved." : "Centre created. It will become active after its subscription payment is verified.");
    } catch (reason) {
      if (reason instanceof ApiError) setCentreFieldErrors(reason.fieldErrors || null);
      setCentreSaveError(errorMessage(reason));
    } finally {
      setCentreSaving(false);
    }
  }

  function changePaymentPlan(index: number, field: keyof PaymentPlanFormRule) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = field === "isActive" ? event.target.checked : event.target.value;
      setPaymentPlanForm((current) => current.map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        return { ...rule, [field]: nextValue };
      }));
      setPaymentPlansSuccess(null);
      setPaymentPlansSaveError(null);
      setPaymentPlanFieldErrors(null);
    };
  }

  async function submitPaymentPlans(event: FormEvent) {
    event.preventDefault();
    if (paymentPlansSaving || !paymentPolicy) return;
    setPaymentPlansSaving(true);
    setPaymentPlansSaveError(null);
    setPaymentPlanFieldErrors(null);
    setPaymentPlansSuccess(null);
    try {
      const result = await updatePaymentPlanPolicy(paymentPlanPayload(paymentPlanForm));
      setPaymentPolicy(result.policy);
      setPaymentPlanForm(formFromPaymentPolicy(result.policy));
      setPaymentPlansSuccess("Payment plan policy saved.");
    } catch (reason) {
      if (reason instanceof ApiError) setPaymentPlanFieldErrors(reason.fieldErrors || null);
      setPaymentPlansSaveError(errorMessage(reason));
    } finally {
      setPaymentPlansSaving(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading organisation settings" />;
  if (loadError) return <ErrorState title="Could not load organisation settings" message={loadError} />;

  return (
    <div className="content-stack staff-enquiries-page">
      <header className="page-header">
        <h1>Organisation Settings</h1>
        <p>Owner-managed organisation profile and centre administration.</p>
      </header>

      <div className="segmented-control" role="tablist" aria-label="Organisation settings sections">
        <button type="button" className={activeTab === "organisation" ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"} onClick={() => setActiveTab("organisation")} aria-pressed={activeTab === "organisation"}>Organisation</button>
        <button type="button" className={activeTab === "centres" ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"} onClick={() => setActiveTab("centres")} aria-pressed={activeTab === "centres"}>Centres</button>
        <button type="button" className={activeTab === "paymentPlans" ? "segmented-control__option segmented-control__option--active" : "segmented-control__option"} onClick={() => setActiveTab("paymentPlans")} aria-pressed={activeTab === "paymentPlans"}>Payment Plans</button>
      </div>

      {activeTab === "organisation" ? (
        <OrganisationForm
          form={form}
          fieldErrors={fieldErrors}
          saveError={saveError}
          success={success}
          isSaving={isSaving}
          onChange={change}
          onSubmit={submit}
        />
      ) : activeTab === "centres" ? (
        <CentreAdmin
          centres={centres}
          selectedCentre={selectedCentre}
          form={centreForm}
          isLoading={centresLoading}
          isSaving={centreSaving}
          loadError={centresError}
          saveError={centreSaveError}
          fieldErrors={centreFieldErrors}
          success={centreSuccess}
          onChange={changeCentre}
          onSubmit={submitCentre}
          onSelect={selectCentre}
          onNew={startNewCentre}
        />
      ) : (
        <PaymentPlansAdmin
          form={paymentPlanForm}
          isLoading={paymentPlansLoading}
          isSaving={paymentPlansSaving}
          loadError={paymentPlansLoadError}
          saveError={paymentPlansSaveError}
          fieldErrors={paymentPlanFieldErrors}
          success={paymentPlansSuccess}
          onChange={changePaymentPlan}
          onSubmit={submitPaymentPlans}
        />
      )}
    </div>
  );
}

function OrganisationForm({
  form,
  fieldErrors,
  saveError,
  success,
  isSaving,
  onChange,
  onSubmit,
}: {
  form: OrganisationSettings;
  fieldErrors: FieldErrors;
  saveError: string | null;
  success: string | null;
  isSaving: boolean;
  onChange: (field: keyof OrganisationSettings) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <>
      {saveError ? <ErrorState title="Could not save settings" message={saveError} /> : null}
      {success ? <div className="notice notice--success" role="status"><strong>{success}</strong></div> : null}

      <form className="content-stack" onSubmit={onSubmit}>
        <section className="staff-card">
          <div className="section-heading"><h2>Organisation Profile</h2></div>
          <div className="staff-form-grid">
            <Field label="Brand name" field="name" value={form.name} onChange={onChange("name")} error={fieldErrors?.name?.[0]} required />
            <SelectField label="Organisation type" value={form.organisationType} onChange={onChange("organisationType")} options={ORGANISATION_TYPE_OPTIONS} required />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Legal Details</h2></div>
          <div className="staff-form-grid">
            <Field label="Legal name" field="legalName" value={form.legalName} onChange={onChange("legalName")} error={fieldErrors?.legalName?.[0]} required />
            <SelectField label="Legal entity type" value={form.legalEntityType} onChange={onChange("legalEntityType")} options={LEGAL_ENTITY_OPTIONS} required />
            <Field label="PAN" field="pan" value={form.pan} onChange={onChange("pan")} error={fieldErrors?.pan?.[0]} />
            <Field label="GSTIN" field="gstin" value={form.gstin} onChange={onChange("gstin")} error={fieldErrors?.gstin?.[0]} />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Registered Address</h2></div>
          <div className="staff-form-grid">
            <Field label="Address" field="addressLine1" value={form.addressLine1} onChange={onChange("addressLine1")} error={fieldErrors?.addressLine1?.[0]} required />
            <Field label="City" field="city" value={form.city} onChange={onChange("city")} error={fieldErrors?.city?.[0]} required />
            <Field label="State / region" field="stateRegion" value={form.stateRegion} onChange={onChange("stateRegion")} error={fieldErrors?.stateRegion?.[0]} required />
            <Field label="Country" field="country" value={form.country} onChange={onChange("country")} error={fieldErrors?.country?.[0]} required />
            <Field label="Postcode" field="postcode" value={form.postcode} onChange={onChange("postcode")} error={fieldErrors?.postcode?.[0]} />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Business Details</h2></div>
          <div className="staff-form-grid">
            <Field label="Website" field="website" value={form.website} onChange={onChange("website")} error={fieldErrors?.website?.[0]} />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Regional Settings</h2></div>
          <div className="staff-form-grid">
            <Field label="Currency" field="currency" value={form.currency} onChange={onChange("currency")} error={fieldErrors?.currency?.[0]} required />
            <Field label="Timezone" field="timezone" value={form.timezone} onChange={onChange("timezone")} error={fieldErrors?.timezone?.[0]} required />
          </div>
        </section>

        <div className="staff-form-actions">
          <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Settings"}</button>
        </div>
      </form>
    </>
  );
}

function CentreAdmin({
  centres,
  selectedCentre,
  form,
  isLoading,
  isSaving,
  loadError,
  saveError,
  fieldErrors,
  success,
  onChange,
  onSubmit,
  onSelect,
  onNew,
}: {
  centres: StaffCentre[];
  selectedCentre: StaffCentre | null;
  form: CentreForm;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  saveError: string | null;
  fieldErrors: FieldErrors;
  success: string | null;
  onChange: (field: keyof CentreForm) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onSelect: (centre: StaffCentre) => void;
  onNew: () => void;
}) {
  if (isLoading) return <LoadingState label="Loading centres" />;
  if (loadError) return <ErrorState title="Could not load centres" message={loadError} />;

  return (
    <div className="content-stack">
      {saveError ? <ErrorState title="Could not save centre" message={saveError} /> : null}
      {success ? <div className="notice notice--success" role="status"><strong>{success}</strong></div> : null}

      <section className="staff-card content-stack">
        <div className="section-heading">
          <h2>Centres</h2>
          <button type="button" onClick={onNew}>New Centre</button>
        </div>
        {centres.length ? (
          <div className="content-stack">
            {centres.map((centre) => (
              <button key={centre.id} type="button" className="staff-card" onClick={() => onSelect(centre)} aria-pressed={selectedCentre?.id === centre.id}>
                <strong>{centre.name}</strong>
                <span>{centre.code}</span>
                <span className={`status-pill status-pill--${centre.canOperate ? "approved" : "warning"}`}>{centre.commercialStatusLabel}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="form-message">No centres have been added yet.</p>
        )}
      </section>

      <form className="content-stack" onSubmit={onSubmit}>
        <section className="staff-card">
          <div className="section-heading"><h2>{selectedCentre ? "Edit Centre" : "Create Centre"}</h2></div>
          {selectedCentre ? (
            <div className="detail-grid">
              <div><span>Centre code</span><strong>{selectedCentre.code}</strong></div>
              <div><span>Operational status</span><strong>{selectedCentre.status}</strong></div>
              <div><span>Subscription status</span><strong>{selectedCentre.commercialStatusLabel}</strong></div>
              <div><span>Registered mobile</span><strong>{selectedCentre.maskedMobile || "Not set"}</strong></div>
            </div>
          ) : (
            <p className="form-message">This Centre will become operational after its subscription payment is verified.</p>
          )}
          <div className="staff-form-grid">
            <Field label="Centre name" field="centreName" value={form.name} onChange={onChange("name")} error={fieldErrors?.name?.[0]} required />
            {selectedCentre ? (
              <Field label="Replacement mobile" field="newMobile" value={form.newMobile} onChange={onChange("newMobile")} error={fieldErrors?.newMobile?.[0]} />
            ) : (
              <Field label="Mobile" field="mobile" value={form.mobile} onChange={onChange("mobile")} error={fieldErrors?.mobile?.[0]} required />
            )}
            <Field label="Email" field="centreEmail" value={form.email} onChange={onChange("email")} error={fieldErrors?.email?.[0]} />
            <SelectField label="Operating model" value={form.operatingModel} onChange={onChange("operatingModel")} options={OPERATING_MODEL_OPTIONS} required />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Centre Address</h2></div>
          <div className="staff-form-grid">
            <Field label="Address" field="centreAddressLine1" value={form.addressLine1} onChange={onChange("addressLine1")} error={fieldErrors?.addressLine1?.[0]} required />
            <Field label="City" field="centreCity" value={form.city} onChange={onChange("city")} error={fieldErrors?.city?.[0]} required />
            <Field label="State / region" field="centreStateRegion" value={form.stateRegion} onChange={onChange("stateRegion")} error={fieldErrors?.stateRegion?.[0]} />
            <Field label="Country" field="centreCountry" value={form.country} onChange={onChange("country")} error={fieldErrors?.country?.[0]} required />
            <Field label="Postcode" field="centrePostcode" value={form.postcode} onChange={onChange("postcode")} error={fieldErrors?.postcode?.[0]} required />
          </div>
        </section>

        <section className="staff-card">
          <div className="section-heading"><h2>Regional And Tax Details</h2></div>
          <div className="staff-form-grid">
            <Field label="Currency" field="centreCurrency" value={form.currency} onChange={onChange("currency")} error={fieldErrors?.currency?.[0]} required />
            <Field label="Timezone" field="centreTimezone" value={form.timezone} onChange={onChange("timezone")} error={fieldErrors?.timezone?.[0]} required />
            <Field label="PAN" field="centrePan" value={form.pan} onChange={onChange("pan")} error={fieldErrors?.pan?.[0]} />
            <Field label="GSTIN" field="centreGstin" value={form.gstin} onChange={onChange("gstin")} error={fieldErrors?.gstin?.[0]} />
          </div>
        </section>

        <div className="staff-form-actions">
          <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : selectedCentre ? "Save Centre" : "Create Centre"}</button>
        </div>
      </form>
    </div>
  );
}

function PaymentPlansAdmin({
  form,
  isLoading,
  isSaving,
  loadError,
  saveError,
  fieldErrors,
  success,
  onChange,
  onSubmit,
}: {
  form: PaymentPlanFormRule[];
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  saveError: string | null;
  fieldErrors: FieldErrors;
  success: string | null;
  onChange: (index: number, field: keyof PaymentPlanFormRule) => (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  if (isLoading) return <LoadingState label="Loading payment plans" />;
  if (loadError) return <ErrorState title="Could not load payment plans" message={loadError} />;

  return (
    <div className="content-stack">
      {saveError ? <ErrorState title="Could not save payment plans" message={saveError} /> : null}
      {success ? <div className="notice notice--success" role="status"><strong>{success}</strong></div> : null}

      <form className="content-stack" onSubmit={onSubmit}>
        <section className="staff-card content-stack">
          <div className="section-heading"><h2>Payment Plans</h2></div>
          <p className="form-message">Choose how students can pay Course fees for new admissions. Existing student fee agreements and payment schedules are not changed.</p>
          <article className="staff-card content-stack">
            <div className="section-heading"><h3>Full payment</h3></div>
            <p className="form-message">Always available for every Course.</p>
          </article>
          {form.map((rule, index) => (
            <PaymentPlanTier
              key={rule.key}
              rule={rule}
              index={index}
              fieldErrors={fieldErrors}
              onChange={onChange}
            />
          ))}
          <PaymentPlanExamples form={form} />
        </section>

        <div className="staff-form-actions">
          <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Payment Plans"}</button>
        </div>
      </form>
    </div>
  );
}

function PaymentPlanTier({
  rule,
  index,
  fieldErrors,
  onChange,
}: {
  rule: PaymentPlanFormRule;
  index: number;
  fieldErrors: FieldErrors;
  onChange: (index: number, field: keyof PaymentPlanFormRule) => (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const config = paymentPlanTierConfig(rule.key);
  const durationError = fieldErrors?.[`${rule.key}.minimumCourseDurationMonths`]?.[0];
  const enabledError = fieldErrors?.[`${rule.key}.enabled`]?.[0];
  return (
    <article className="staff-card content-stack">
      <div className="section-heading">
        <h3>{config.heading}</h3>
        <label>
          <input
            name={`paymentPlan.${rule.key}.active`}
            type="checkbox"
            checked={rule.isActive}
            onChange={onChange(index, "isActive")}
          />
          Enabled
        </label>
      </div>
      <label>
        {config.label}
        <span className="inline-input-with-unit">
          <input
            name={`paymentPlan.${rule.key}.minimumCourseDurationMonths`}
            type="number"
            min={config.minimum}
            step="0.5"
            value={rule.minimumCourseDurationMonths}
            disabled={!rule.isActive}
            onChange={onChange(index, "minimumCourseDurationMonths")}
            onInput={(event) => onChange(index, "minimumCourseDurationMonths")(event as unknown as ChangeEvent<HTMLInputElement>)}
            aria-invalid={Boolean(durationError)}
          />
          <span>months</span>
        </span>
      </label>
      {config.helper ? <p className="form-message">{config.helper}</p> : null}
      {durationError ? <small className="field-error">{durationError}</small> : null}
      {enabledError ? <small className="field-error">{enabledError}</small> : null}
    </article>
  );
}

function PaymentPlanExamples({ form }: { form: PaymentPlanFormRule[] }) {
  const examples = [1, 2, 3, 6].map((duration) => ({ duration, counts: exampleInstalmentCounts(form, duration) }));
  return (
    <article className="staff-card content-stack">
      <div className="section-heading"><h3>Examples</h3></div>
      <div className="payment-summary-grid">
        {examples.map((example) => (
          <div key={example.duration}>
            <strong>{example.duration}-month Course</strong>
            <p>{formatInstalmentChoices(example.counts)}</p>
          </div>
        ))}
      </div>
    </article>
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

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: string[][];
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={onChange} required={required}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function formFromPaymentPolicy(policy: PaymentPlanPolicy): PaymentPlanFormRule[] {
  return [
    {
      key: "twoInstalments",
      isActive: policy.twoInstalments.enabled,
      minimumCourseDurationMonths: String(policy.twoInstalments.minimumCourseDurationMonths),
    },
    {
      key: "threeInstalments",
      isActive: policy.threeInstalments.enabled,
      minimumCourseDurationMonths: String(policy.threeInstalments.minimumCourseDurationMonths),
    },
    {
      key: "flexibleInstalments",
      isActive: policy.flexibleInstalments.enabled,
      minimumCourseDurationMonths: String(policy.flexibleInstalments.minimumCourseDurationMonths),
    },
  ];
}

function defaultPaymentPlanRows(): PaymentPlanFormRule[] {
  return formFromPaymentPolicy({
    fullPayment: { enabled: true, minimumCourseDurationMonths: 0.5 },
    twoInstalments: { enabled: true, minimumCourseDurationMonths: 2 },
    threeInstalments: { enabled: true, minimumCourseDurationMonths: 3 },
    flexibleInstalments: { enabled: true, minimumCourseDurationMonths: 4 },
  });
}

function paymentPlanPayload(form: PaymentPlanFormRule[]) {
  const byKey = Object.fromEntries(form.map((rule) => [rule.key, rule])) as Record<PaymentPlanFormRule["key"], PaymentPlanFormRule>;
  return {
    twoInstalments: {
      enabled: byKey.twoInstalments.isActive,
      minimumCourseDurationMonths: Number(byKey.twoInstalments.minimumCourseDurationMonths),
    },
    threeInstalments: {
      enabled: byKey.threeInstalments.isActive,
      minimumCourseDurationMonths: Number(byKey.threeInstalments.minimumCourseDurationMonths),
    },
    flexibleInstalments: {
      enabled: byKey.flexibleInstalments.isActive,
      minimumCourseDurationMonths: Number(byKey.flexibleInstalments.minimumCourseDurationMonths),
    },
  };
}

function paymentPlanTierConfig(key: PaymentPlanFormRule["key"]) {
  if (key === "twoInstalments") return { heading: "2 instalments", label: "Allow 2 instalments for Courses of at least", helper: "Minimum 2 months.", minimum: 2 };
  if (key === "threeInstalments") return { heading: "3 instalments", label: "Allow 3 instalments for Courses of at least", helper: "Minimum 3 months.", minimum: 3 };
  return {
    heading: "Flexible instalments (4+)",
    label: "Allow flexible instalments for Courses of at least",
    helper: "Minimum 4 months. The maximum number of instalments is limited by the Course duration. A 6-month Course can have at most 6 instalments.",
    minimum: 4,
  };
}

function exampleInstalmentCounts(form: PaymentPlanFormRule[], durationMonths: number) {
  const payload = paymentPlanPayload(form);
  const maximum = Math.min(24, Math.max(1, Math.floor(durationMonths)));
  const counts = [1];
  if (payload.twoInstalments.enabled && durationMonths >= payload.twoInstalments.minimumCourseDurationMonths && maximum >= 2) counts.push(2);
  if (payload.threeInstalments.enabled && durationMonths >= payload.threeInstalments.minimumCourseDurationMonths && maximum >= 3) counts.push(3);
  if (payload.flexibleInstalments.enabled && durationMonths >= payload.flexibleInstalments.minimumCourseDurationMonths) {
    for (let count = 4; count <= maximum; count += 1) counts.push(count);
  }
  return counts;
}

function formatInstalmentChoices(counts: number[]) {
  if (counts.length === 1) return "1 payment";
  if (counts.length > 3 && counts.every((count, index) => count === index + 1)) return `1 to ${counts.at(-1)} payments`;
  const last = counts.at(-1);
  return `${counts.slice(0, -1).join(", ")} or ${last} payments`;
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

function createCentrePayload(form: CentreForm): CreateCentreInput {
  return {
    name: form.name,
    mobile: form.mobile,
    email: form.email,
    addressLine1: form.addressLine1,
    city: form.city,
    stateRegion: form.stateRegion,
    postcode: form.postcode,
    country: form.country,
    operatingModel: form.operatingModel,
    currency: form.currency,
    timezone: form.timezone,
    pan: form.pan,
    gstin: form.gstin,
  };
}

function updateCentrePayload(form: CentreForm): UpdateCentreInput {
  return {
    name: form.name,
    newMobile: form.newMobile,
    email: form.email,
    addressLine1: form.addressLine1,
    city: form.city,
    stateRegion: form.stateRegion,
    postcode: form.postcode,
    country: form.country,
    operatingModel: form.operatingModel,
    currency: form.currency,
    timezone: form.timezone,
    pan: form.pan,
    gstin: form.gstin,
  };
}

function formFromCentre(centre: StaffCentre): CentreForm {
  return {
    name: centre.name,
    mobile: "",
    newMobile: "",
    email: centre.email,
    addressLine1: centre.addressLine1,
    city: centre.city,
    stateRegion: centre.stateRegion,
    postcode: centre.postcode,
    country: centre.country,
    operatingModel: centre.operatingModel,
    currency: centre.currency,
    timezone: centre.timezone,
    pan: centre.pan,
    gstin: centre.gstin,
  };
}

function upsertCentre(centres: StaffCentre[], centre: StaffCentre) {
  const existing = centres.findIndex((item) => item.id === centre.id);
  if (existing === -1) return [...centres, centre];
  return centres.map((item) => (item.id === centre.id ? centre : item));
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "Please try again.";
}
