import qrcode from "qrcode-generator";
import type { CertificateIssuerProfile, CertificateRecord } from "./certificate-service";
import { branchDirectorSignature, branchDirectorSignatureBytes } from "./certificate-signature";
import {
  certificateTemplateSamyakCompletionV1,
  certificateTemplateSamyakCompletionV1CompressedBytes,
} from "./certificate-template";

const encoder = new TextEncoder();

export type CertificatePdfInput = {
  certificate: CertificateRecord;
  verificationUrl: string;
  issuer?: CertificateIssuerProfile | null;
};

export async function generateCertificatePdf(input: CertificatePdfInput) {
  if (isSamyakCertificate(input.certificate)) return generateSamyakCertificatePdf(input);
  return generateGenericCertificatePdf(input);
}

async function generateSamyakCertificatePdf(input: CertificatePdfInput) {
  const pageWidth = 842;
  const pageHeight = 595;
  const pageCenterX = pageWidth / 2;
  const lines = certificateLines(input);
  const nameLines = wrapText(input.certificate.student_name_snapshot, 560, 35, 2, "F2");
  const nameSize = nameLines.length > 1 ? 24 : fitFontSize(input.certificate.student_name_snapshot, 560, 35, 24, "F2");
  const courseLines = wrapText(input.certificate.course_name_snapshot, 610, 19, 2, "F4");
  const courseSize = courseLines.length > 1 ? 16 : fitFontSize(input.certificate.course_name_snapshot, 610, 19, 14, "F4");
  const nameStartY = nameLines.length > 1 ? 333 : 312;
  const courseStartY = courseLines.length > 1 ? 234 : 226;
  const nameGold = rgb(certificateTemplateSamyakCompletionV1.sampledGoldRgb);
  const content = [
    "q",
    `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Template Do Q`,
    ...nameLines.map((line, index) => centerText(line, pageCenterX, nameStartY - index * (nameSize + 5), nameSize, nameGold, "F2")),
    ...courseLines.map((line, index) => centerText(line, pageCenterX, courseStartY - index * (courseSize + 5), courseSize, "0.047 0.067 0.090", "F4")),
    ...drawQr(input.verificationUrl, 82, 94, 76),
    centerText("Scan to verify certificate", 120, 78, 8.5, "0.047 0.067 0.090"),
    ...lines.map((line, index) => text(line, 170, 142 - index * 13, 8.5, "0.047 0.067 0.090")),
    "q 40 0 0 50 644 98 cm /Sig Do Q",
    "Q",
  ].join("\n");
  const pdf = buildPdf(pageWidth, pageHeight, content, true);
  const hash = await sha256Hex(pdf);
  return { bytes: pdf, sha256: hash };
}

async function generateGenericCertificatePdf(input: CertificatePdfInput) {
  const pageWidth = 842;
  const pageHeight = 595;
  const pageCenterX = pageWidth / 2;
  const issuerName = input.issuer?.organisation_name || "Issuing Institute";
  const issuerLine = [input.issuer?.branch_name, input.issuer?.branch_city || input.issuer?.organisation_city].filter(Boolean).join(", ");
  const nameLines = wrapText(input.certificate.student_name_snapshot, 610, 34, 2, "F2");
  const courseLines = wrapText(input.certificate.course_name_snapshot, 650, 19, 2, "F4");
  const content = [
    "q",
    "0.980 0.984 0.988 rg 0 0 842 595 re f",
    "0.055 0.090 0.145 RG 0.8 w 36 36 770 523 re S",
    "0.710 0.545 0.165 RG 2 w 50 50 742 495 re S",
    centerText(issuerName, pageCenterX, 500, 22, "0.055 0.090 0.145", "F4"),
    issuerLine ? centerText(issuerLine, pageCenterX, 476, 11, "0.310 0.355 0.415") : "",
    centerText("Certificate of Completion", pageCenterX, 425, 34, "0.710 0.545 0.165", "F4"),
    centerText("This is to certify that", pageCenterX, 374, 14, "0.310 0.355 0.415"),
    ...nameLines.map((line, index) => centerText(line, pageCenterX, 332 - index * 31, nameLines.length > 1 ? 25 : 32, "0.055 0.090 0.145", "F2")),
    centerText("has successfully completed", pageCenterX, 268, 14, "0.310 0.355 0.415"),
    ...courseLines.map((line, index) => centerText(line, pageCenterX, 230 - index * 22, courseLines.length > 1 ? 17 : 19, "0.055 0.090 0.145", "F4")),
    ...drawQr(input.verificationUrl, 640, 86, 82),
    centerText("Scan to verify", 681, 72, 8.5, "0.055 0.090 0.145"),
    ...certificateLines(input).map((line, index) => text(line, 86, 146 - index * 14, 9.5, "0.055 0.090 0.145")),
    "0.310 0.355 0.415 RG 0.8 w 520 136 m 608 136 l S",
    centerText("Authorised Signatory", 564, 120, 9.5, "0.310 0.355 0.415"),
    "Q",
  ].filter(Boolean).join("\n");
  const pdf = buildPdf(pageWidth, pageHeight, content, false);
  const hash = await sha256Hex(pdf);
  return { bytes: pdf, sha256: hash };
}

function isSamyakCertificate(certificate: CertificateRecord) {
  return certificate.organisation_id === "org_samyak" && certificate.template_id === "ctpl_samyak_completion_v1";
}

function certificateLines(input: CertificatePdfInput) {
  const cert = input.certificate;
  const rows = [
    `Student ID: ${cert.student_id_snapshot}`,
    `Certificate No: ${cert.certificate_number}`,
    cert.course_duration_label_snapshot ? `Course Duration: ${cert.course_duration_label_snapshot}` : null,
    `Issue Date: ${formatDate(cert.issue_date)}`,
    cert.completion_date_snapshot ? `Completion Date: ${formatDate(cert.completion_date_snapshot)}` : null,
  ];
  return rows.filter((row): row is string => Boolean(row));
}

function text(value: string, x: number, y: number, size: number, rgb: string, font = "F1") {
  return `${rgb} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`;
}

function centerText(value: string, centerX: number, y: number, size: number, rgb: string, font = "F1") {
  return text(value, centerX - approximateTextWidth(value, size, font) / 2, y, size, rgb, font);
}

function rgb([red, green, blue]: readonly [number, number, number]) {
  return `${(red / 255).toFixed(3)} ${(green / 255).toFixed(3)} ${(blue / 255).toFixed(3)}`;
}

function drawQr(value: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const modules = qr.getModuleCount();
  const cell = size / modules;
  const rects = ["1 1 1 rg", `${x - 6} ${y - 6} ${size + 12} ${size + 12} re f`, "0.035 0.137 0.239 rg"];
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const rectX = x + col * cell;
      const rectY = y + (modules - row - 1) * cell;
      rects.push(`${rectX.toFixed(3)} ${rectY.toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f`);
    }
  }
  return rects;
}

function buildPdf(width: number, height: number, streamText: string, includeSamyakAssets: boolean) {
  const stream = encoder.encode(streamText);
  const pageResources = includeSamyakAssets
    ? "/Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> /XObject << /Template 9 0 R /Sig 10 0 R >>"
    : "/Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >>";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << ${pageResources} >> /Contents 8 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${streamText}\nendstream`,
  ];
  if (includeSamyakAssets) {
    const signatureHex = bytesToHex(branchDirectorSignatureBytes());
    const templateHex = bytesToHex(certificateTemplateSamyakCompletionV1CompressedBytes());
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${certificateTemplateSamyakCompletionV1.width} /Height ${certificateTemplateSamyakCompletionV1.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${templateHex.length + 1} >>\nstream\n${templateHex}>\nendstream`,
      `<< /Type /XObject /Subtype /Image /Width ${branchDirectorSignature.width} /Height ${branchDirectorSignature.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${signatureHex.length + 1} >>\nstream\n${signatureHex}>\nendstream`,
    );
  }
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

function wrapText(value: string, maxWidth: number, size: number, maxLines: number, font = "F1") {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (approximateTextWidth(next, size, font) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = lines.length === maxLines - 1 ? words.slice(index).join(" ") : word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) return [value.slice(0, 80)];
  const consumed = lines.join(" ").length;
  if (consumed < value.trim().length && lines.length === maxLines) {
    lines[maxLines - 1] = trimToWidth(lines[maxLines - 1], maxWidth, size, font);
  }
  return lines;
}

function trimToWidth(value: string, maxWidth: number, size: number, font = "F1") {
  let result = value;
  while (result.length > 4 && approximateTextWidth(`${result}...`, size, font) > maxWidth) result = result.slice(0, -1);
  return `${result.trim()}...`;
}

function fitFontSize(value: string, maxWidth: number, preferred: number, minimum: number, font = "F1") {
  let size = preferred;
  while (size > minimum && approximateTextWidth(value, size, font) > maxWidth) size -= 1;
  return size;
}

function approximateTextWidth(value: string, size: number, font = "F1") {
  const factor = font === "F3" ? 0.585 : font === "F4" ? 0.52 : font === "F2" ? 0.52 : 0.48;
  return value.length * size * factor;
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
