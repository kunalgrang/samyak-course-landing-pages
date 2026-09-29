/// <reference types="node" />
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  PRODUCTION_CENTRE_COMMERCIAL_DATABASE,
  runRemoteCentreCommercialMaintenance,
  validateCentreCommercialMaintenanceRequest,
  type CentreCommercialMaintenanceArgs,
} from "./centre-commercial-maintenance.ts";

export function parseCentreCommercialMaintenanceArgs(argv = process.argv.slice(2)): CentreCommercialMaintenanceArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      remote: { type: "boolean", default: false },
      preflight: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "confirm-apply": { type: "boolean", default: false },
      "confirm-centre-commercial": { type: "boolean", default: false },
      organisation: { type: "string", default: "" },
      "expected-organisation-name": { type: "string", default: "" },
      centre: { type: "string", default: "" },
      "expected-centre-code": { type: "string", default: "" },
      "expected-centre-name": { type: "string", default: "" },
      "payment-evidence-source": { type: "string", default: "" },
      "payment-reference": { type: "string", default: "" },
      reason: { type: "string", default: "" },
      database: { type: "string", default: PRODUCTION_CENTRE_COMMERCIAL_DATABASE },
    },
  });

  const parsed = {
    remote: Boolean(values.remote),
    preflight: Boolean(values.preflight),
    apply: Boolean(values.apply),
    confirmApply: Boolean(values["confirm-apply"]),
    confirmCentreCommercial: Boolean(values["confirm-centre-commercial"]),
    organisationId: values.organisation.trim(),
    expectedOrganisationName: values["expected-organisation-name"].trim(),
    centreId: values.centre.trim(),
    expectedCentreCode: values["expected-centre-code"].trim(),
    expectedCentreName: values["expected-centre-name"].trim(),
    paymentEvidenceSource: values["payment-evidence-source"].trim() as CentreCommercialMaintenanceArgs["paymentEvidenceSource"],
    paymentReference: values["payment-reference"].trim(),
    reason: values.reason.trim(),
    databaseName: values.database.trim(),
  };
  validateCentreCommercialMaintenanceRequest(parsed);
  return parsed;
}

async function runCli() {
  const input = parseCentreCommercialMaintenanceArgs();
  const report = await runRemoteCentreCommercialMaintenance(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
