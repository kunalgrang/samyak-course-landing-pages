import React, { FormEvent, useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { TrustFooter } from "../../components/TrustFooter";
import {
  createSignupOrganisation,
  getPublicConfig,
  requestSignupOtp,
  resendSignupOtp,
  verifySignupOtp,
  type PublicConfig,
  type SignupCreateInput,
} from "../../lib/api";
import {
  DEFAULT_COUNTRY_CODE,
  countries,
  countryByCode,
  countryName,
  hasCuratedSubdivisions,
  isValidSubdivision,
  subdivisionLabel,
} from "../../lib/geography";
import { useAuth } from "./AuthContext";
import { OTP_LENGTH, isCompleteOtp, otpHelperText, sanitizeOtpInput } from "./LoginPage";

type SignupPageProps = {
  onComplete: () => void;
};

const organisationTypes = [
  ["computer_training_institute", "Computer Training Institute"],
  ["coaching_centre", "Coaching Centre"],
  ["vocational_institute", "Vocational Institute"],
  ["language_institute", "Language Institute"],
  ["corporate_training_provider", "Corporate Training Provider"],
  ["tuition_centre", "Tuition Centre"],
  ["other", "Other"],
] as const;

const legalEntityTypes = [
  ["proprietorship", "Proprietorship"],
  ["partnership", "Partnership"],
  ["llp", "LLP"],
  ["private_limited", "Private Limited"],
  ["public_limited", "Limited / Public Limited"],
  ["trust_society", "Trust / Society"],
  ["individual", "Individual / Sole Professional"],
  ["other", "Other"],
] as const;

export const signupDefaultForm = {
  mobile: "",
  brandName: "",
  legalName: "",
  organisationType: "computer_training_institute",
  legalEntityType: "proprietorship",
  authorityName: "",
  authorityEmail: "",
  address: "",
  city: "",
  stateRegion: "",
  countryCode: DEFAULT_COUNTRY_CODE,
  postcode: "",
  pan: "",
  gstin: "",
  website: "",
  centreName: "",
  centreAddress: "",
  centreCity: "",
  centreStateRegion: "",
  centrePostcode: "",
  centreCountryCode: DEFAULT_COUNTRY_CODE,
  centreMobile: "",
  centreEmail: "",
  centreOperatingModel: "company_owned",
  centreStatus: "active",
  sameCentreAddress: true,
  sameCentreContact: true,
  hasMultipleCentres: false,
  reportedCentreCount: "1",
  termsAccepted: false,
};

export type SignupFormState = typeof signupDefaultForm;

export function buildSignupCreatePayload(form: SignupFormState, signupVerificationId: string, idempotencyKey: string): SignupCreateInput {
  const centreAddress = centreAddressValues(form);
  const centreContact = centreContactValues(form);
  return {
    signupVerificationId,
    idempotencyKey,
    organisation: {
      brandName: form.brandName,
      legalName: form.legalName,
      organisationType: form.organisationType,
      legalEntityType: form.legalEntityType,
      address: form.address,
      city: form.city,
      stateRegion: form.stateRegion,
      country: countryName(form.countryCode),
      postcode: form.postcode,
      pan: form.pan,
      gstin: form.gstin,
      website: form.website,
      termsAccepted: form.termsAccepted,
    },
    authority: {
      name: form.authorityName,
      mobile: form.mobile,
      email: form.authorityEmail,
    },
    onboarding: {
      reportedCentreCount: reportedCentreCount(form),
    },
    centre: {
      name: form.centreName,
      address: centreAddress.address,
      city: centreAddress.city,
      stateRegion: centreAddress.stateRegion,
      postcode: centreAddress.postcode,
      country: centreAddress.country,
      mobile: centreContact.mobile,
      email: centreContact.email,
      operatingModel: form.centreOperatingModel,
      status: form.centreStatus,
    },
  };
}

export function validateSignupFormDetails(form: SignupFormState) {
  const centreAddress = centreAddressValues(form);
  const centreContact = centreContactValues(form);
  const required = [
    form.brandName,
    form.legalName,
    form.authorityName,
    form.authorityEmail,
    form.address,
    form.city,
    form.countryCode,
    form.centreName,
    centreAddress.address,
    centreAddress.city,
    centreAddress.postcode,
    centreAddress.country,
    centreContact.mobile,
  ];
  if (required.some((value) => !String(value).trim())) return "Complete all required fields.";
  if (hasCuratedSubdivisions(form.countryCode) && !form.stateRegion) return `Choose the organisation ${subdivisionLabel(form.countryCode)}.`;
  if (!form.sameCentreAddress && hasCuratedSubdivisions(form.centreCountryCode) && !form.centreStateRegion) return `Choose the Centre ${subdivisionLabel(form.centreCountryCode)}.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.authorityEmail.trim())) return "Enter a valid authorised contact email.";
  if (centreContact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(centreContact.email.trim())) return "Enter a valid Centre email.";
  if (form.hasMultipleCentres && reportedCentreCount(form) < 2) return "Enter at least 2 Centres, or choose No.";
  if (!form.termsAccepted) return "Accept the platform terms and data policy to continue.";
  return null;
}

function centreAddressValues(form: SignupFormState) {
  if (form.sameCentreAddress) {
    return {
      address: form.address,
      city: form.city,
      stateRegion: form.stateRegion,
      postcode: form.postcode,
      country: countryName(form.countryCode),
    };
  }
  return {
    address: form.centreAddress,
    city: form.centreCity,
    stateRegion: form.centreStateRegion,
    postcode: form.centrePostcode,
    country: countryName(form.centreCountryCode),
  };
}

function centreContactValues(form: SignupFormState) {
  if (form.sameCentreContact) return { mobile: form.mobile, email: form.authorityEmail };
  return { mobile: form.centreMobile, email: form.centreEmail };
}

function reportedCentreCount(form: SignupFormState) {
  if (!form.hasMultipleCentres) return 1;
  return Number.parseInt(form.reportedCentreCount, 10);
}

export function SignupPage({ onComplete }: SignupPageProps) {
  const { refreshSession } = useAuth();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [form, setForm] = useState(signupDefaultForm);
  const [step, setStep] = useState<"mobile" | "otp" | "details" | "done">("mobile");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [signupVerificationId, setSignupVerificationId] = useState("");
  const [maskedMobile, setMaskedMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const mobileId = useId();
  const otpId = useId();
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    void getPublicConfig().then(setConfig).catch(() => setError("Signup is temporarily unavailable."));
  }, []);

  useEffect(() => {
    if (window.turnstile) {
      setTurnstileReady(true);
      return;
    }
    const timer = window.setInterval(() => {
      if (window.turnstile) {
        setTurnstileReady(true);
        window.clearInterval(timer);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!config?.turnstileSiteKey || !widgetContainerRef.current || step !== "mobile") return;
    if (turnstileReady && window.turnstile && !widgetIdRef.current) {
      widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
        sitekey: config.turnstileSiteKey,
        action: "request-otp",
        callback: setTurnstileToken,
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = undefined;
    };
  }, [config?.turnstileSiteKey, step, turnstileReady]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function update<K extends keyof SignupFormState>(key: K, value: SignupFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateCountry(key: "countryCode" | "centreCountryCode", stateKey: "stateRegion" | "centreStateRegion", value: string) {
    setForm((current) => {
      const currentState = current[stateKey];
      const nextState = current[key] === value && isValidSubdivision(value, currentState) ? currentState : "";
      return { ...current, [key]: value, [stateKey]: nextState };
    });
  }

  function updateMultipleCentres(value: boolean) {
    setForm((current) => ({ ...current, hasMultipleCentres: value, reportedCentreCount: value ? current.reportedCentreCount === "1" ? "2" : current.reportedCentreCount : "1" }));
  }

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config?.otpEnabled) {
      setError("Mobile signup is temporarily unavailable.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the verification check before continuing.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await requestSignupOtp(form.mobile, turnstileToken);
      resetTurnstile();
      if (!result.success || !result.challengeId) {
        setError(result.message || "Mobile signup is temporarily unavailable.");
        return;
      }
      setChallengeId(result.challengeId);
      setMaskedMobile(result.maskedMobile || "******");
      setCooldown(60);
      setStep("otp");
    } catch {
      resetTurnstile();
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await verifySignupOtp(challengeId, otp);
      if (!result.success || !result.signupVerificationId) {
        setError(result.message || "The OTP could not be verified.");
        return;
      }
      setSignupVerificationId(result.signupVerificationId);
      setStep("details");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0 || !challengeId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await resendSignupOtp(challengeId);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setCooldown(60);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateOrganisation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateDetails();
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createSignupOrganisation(buildPayload());
      if (!result.success) {
        setError(result.message || "Could not create organisation.");
        return;
      }
      setTrialEndsAt(result.trial?.endsAt || "");
      await refreshSession();
      setStep("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildPayload(): SignupCreateInput {
    return buildSignupCreatePayload(form, signupVerificationId, idempotencyKey);
  }

  function validateDetails() {
    return validateSignupFormDetails(form);
  }

  function resetTurnstile() {
    setTurnstileToken("");
    window.turnstile?.reset(widgetIdRef.current);
  }

  if (!config) {
    return (
      <main className="login-page">
        <section className="login-shell"><BrandMark /><LoadingState label="Preparing secure signup" /></section>
        <TrustFooter />
      </main>
    );
  }

  return (
    <main className="signup-page">
      <section className="signup-shell" aria-labelledby="signup-title">
        <BrandMark />
        <div className="login-shell__content">
          <h1 id="signup-title">Create organisation</h1>
          <p>Start a 15-day trial with your first Centre and owner account.</p>
        </div>

        {step === "mobile" ? (
          <form className="login-form" onSubmit={handleRequestOtp}>
            <label htmlFor={mobileId}>Authorised mobile number</label>
            <input id={mobileId} type="tel" inputMode="tel" autoComplete="tel" value={form.mobile} onChange={(event) => update("mobile", event.target.value)} placeholder="Enter mobile" />
            <div ref={widgetContainerRef} className="turnstile-slot" />
            {error ? <ErrorState title="Could not continue" message={error} /> : null}
            <button type="submit" disabled={isSubmitting || !config.otpEnabled}>{isSubmitting ? "Sending..." : "Send OTP"}</button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form className="login-form" onSubmit={handleVerifyOtp}>
            <label htmlFor={otpId}>OTP sent to {maskedMobile}</label>
            <p className="field-help">{otpHelperText}</p>
            <input id={otpId} type="text" inputMode="numeric" maxLength={OTP_LENGTH} value={otp} onChange={(event) => setOtp(sanitizeOtpInput(event.target.value))} placeholder="Enter OTP" />
            {error ? <ErrorState title="Could not verify" message={error} /> : null}
            <button type="submit" disabled={isSubmitting || !isCompleteOtp(otp)}>{isSubmitting ? "Verifying..." : "Verify mobile"}</button>
            <div className="login-actions">
              <button type="button" className="button-secondary" onClick={handleResend} disabled={cooldown > 0 || isSubmitting}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}</button>
              <button type="button" className="button-secondary" onClick={() => setStep("mobile")}>Change number</button>
            </div>
          </form>
        ) : null}

        {step === "details" ? (
          <form className="signup-form" onSubmit={handleCreateOrganisation}>
            <fieldset>
              <legend>Organisation</legend>
              <Field label="Institute / Brand Name"><input value={form.brandName} onChange={(event) => update("brandName", event.target.value)} /></Field>
              <Field label="Legal Name"><input value={form.legalName} onChange={(event) => update("legalName", event.target.value)} /></Field>
              <Field label="Organisation Type">
                <select value={form.organisationType} onChange={(event) => update("organisationType", event.target.value)}>
                  {organisationTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Legal Entity Type">
                <select value={form.legalEntityType} onChange={(event) => update("legalEntityType", event.target.value)}>
                  {legalEntityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <CountryField label="Country" value={form.countryCode} onChange={(value) => updateCountry("countryCode", "stateRegion", value)} />
              <SubdivisionField countryCode={form.countryCode} value={form.stateRegion} onChange={(value) => update("stateRegion", value)} />
              <Field label="City"><input value={form.city} onChange={(event) => update("city", event.target.value)} /></Field>
              <Field label="Postcode / PIN"><input value={form.postcode} onChange={(event) => update("postcode", event.target.value)} /></Field>
              <Field label="Address"><input value={form.address} onChange={(event) => update("address", event.target.value)} /></Field>
              <Field label="PAN"><input placeholder="If applicable" value={form.pan} onChange={(event) => update("pan", event.target.value.toUpperCase())} /></Field>
              <Field label="GSTIN"><input placeholder="If applicable" value={form.gstin} onChange={(event) => update("gstin", event.target.value.toUpperCase())} /></Field>
              <Field label="Website"><input placeholder="Optional" value={form.website} onChange={(event) => update("website", event.target.value)} /></Field>
            </fieldset>

            <fieldset>
              <legend>Authorised Account</legend>
              <Field label="Owner / Authorised Contact Name"><input value={form.authorityName} onChange={(event) => update("authorityName", event.target.value)} /></Field>
              <Field label="Owner / Authorised Contact Email"><input type="email" value={form.authorityEmail} onChange={(event) => update("authorityEmail", event.target.value)} /></Field>
              <p className="signup-form__note">Verified mobile: {maskedMobile || "the OTP-verified signup mobile"}</p>
            </fieldset>

            <fieldset>
              <legend>Initial Centre</legend>
              <div className="signup-form__full">
                <p className="field-label">Does your organisation operate more than one Centre?</p>
                <div className="segmented-control" role="group" aria-label="Does your organisation operate more than one Centre?">
                  <button type="button" className={!form.hasMultipleCentres ? "segmented-control__button segmented-control__button--active" : "segmented-control__button"} onClick={() => updateMultipleCentres(false)}>No</button>
                  <button type="button" className={form.hasMultipleCentres ? "segmented-control__button segmented-control__button--active" : "segmented-control__button"} onClick={() => updateMultipleCentres(true)}>Yes</button>
                </div>
              </div>
              {form.hasMultipleCentres ? (
                <Field label="How many Centres do you currently operate?"><input type="number" min="2" max="500" value={form.reportedCentreCount} onChange={(event) => update("reportedCentreCount", event.target.value)} /></Field>
              ) : null}
              <Field label="Centre Name"><input value={form.centreName} onChange={(event) => update("centreName", event.target.value)} /></Field>
              <label className="checkbox-row signup-form__full">
                <input type="checkbox" checked={form.sameCentreAddress} onChange={(event) => update("sameCentreAddress", event.target.checked)} />
                <span>Same as organisation address</span>
              </label>
              {!form.sameCentreAddress ? (
                <>
                  <CountryField label="Centre Country" value={form.centreCountryCode} onChange={(value) => updateCountry("centreCountryCode", "centreStateRegion", value)} />
                  <SubdivisionField labelPrefix="Centre" countryCode={form.centreCountryCode} value={form.centreStateRegion} onChange={(value) => update("centreStateRegion", value)} />
                  <Field label="Centre City"><input value={form.centreCity} onChange={(event) => update("centreCity", event.target.value)} /></Field>
                  <Field label="Centre Postcode / PIN"><input value={form.centrePostcode} onChange={(event) => update("centrePostcode", event.target.value)} /></Field>
                  <Field label="Centre Address"><input value={form.centreAddress} onChange={(event) => update("centreAddress", event.target.value)} /></Field>
                </>
              ) : null}
              <label className="checkbox-row signup-form__full">
                <input type="checkbox" checked={form.sameCentreContact} onChange={(event) => update("sameCentreContact", event.target.checked)} />
                <span>Same contact details as authorised account</span>
              </label>
              {!form.sameCentreContact ? (
                <>
                  <Field label="Centre Mobile"><input type="tel" inputMode="tel" value={form.centreMobile} onChange={(event) => update("centreMobile", event.target.value)} /></Field>
                  <Field label="Centre Email"><input type="email" placeholder="Optional" value={form.centreEmail} onChange={(event) => update("centreEmail", event.target.value)} /></Field>
                </>
              ) : null}
              <Field label="Operating Model">
                <select value={form.centreOperatingModel} onChange={(event) => update("centreOperatingModel", event.target.value)}>
                  <option value="company_owned">Company-owned</option>
                  <option value="franchise_operated">Franchise-operated</option>
                </select>
              </Field>
            </fieldset>

            <label className="checkbox-row">
              <input type="checkbox" checked={form.termsAccepted} onChange={(event) => update("termsAccepted", event.target.checked)} />
              <span>I accept the platform terms and data policy.</span>
            </label>
            {error ? <ErrorState title="Could not create organisation" message={error} /> : null}
            <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create organisation"}</button>
          </form>
        ) : null}

        {step === "done" ? (
          <div className="login-form">
            <p className="field-label">Trial activated</p>
            <p>Your 15-day trial is active{trialEndsAt ? ` until ${trialEndsAt.slice(0, 10)}` : ""}.</p>
            <button type="button" onClick={onComplete}>Enter portal</button>
          </div>
        ) : null}
      </section>
      <TrustFooter />
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ "aria-label"?: string; placeholder?: string }> }) {
  return (
    <label className="signup-field">
      <span>{label}</span>
      {React.cloneElement(children, {
        "aria-label": children.props["aria-label"] || label,
        placeholder: children.props.placeholder,
      })}
    </label>
  );
}

function CountryField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
      </select>
    </Field>
  );
}

function SubdivisionField({
  labelPrefix = "",
  countryCode,
  value,
  onChange,
}: {
  labelPrefix?: string;
  countryCode: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const country = countryByCode(countryCode);
  const label = [labelPrefix, subdivisionLabel(countryCode)].filter(Boolean).join(" ");
  if (country?.subdivisions?.length) {
    return (
      <Field label={label}>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose {label}</option>
          {country.subdivisions.map((subdivision) => <option key={subdivision.name} value={subdivision.name}>{subdivision.name}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}
