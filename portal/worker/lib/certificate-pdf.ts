import qrcode from "qrcode-generator";
import type { CertificateRecord } from "./certificate-service";
import { branchDirectorSignature, branchDirectorSignatureBytes } from "./certificate-signature";
import {
  certificateTemplateSamyakCompletionV1,
  certificateTemplateSamyakCompletionV1CompressedBytes,
} from "./certificate-template";

const encoder = new TextEncoder();

export type CertificatePdfInput = {
  certificate: CertificateRecord;
  verificationUrl: string;
};

export async function generateCertificatePdf(input: CertificatePdfInput) {
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
    ...lines.map((line, index) => text(line, 178, 142 - index * 13, 8.5, "0.047 0.067 0.090")),
    "q 40 0 0 50 644 98 cm /Sig Do Q",
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

function buildPdf(width: number, height: number, streamText: string) {
  const stream = encoder.encode(streamText);
  const signatureHex = bytesToHex(branchDirectorSignatureBytes());
  const templateHex = bytesToHex(certificateTemplateSamyakCompletionV1CompressedBytes());
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> /XObject << /Template 9 0 R /Sig 10 0 R >> >> /Contents 8 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${streamText}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${certificateTemplateSamyakCompletionV1.width} /Height ${certificateTemplateSamyakCompletionV1.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${templateHex.length + 1} >>\nstream\n${templateHex}>\nendstream`,
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
  const factor = font === "F3" || font === "F4" ? 0.585 : 0.52;
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
