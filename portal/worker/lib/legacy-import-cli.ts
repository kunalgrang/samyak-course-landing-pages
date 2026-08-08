/// <reference types="node" />
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyLegacyImportCsv, buildPreflightLegacyImportCsv, loadSessionPepper, openLegacyImportDatabase } from "./legacy-import-apply.ts";
import {
  applyRemoteLegacyImportCsv,
  PRODUCTION_IMPORT_DATABASE,
  PRODUCTION_IMPORT_BRANCH,
  PRODUCTION_IMPORT_ORGANISATION,
  validateProductionApplyRequest,
} from "./legacy-import-remote-apply.ts";
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
      "confirm-production-import": { type: "boolean", default: false },
      "database-path": { type: "string" },
      "session-pepper": { type: "string" },
      branch: { type: "string", default: "SION" },
      organisation: { type: "string", default: "org_samyak" },
    },
  });
  if (values.apply && values["dry-run"]) throw new Error("Use either --dry-run or --apply, not both.");
  if (values.apply && values.preflight) throw new Error("Use either --preflight or --apply, not both.");
  if (values.remote && values.apply) {
    validateProductionApplyRequest({
      remote: Boolean(values.remote),
      apply: Boolean(values.apply),
      confirmApply: Boolean(values["confirm-apply"]),
      confirmProductionImport: Boolean(values["confirm-production-import"]),
      organisationId: values.organisation,
      branch: values.branch,
      databaseName: PRODUCTION_IMPORT_DATABASE,
    });
  } else if (values.remote && !values.preflight) {
    throw new Error("Remote mode is only permitted for read-only preflight or explicitly confirmed production apply.");
  }
  if (!values.file) throw new Error("Missing --file path to a CSV export.");

  const filePath = resolve(values.file);
  const csvText = readFileSync(filePath, "utf8");
  if (values.remote && values.apply) {
    const client = new WranglerRemoteD1Client(PRODUCTION_IMPORT_DATABASE);
    const summary = await applyRemoteLegacyImportCsv(client, csvText, {
      sourceFileName: basename(filePath),
      branch: values.branch,
      organisationId: values.organisation,
      sessionPepper: loadSessionPepper(values["session-pepper"]),
      onBeforeWrite: (target) => {
        process.stdout.write(
          [
            "PRODUCTION IMPORT TARGET",
            `Database: ${target.databaseName}`,
            `Organisation: ${target.organisationId}`,
            `Branch: ${target.branch}`,
            `Source rows: ${target.sourceRows}`,
            `Proposed people: ${target.proposedPeople}`,
            `Proposed enrolments: ${target.proposedEnrolments}`,
            "",
          ].join("\n"),
        );
      },
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (values.remote && values.preflight) {
    const client = new WranglerRemoteD1Client(PRODUCTION_IMPORT_DATABASE);
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
    if (values.apply && values["confirm-production-import"]) {
      throw new Error(`--confirm-production-import is only valid with --remote against ${PRODUCTION_IMPORT_DATABASE}/${PRODUCTION_IMPORT_ORGANISATION}/${PRODUCTION_IMPORT_BRANCH}.`);
    }
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
