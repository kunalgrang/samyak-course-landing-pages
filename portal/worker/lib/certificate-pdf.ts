import type { CertificateRecord } from "./certificate-service";
import { branchDirectorSignature, branchDirectorSignatureBytes } from "./certificate-signature";

const encoder = new TextEncoder();

export type CertificatePdfInput = {
  certificate: CertificateRecord;
  verificationUrl: string;
};

export async function generateCertificatePdf(input: CertificatePdfInput) {
  const pageWidth = 842;
  const pageHeight = 595;
  const lines = certificateLines(input);
  const content = [
    "q",
    "1 1 1 rg 0 0 842 595 re f",
    "0.035 0.137 0.239 RG 3 w 28 28 786 539 re S",
    "0.051 0.580 0.533 RG 1.5 w 42 42 758 511 re S",
    text("SAMYAK COMPUTER CLASSES, SION", 72, 505, 24, "0.035 0.137 0.239"),
    text("A unit of Shree Services", 72, 480, 12, "0.388 0.439 0.514"),
    text("CERTIFICATE OF COMPLETION", 198, 420, 28, "0.051 0.580 0.533"),
    text("This is to certify that", 330, 370, 13, "0.388 0.439 0.514"),
    text(input.certificate.student_name_snapshot, 150, 325, 34, "0.035 0.137 0.239"),
    text("has successfully completed the course", 282, 282, 13, "0.388 0.439 0.514"),
    text(input.certificate.course_name_snapshot, 150, 244, 22, "0.035 0.137 0.239"),
    text("at Samyak Computer Classes, Sion - A unit of Shree Services.", 215, 216, 12, "0.388 0.439 0.514"),
    ...lines.map((line, index) => text(line, 82, 158 - index * 22, 11, "0.035 0.137 0.239")),
    text("Scan to verify authenticity", 82, 58, 10, "0.388 0.439 0.514"),
    "q 82 0 0 104 656 130 cm /Sig Do Q",
    "0.035 0.137 0.239 RG 1 w 626 116 142 0 l S",
    text("Branch Director", 648, 92, 13, "0.035 0.137 0.239"),
    text("info@samyaksion.com   www.samyaksion.com   +91 8422969307", 244, 48, 10, "0.388 0.439 0.514"),
    "Q",
  ].join("\n");
  const pdf = buildPdf(pageWidth, pageHeight, content);
  const hash = await sha256Hex(pdf);
  return { bytes: pdf, sha256: hash };
}

function certificateLines(input: CertificatePdfInput) {
  const cert = input.certificate;
  const rows = [
    `Student ID: ${cert.student_id_snapshot}`,
    `Certificate No: ${cert.certificate_number}`,
    cert.course_duration_label_snapshot ? `Course Duration: ${cert.course_duration_label_snapshot}` : null,
    `Course Code: ${cert.course_code_snapshot}`,
    `Issue Date: ${formatDate(cert.issue_date)}`,
    cert.completion_date_snapshot ? `Completion Date: ${formatDate(cert.completion_date_snapshot)}` : null,
    `Verify: ${input.verificationUrl}`,
  ];
  return rows.filter((row): row is string => Boolean(row));
}

function text(value: string, x: number, y: number, size: number, rgb: string) {
  return `${rgb} rg BT /F1 ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`;
}

function buildPdf(width: number, height: number, streamText: string) {
  const stream = encoder.encode(streamText);
  const signatureHex = bytesToHex(branchDirectorSignatureBytes());
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> /XObject << /Sig 6 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${streamText}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${branchDirectorSignature.width} /Height ${branchDirectorSignature.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${signatureHex.length + 1} >>\nstream\n${signatureHex}>\nendstream`,
  ];
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return encoder.encode(chunks.join(""));
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapePdf(value: string) {
  return value.replace(/[\\()]/g, (char) => `\\${char}`).slice(0, 220);
}

function byteLength(value: string) {
  return encoder.encode(value).length;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
}
