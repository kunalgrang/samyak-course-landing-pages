/// <reference types="node" />
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyLegacyImportCsv, buildPreflightLegacyImportCsv, loadSessionPepper, openLegacyImportDatabase } from "./legacy-import-apply.ts";
import { buildRemotePreflightLegacyImportCsv, WranglerRemoteD1Client } from "./legacy-import-remote-preflight.ts";
import { analyzeLegacyImportCsv, buildPrivacySafeReport } from "./legacy-import.ts";

async function runCli() {
  const { values } = parseArgs({
    options: {
      file: { type: "string", short: "f" },
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      preflight: { type: "boolean", default: false },
      "confirm-apply": { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      "confirm-remote-apply": { type: "boolean", default: false },
      "database-path": { type: "string" },
      "session-pepper": { type: "string" },
      branch: { type: "string", default: "SION" },
      organisation: { type: "string", default: "org_samyak" },
    },
  });
  if (values.apply && values["dry-run"]) throw new Error("Use either --dry-run or --apply, not both.");
  if (values.apply && values.preflight) throw new Error("Use either --preflight or --apply, not both.");
  if (values.remote && values.apply) throw new Error("Remote apply is intentionally unavailable in Phase 2. Future production apply must use a separate owner-approved command.");
  if (values.remote && !values.preflight) throw new Error("Remote mode is only permitted for read-only preflight.");
  if (!values.file) throw new Error("Missing --file path to a CSV export.");

  const filePath = resolve(values.file);
  const csvText = readFileSync(filePath, "utf8");
  if (values.remote && values.preflight) {
    const client = new WranglerRemoteD1Client("samyak-student-portal");
    const report = await buildRemotePreflightLegacyImportCsv(client, csvText, {
      sourceFileName: basename(filePath),
      branch: values.branch,
      organisationId: values.organisation,
      sessionPepper: loadSessionPepper(values["session-pepper"]),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (values.apply || values.preflight) {
    if (values.apply && !values["confirm-apply"]) throw new Error("Local apply requires --confirm-apply.");
    const db = openLegacyImportDatabase(values["database-path"]);
    try {
      const options = {
        sourceFileName: basename(filePath),
        branch: values.branch,
        organisationId: values.organisation,
        sessionPepper: loadSessionPepper(values["session-pepper"]),
      };
      const summary = values.preflight
        ? await buildPreflightLegacyImportCsv(db, csvText, options)
        : await applyLegacyImportCsv(db, csvText, options);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    } finally {
      db.close();
    }
  }

  const result = analyzeLegacyImportCsv(csvText, {
    sourceFileName: basename(filePath),
    branchCode: values.branch,
    organisationId: values.organisation,
  });
  process.stdout.write(`${JSON.stringify(buildPrivacySafeReport(result), null, 2)}\n`);
}

try {
  await runCli();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
