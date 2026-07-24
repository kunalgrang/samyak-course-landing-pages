import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { getPublicConfig, requestOtp, resendOtp, selectProfile, verifyOtp, type PublicConfig, type SessionResponse } from "../../lib/api";
import { useAuth } from "./AuthContext";

type LoginPageProps = {
  onAuthenticated: () => void;
};

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { setAuthenticatedSession } = useAuth();
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [maskedMobile, setMaskedMobile] = useState("");
  const [sessionChoices, setSessionChoices] = useState<SessionResponse | null>(null);
  const [step, setStep] = useState<"mobile" | "otp" | "profile">("mobile");
  const [cooldown, setCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mobileId = useId();
  const otpId = useId();
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    void getPublicConfig().then(setConfig).catch(() => setError("Mobile login is temporarily unavailable."));
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
    if (!config?.turnstileSiteKey || !widgetContainerRef.current) return;
    if (turnstileReady && window.turnstile && !widgetIdRef.current) {
      widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
        sitekey: config.turnstileSiteKey,
        action: "request-otp",
        callback: setTurnstileToken,
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    }
  }, [config?.turnstileSiteKey, turnstileReady]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config?.otpEnabled) {
      setError("Mobile login is temporarily unavailable.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the verification check before continuing.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await requestOtp(mobile, turnstileToken);
      resetTurnstile();
      if (!result.success || !result.challengeId) {
        setError(result.message || "Mobile login is temporarily unavailable.");
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
      const result = await verifyOtp(challengeId, otp);
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
      const result = await resendOtp(challengeId);
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

  async function handleSelectProfile(personId: string) {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await selectProfile(personId);
      if (!result.success || !result.session) {
        setError(result.message || "This profile is not available.");
        return;
      }
      handleSession(result.session);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSession(nextSession: SessionResponse) {
    if (nextSession.profiles.length > 1 && !nextSession.activeProfile) {
      setSessionChoices(nextSession);
      setStep("profile");
      return;
    }
    setAuthenticatedSession(nextSession);
    onAuthenticated();
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
          <LoadingState label="Preparing secure login" />
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-labelledby="login-title">
        <BrandMark />
        <div className="login-shell__content">
          <h1 id="login-title">Student access</h1>
          <p>Sign in with the mobile number registered for your Samyak referral profile.</p>
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
            {error ? <ErrorState title="Could not continue" message={error} /> : null}
            <button type="submit" disabled={isSubmitting || !config.otpEnabled}>
              {isSubmitting ? "Sending..." : "Continue"}
            </button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form className="login-form" onSubmit={handleVerifyOtp}>
            <label htmlFor={otpId}>OTP sent to {maskedMobile}</label>
            <input
              id={otpId}
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Six-digit OTP"
            />
            {error ? <ErrorState title="Could not verify" message={error} /> : null}
            <button type="submit" disabled={isSubmitting || otp.length < 4}>
              {isSubmitting ? "Verifying..." : "Verify"}
            </button>
            <div className="login-actions">
              <button type="button" className="button-secondary" onClick={handleResend} disabled={cooldown > 0 || isSubmitting}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
              </button>
              <button type="button" className="button-secondary" onClick={changeNumber}>
                Change number
              </button>
            </div>
          </form>
        ) : null}

        {step === "profile" && sessionChoices ? (
          <div className="login-form">
            <p className="field-label">Choose student profile</p>
            <div className="profile-choice-list">
              {sessionChoices.profiles.map((profile) => (
                <button key={profile.personId} type="button" className="profile-choice" onClick={() => handleSelectProfile(profile.personId)}>
                  <span>{profile.publicName}</span>
                  <small>{profile.accessType}</small>
                </button>
              ))}
            </div>
            {error ? <ErrorState title="Could not select profile" message={error} /> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
