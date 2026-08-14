import qrcode from "qrcode-generator";
import type { CertificateRecord } from "./certificate-service";
import { certificateLogo, certificateLogoCompressedBytes } from "./certificate-logo";
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
  const nameLines = wrapText(input.certificate.student_name_snapshot, 560, 34, 2);
  const nameSize = nameLines.length > 1 ? 26 : fitFontSize(input.certificate.student_name_snapshot, 560, 34, 22);
  const courseLines = wrapText(input.certificate.course_name_snapshot, 560, 22, 3);
  const courseSize = courseLines.length > 2 ? 14 : courseLines.length > 1 ? 17 : fitFontSize(input.certificate.course_name_snapshot, 560, 22, 15);
  const headerText = "SAMYAK COMPUTER CLASSES";
  const headerSize = 24;
  const logoHeight = 52;
  const logoWidth = logoHeight * (certificateLogo.width / certificateLogo.height);
  const headerGap = 12;
  const headerWidth = logoWidth + headerGap + approximateTextWidth(headerText, headerSize);
  const headerX = pageWidth / 2 - headerWidth / 2;
  const content = [
    "q",
    "1 1 1 rg 0 0 842 595 re f",
    "0.035 0.137 0.239 RG 3 w 28 28 786 539 re S",
    "0.051 0.580 0.533 RG 1.5 w 42 42 758 511 re S",
    `q ${logoWidth.toFixed(3)} 0 0 ${logoHeight} ${headerX.toFixed(3)} 485 cm /Logo Do Q`,
    text(headerText, headerX + logoWidth + headerGap, 501, headerSize, "0.035 0.137 0.239", "F3"),
    centerText("CERTIFICATE OF COMPLETION", pageWidth / 2, 424, 28, "0.051 0.580 0.533", "F3"),
    centerText("This is to certify that", pageWidth / 2, 374, 13, "0.388 0.439 0.514"),
    ...nameLines.map((line, index) => centerText(line, pageWidth / 2, 333 - index * (nameSize + 5), nameSize, "0.035 0.137 0.239", "F2")),
    centerText("has successfully completed the course", pageWidth / 2, nameLines.length > 1 ? 264 : 282, 13, "0.388 0.439 0.514"),
    ...courseLines.map((line, index) => centerText(line, pageWidth / 2, (nameLines.length > 1 ? 228 : 244) - index * (courseSize + 5), courseSize, "0.035 0.137 0.239", "F3")),
    centerText("at Samyak Computer Classes, Sion.", pageWidth / 2, courseLines.length > 1 ? 174 : 206, 12, "0.388 0.439 0.514"),
    ...drawQr(input.verificationUrl, 82, 84, 82),
    text("Scan to verify certificate", 74, 62, 10, "0.388 0.439 0.514"),
    ...lines.map((line, index) => text(line, 190, 160 - index * 18, 10.5, "0.035 0.137 0.239")),
    "q 49 0 0 62 672 146 cm /Sig Do Q",
    "0.035 0.137 0.239 RG 1 w 644 132 106 0 l S",
    centerText("Branch Director", 697, 108, 13, "0.035 0.137 0.239"),
    centerText("A unit of Shree Services", pageWidth / 2, 72, 10.5, "0.388 0.439 0.514"),
    centerText("info@samyaksion.com | www.samyaksion.com | +91 8422969307", pageWidth / 2, 54, 10.5, "0.388 0.439 0.514"),
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
  return text(value, centerX - approximateTextWidth(value, size) / 2, y, size, rgb, font);
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
  const logoHex = bytesToHex(certificateLogoCompressedBytes());
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> /XObject << /Sig 8 0 R /Logo 9 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${streamText}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${branchDirectorSignature.width} /Height ${branchDirectorSignature.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${signatureHex.length + 1} >>\nstream\n${signatureHex}>\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${certificateLogo.width} /Height ${certificateLogo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${logoHex.length + 1} >>\nstream\n${logoHex}>\nendstream`,
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

function wrapText(value: string, maxWidth: number, size: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (approximateTextWidth(next, size) <= maxWidth || !current) {
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
    lines[maxLines - 1] = trimToWidth(lines[maxLines - 1], maxWidth, size);
  }
  return lines;
}

function trimToWidth(value: string, maxWidth: number, size: number) {
  let result = value;
  while (result.length > 4 && approximateTextWidth(`${result}...`, size) > maxWidth) result = result.slice(0, -1);
  return `${result.trim()}...`;
}

function fitFontSize(value: string, maxWidth: number, preferred: number, minimum: number) {
  let size = preferred;
  while (size > minimum && approximateTextWidth(value, size) > maxWidth) size -= 1;
  return size;
}

function approximateTextWidth(value: string, size: number) {
  return value.length * size * 0.52;
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
