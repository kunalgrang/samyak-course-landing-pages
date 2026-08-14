import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { verifyPublicCertificate, type PublicCertificateVerification } from "../../lib/api";

export function VerifyCertificatePage({ code }: { code: string }) {
  const [verification, setVerification] = useState<PublicCertificateVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decoded = useMemo(() => decodeURIComponent(code), [code]);

  useEffect(() => {
    document.title = "Verify Certificate | Samyak Sion";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    void verifyPublicCertificate(decoded)
      .then((response) => setVerification(response.verification))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not verify this certificate."));
  }, [decoded]);

  if (error) {
    return <main className="verify-page"><ErrorState title="Could not verify" message={error} /></main>;
  }
  if (!verification) {
    return <main className="verify-page"><LoadingState label="Checking certificate" /></main>;
  }
  const certificate = verification.certificate || {};
  return (
    <main className="verify-page">
      <section className="verify-panel">
        <img src="/samyak-logo.webp" alt="Samyak Computer Classes" />
        <p>{verification.issuer}</p>
        <p>A unit of Shree Services</p>
        <h1>{statusTitle(verification.status)}</h1>
        {verification.status === "not_found" ? (
          <p className="verify-muted">We could not verify this certificate code.</p>
        ) : (
          <dl>
            <div><dt>Student</dt><dd>{String(certificate.student_name_snapshot || "")}</dd></div>
            <div><dt>Student ID</dt><dd>{String(certificate.student_id_snapshot || "")}</dd></div>
            <div><dt>Course</dt><dd>{String(certificate.course_name_snapshot || "")}</dd></div>
            <div><dt>Certificate No.</dt><dd>{String(certificate.certificate_number || "")}</dd></div>
            <div><dt>Issue Date</dt><dd>{formatDate(String(certificate.issue_date || ""))}</dd></div>
            {certificate.completion_date_snapshot ? <div><dt>Completion Date</dt><dd>{formatDate(String(certificate.completion_date_snapshot))}</dd></div> : null}
          </dl>
        )}
        <footer>For verification support, contact info@samyaksion.com or +91 8422969307.</footer>
      </section>
    </main>
  );
}

function statusTitle(status: string) {
  if (status === "valid") return "VALID";
  if (status === "revoked") return "REVOKED";
  if (status === "superseded") return "SUPERSEDED";
  return "Could Not Verify";
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : value;
}
