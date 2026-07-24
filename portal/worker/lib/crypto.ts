const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function hmacHex(secret: string, context: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${context}:${value}`));
  return bytesToHex(new Uint8Array(signature));
}

export function createOpaqueId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function encryptText(secret: string, context: string, value: string) {
  const key = await aesKey(secret, context);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `v1:${base64Url(iv)}:${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptText(secret: string, context: string, ciphertext: string) {
  const [version, ivText, dataText] = ciphertext.split(":");
  if (version !== "v1" || !ivText || !dataText) throw new Error("Invalid ciphertext");
  const key = await aesKey(secret, context);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(ivText) },
    key,
    base64UrlDecode(dataText),
  );
  return decoder.decode(decrypted);
}

export function secondsFromNow(seconds: number, now = new Date()) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function daysFromNow(days: number, now = new Date()) {
  return secondsFromNow(days * 24 * 60 * 60, now);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function aesKey(secret: string, context: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${context}:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
