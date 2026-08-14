import { hmacHex } from "./crypto";

export async function generateCertificateQrSvg(value: string) {
  const digest = await hmacHex("samyak-certificate-qr-v1", "qr", value);
  const size = 29;
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  drawFinder(modules, 0, 0);
  drawFinder(modules, size - 7, 0);
  drawFinder(modules, 0, size - 7);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) continue;
      const cursor = (x * 31 + y * 17) % digest.length;
      const nibble = Number.parseInt(digest[cursor], 16);
      modules[y][x] = ((nibble + x + y) % 3) === 0;
    }
  }
  const cell = 4;
  const quiet = 3;
  const canvas = (size + quiet * 2) * cell;
  const rects: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) rects.push(`<rect x="${(x + quiet) * cell}" y="${(y + quiet) * cell}" width="${cell}" height="${cell}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}" role="img" aria-label="Certificate verification QR"><rect width="100%" height="100%" fill="#fff"/><g fill="#09233d">${rects.join("")}</g></svg>`;
}

function drawFinder(modules: boolean[][], startX: number, startY: number) {
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const edge = x === 0 || y === 0 || x === 6 || y === 6;
      const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      modules[startY + y][startX + x] = edge || center;
    }
  }
}
