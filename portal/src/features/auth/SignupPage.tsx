import { FormEvent, useEffect, useId, useRef, useState } from "react";
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

const defaultForm = {
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
  country: "India",
  postcode: "",
  pan: "",
  gstin: "",
  website: "",
  centreName: "",
  centreAddress: "",
  centreCity: "",
  centreStateRegion: "",
  centrePostcode: "",
  centreCountry: "India",
  centreMobile: "",
  centreEmail: "",
  centreOperatingModel: "company_owned",
  centreStatus: "active",
  termsAccepted: false,
};

export function SignupPage({ onComplete }: SignupPageProps) {
  const { refreshSession } = useAuth();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [form, setForm] = useState(defaultForm);
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

  function update<K extends keyof typeof defaultForm>(key: K, value: (typeof defaultForm)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
        country: form.country,
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
      centre: {
        name: form.centreName,
        address: form.centreAddress,
        city: form.centreCity,
        stateRegion: form.centreStateRegion,
        postcode: form.centrePostcode,
        country: form.centreCountry,
        mobile: form.centreMobile,
        email: form.centreEmail,
        operatingModel: form.centreOperatingModel,
        status: form.centreStatus,
      },
    };
  }

  function validateDetails() {
    const required = [
      form.brandName,
      form.legalName,
      form.authorityName,
      form.authorityEmail,
      form.address,
      form.city,
      form.stateRegion,
      form.country,
      form.centreName,
      form.centreAddress,
      form.centreCity,
      form.centreStateRegion,
      form.centrePostcode,
      form.centreCountry,
      form.centreMobile,
    ];
    if (required.some((value) => !String(value).trim())) return "Complete all required fields.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.authorityEmail.trim())) return "Enter a valid authorised contact email.";
    if (form.centreEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.centreEmail.trim())) return "Enter a valid Centre email.";
    if (!form.termsAccepted) return "Accept the platform terms and data policy to continue.";
    return null;
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
              <input aria-label="Institute / Brand Name" placeholder="Institute / Brand Name" value={form.brandName} onChange={(event) => update("brandName", event.target.value)} />
              <input aria-label="Legal Name" placeholder="Legal Name" value={form.legalName} onChange={(event) => update("legalName", event.target.value)} />
              <select aria-label="Organisation Type" value={form.organisationType} onChange={(event) => update("organisationType", event.target.value)}>
                {organisationTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select aria-label="Legal Entity Type" value={form.legalEntityType} onChange={(event) => update("legalEntityType", event.target.value)}>
                {legalEntityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input aria-label="Address" placeholder="Address" value={form.address} onChange={(event) => update("address", event.target.value)} />
              <input aria-label="City" placeholder="City" value={form.city} onChange={(event) => update("city", event.target.value)} />
              <input aria-label="State / Region" placeholder="State / Region" value={form.stateRegion} onChange={(event) => update("stateRegion", event.target.value)} />
              <input aria-label="Country" placeholder="Country" value={form.country} onChange={(event) => update("country", event.target.value)} />
              <input aria-label="Postcode / PIN" placeholder="Postcode / PIN" value={form.postcode} onChange={(event) => update("postcode", event.target.value)} />
              <input aria-label="PAN" placeholder="PAN, if applicable" value={form.pan} onChange={(event) => update("pan", event.target.value.toUpperCase())} />
              <input aria-label="GSTIN" placeholder="GSTIN, if applicable" value={form.gstin} onChange={(event) => update("gstin", event.target.value.toUpperCase())} />
              <input aria-label="Website" placeholder="Website, optional" value={form.website} onChange={(event) => update("website", event.target.value)} />
            </fieldset>

            <fieldset>
              <legend>Authorised Account</legend>
              <input aria-label="Owner / Authorised Contact Name" placeholder="Owner / Authorised Contact Name" value={form.authorityName} onChange={(event) => update("authorityName", event.target.value)} />
              <input aria-label="Owner / Authorised Contact Email" placeholder="Owner / Authorised Contact Email" value={form.authorityEmail} onChange={(event) => update("authorityEmail", event.target.value)} />
            </fieldset>

            <fieldset>
              <legend>Initial Centre</legend>
              <input aria-label="Centre Name" placeholder="Centre Name" value={form.centreName} onChange={(event) => update("centreName", event.target.value)} />
              <input aria-label="Centre Address" placeholder="Centre Address" value={form.centreAddress} onChange={(event) => update("centreAddress", event.target.value)} />
              <input aria-label="Centre City" placeholder="Centre City" value={form.centreCity} onChange={(event) => update("centreCity", event.target.value)} />
              <input aria-label="Centre State / Region" placeholder="Centre State / Region" value={form.centreStateRegion} onChange={(event) => update("centreStateRegion", event.target.value)} />
              <input aria-label="Centre Postcode / PIN" placeholder="Centre Postcode / PIN" value={form.centrePostcode} onChange={(event) => update("centrePostcode", event.target.value)} />
              <input aria-label="Centre Country" placeholder="Centre Country" value={form.centreCountry} onChange={(event) => update("centreCountry", event.target.value)} />
              <input aria-label="Centre Mobile" placeholder="Centre Mobile" value={form.centreMobile} onChange={(event) => update("centreMobile", event.target.value)} />
              <input aria-label="Centre Email" placeholder="Centre Email, optional" value={form.centreEmail} onChange={(event) => update("centreEmail", event.target.value)} />
              <select aria-label="Operating Model" value={form.centreOperatingModel} onChange={(event) => update("centreOperatingModel", event.target.value)}>
                <option value="company_owned">Company-owned</option>
                <option value="franchise_operated">Franchise-operated</option>
              </select>
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
