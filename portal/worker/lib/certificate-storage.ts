import type { CertificateRecord } from "./certificate-service";

export type CertificatePdfPutInput = {
  key: string;
  bytes: Uint8Array;
  certificateId: string;
  certificateNumber: string;
  sha256: string;
};

export type StoredCertificatePdf = {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  contentDisposition?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type CertificatePdfStorage = {
  put(input: CertificatePdfPutInput): Promise<void>;
  get(key: string): Promise<StoredCertificatePdf | null>;
  delete(key: string): Promise<void>;
};

export function buildCertificatePdfKey(certificate: Pick<CertificateRecord, "organisation_id" | "branch_id" | "certificate_number" | "issue_date" | "id">) {
  const year = /^\d{4}/.test(certificate.issue_date) ? certificate.issue_date.slice(0, 4) : new Date().getUTCFullYear().toString();
  const branch = certificateBranchSegment(certificate);
  const fileBase = safePathSegment(certificate.certificate_number || certificate.id, "certificate");
  return `certificates/${safePathSegment(certificate.organisation_id, "org_samyak")}/${branch}/${year}/${fileBase}.pdf`;
}

export function certificatePdfFilename(certificate: Pick<CertificateRecord, "certificate_number" | "id">) {
  return `${safePathSegment(certificate.certificate_number || certificate.id, "certificate")}.pdf`;
}

export function createR2CertificatePdfStorage(bucket: R2Bucket): CertificatePdfStorage {
  return {
    async put(input) {
      await bucket.put(input.key, input.bytes, {
        httpMetadata: {
          contentType: "application/pdf",
          contentDisposition: `attachment; filename="${certificateFileHeaderValue(input.certificateNumber)}.pdf"`,
        },
        customMetadata: {
          certificateId: input.certificateId,
          certificateNumber: input.certificateNumber,
          sha256: input.sha256,
        },
      });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object?.body) return null;
      return {
        body: object.body,
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType,
        contentDisposition: object.httpMetadata?.contentDisposition,
        arrayBuffer: () => object.arrayBuffer(),
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

export function createMemoryCertificatePdfStorage(seed?: Map<string, Uint8Array>): CertificatePdfStorage {
  const objects = seed || new Map<string, Uint8Array>();
  return {
    async put(input) {
      objects.set(input.key, new Uint8Array(input.bytes));
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return memoryObject(bytes);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

export function certificatePdfStorageFromEnv(env: { CERTIFICATE_PDFS?: R2Bucket }) {
  return env.CERTIFICATE_PDFS ? createR2CertificatePdfStorage(env.CERTIFICATE_PDFS) : null;
}

function certificateBranchSegment(certificate: Pick<CertificateRecord, "branch_id" | "certificate_number">) {
  const match = /^SYK-([A-Z0-9_-]+)-CERT-/i.exec(certificate.certificate_number);
  const branchCode = match?.[1] || certificate.branch_id.replace(/^branch[_-]?/i, "");
  return `branch_${safePathSegment(branchCode, "unknown_branch")}`;
}

function safePathSegment(value: string, fallback: string) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

function certificateFileHeaderValue(value: string) {
  return safePathSegment(value, "certificate").replace(/"/g, "");
}

function memoryObject(bytes: Uint8Array): StoredCertificatePdf {
  return {
    body: new Response(bytes).body as ReadableStream<Uint8Array>,
    contentLength: bytes.byteLength,
    contentType: "application/pdf",
    contentDisposition: "attachment",
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}
