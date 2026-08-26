import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { TrustFooter } from "../../components/TrustFooter";
import {
  getPublicConfig,
  getPartnerSession,
  requestPartnerOtp,
  resendPartnerOtp,
  selectPartnerProfile,
  verifyPartnerOtp,
  type PartnerSessionResponse,
  type PublicConfig,
} from "../../lib/api";
import { isCompleteOtp, OTP_LENGTH, otpHelperText, sanitizeOtpInput } from "../auth/LoginPage";

type PartnerLoginPageProps = {
  sessionMessage?: string | null;
  onAuthenticated: () => void;
};

export function PartnerLoginPage({ sessionMessage, onAuthenticated }: PartnerLoginPageProps) {
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [maskedMobile, setMaskedMobile] = useState("");
  const [sessionChoices, setSessionChoices] = useState<PartnerSessionResponse | null>(null);
  const [step, setStep] = useState<"mobile" | "otp" | "profile">("mobile");
  const [cooldown, setCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mobileId = useId();
  const otpId = useId();
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    void getPublicConfig().then(setConfig).catch(() => setError("Partner login is temporarily unavailable."));
    void getPartnerSession().then((session) => {
      if (session.authenticated && session.activePartner) onAuthenticated();
      else if (session.authenticated && session.partners.length > 1) {
        setSessionChoices(session);
        setStep("profile");
      }
    }).catch(() => undefined);
  }, [onAuthenticated]);

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

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config?.otpEnabled) {
      setError("Partner login is temporarily unavailable.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the verification check before continuing.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await requestPartnerOtp(mobile, turnstileToken);
      resetTurnstile();
      if (!result.success || !result.challengeId) {
        setError(result.message || "Partner login is temporarily unavailable.");
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
      const result = await verifyPartnerOtp(challengeId, otp);
      if (!result.success || !result.session) {
        setError(result.message || "The OTP could not be verified.");
        return;
      }
      handleSession(result.session);
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
      const result = await resendPartnerOtp(challengeId);
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

  async function handleSelectPartner(educationPartnerId: string) {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await selectPartnerProfile(educationPartnerId);
      if (!result.success || !result.session?.activePartner) {
        setError(result.message || "This partner profile is not available.");
        return;
      }
      onAuthenticated();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSession(nextSession: PartnerSessionResponse) {
    if (nextSession.partners.length > 1 && !nextSession.activePartner) {
      setSessionChoices(nextSession);
      setStep("profile");
      return;
    }
    if (nextSession.activePartner) onAuthenticated();
    else setError("This partner profile is not available.");
  }

  function changeNumber() {
    setStep("mobile");
    setOtp("");
    setChallengeId("");
    setMaskedMobile("");
    setSessionChoices(null);
    setError(null);
  }

  function resetTurnstile() {
    setTurnstileToken("");
    window.turnstile?.reset(widgetIdRef.current);
  }

  if (!config) {
    return (
      <main className="login-page">
        <section className="login-shell">
          <BrandMark />
          <LoadingState label="Preparing partner login" />
        </section>
        <TrustFooter />
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-labelledby="partner-login-title">
        <BrandMark />
        <div className="login-shell__content">
          <h1 id="partner-login-title">Partner access</h1>
          <p>Sign in with the mobile number registered for your Education Partner profile.</p>
        </div>

        {step === "mobile" ? (
          <form className="login-form" onSubmit={handleRequestOtp}>
            <label htmlFor={mobileId}>Mobile number</label>
            <input
              id={mobileId}
              name="mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              placeholder="Enter registered mobile"
            />
            <div ref={widgetContainerRef} className="turnstile-slot" />
            {!error && sessionMessage ? <ErrorState title="Please sign in again" message={sessionMessage} /> : null}
            {error ? <ErrorState title="Could not continue" message={error} /> : null}
            <button type="submit" disabled={isSubmitting || !config.otpEnabled}>
              {isSubmitting ? "Sending..." : "Continue"}
            </button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form className="login-form" onSubmit={handleVerifyOtp}>
            <label htmlFor={otpId}>OTP sent to {maskedMobile}</label>
            <p className="field-help">{otpHelperText}</p>
            <input
              id={otpId}
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              pattern="\d{4}"
              aria-label="Enter OTP"
              value={otp}
              onChange={(event) => setOtp(sanitizeOtpInput(event.target.value))}
              placeholder="Enter OTP"
            />
            {error ? <ErrorState title="Could not verify" message={error} /> : null}
            <button type="submit" disabled={isSubmitting || !isCompleteOtp(otp)}>{isSubmitting ? "Verifying..." : "Verify"}</button>
            <div className="login-actions">
              <button type="button" className="button-secondary" onClick={handleResend} disabled={cooldown > 0 || isSubmitting}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
              </button>
              <button type="button" className="button-secondary" onClick={changeNumber}>Change number</button>
            </div>
          </form>
        ) : null}

        {step === "profile" && sessionChoices ? (
          <div className="login-form">
            <p className="field-label">Choose partner profile</p>
            <div className="profile-choice-list">
              {sessionChoices.partners.map((partner) => (
                <button key={partner.educationPartnerId} type="button" className="profile-choice" onClick={() => handleSelectPartner(partner.educationPartnerId)}>
                  <span>{partner.businessName}</span>
                  <small>{partner.branchName || label(partner.partnerType)}</small>
                </button>
              ))}
            </div>
            {error ? <ErrorState title="Could not select profile" message={error} /> : null}
          </div>
        ) : null}
      </section>
      <TrustFooter />
    </main>
  );
}

function label(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}
