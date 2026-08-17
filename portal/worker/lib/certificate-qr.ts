import qrcode from "qrcode-generator";

export async function generateCertificateQrSvg(value: string) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const size = qr.getModuleCount();
  const cell = 4;
  const quiet = 3;
  const canvas = (size + quiet * 2) * cell;
  const rects: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.isDark(y, x)) rects.push(`<rect x="${(x + quiet) * cell}" y="${(y + quiet) * cell}" width="${cell}" height="${cell}"/>`);
    }
  }
  const escapedValue = escapeXml(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}" role="img" aria-label="Certificate verification QR" data-verification-url="${escapedValue}"><metadata>${escapedValue}</metadata><rect width="100%" height="100%" fill="#fff"/><g fill="#09233d">${rects.join("")}</g></svg>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === "\"") return "&quot;";
    return "&apos;";
  });
}
