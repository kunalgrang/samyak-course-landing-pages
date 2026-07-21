import { FormEvent, useId, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { ErrorState } from "../../components/ErrorState";
import { useAuth } from "./AuthContext";

type LoginPageProps = {
  onAuthenticated: () => void;
};

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { signInForShell } = useAuth();
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mobileId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digitsOnly = mobile.replace(/\D/g, "");

    if (digitsOnly.length < 10) {
      setError("Enter a valid mobile number to open the temporary portal shell.");
      return;
    }

    setError(null);
    signInForShell();
    onAuthenticated();
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-labelledby="login-title">
        <BrandMark />
        <div className="login-shell__content">
          <h1 id="login-title">Student access</h1>
          <p>
            This pass creates the portal shell only. OTP verification will be connected in a later
            pass.
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
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
          {error ? <ErrorState title="Check mobile number" message={error} /> : null}
          <button type="submit">Open temporary shell</button>
        </form>
      </section>
    </main>
  );
}
