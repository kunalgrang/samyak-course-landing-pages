/// <reference types="node" />
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  DEMO_CORE_V1_SEED_VERSION,
  runRemoteDemoDataMaintenance,
  validateDemoDataMaintenanceRequest,
  type DemoDataMaintenanceArgs,
} from "./demo-data-maintenance.ts";
import { PRODUCTION_DEMO_DATABASE } from "./organisation-demo-maintenance.ts";

export function parseDemoDataMaintenanceArgs(argv = process.argv.slice(2)): DemoDataMaintenanceArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      remote: { type: "boolean", default: false },
      preflight: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "confirm-apply": { type: "boolean", default: false },
      "confirm-production-demo-data": { type: "boolean", default: false },
      organisation: { type: "string", default: "" },
      "expected-name": { type: "string", default: "" },
      "expected-centre": { type: "string", default: "" },
      "seed-version": { type: "string", default: DEMO_CORE_V1_SEED_VERSION },
      reason: { type: "string", default: "" },
      database: { type: "string", default: PRODUCTION_DEMO_DATABASE },
    },
  });

  const parsed = {
    remote: Boolean(values.remote),
    preflight: Boolean(values.preflight),
    apply: Boolean(values.apply),
    confirmApply: Boolean(values["confirm-apply"]),
    confirmProductionDemoData: Boolean(values["confirm-production-demo-data"]),
    organisationId: values.organisation.trim(),
    expectedName: values["expected-name"].trim(),
    expectedCentre: values["expected-centre"].trim(),
    seedVersion: values["seed-version"].trim(),
    reason: values.reason.trim(),
    databaseName: values.database.trim(),
  };
  validateDemoDataMaintenanceRequest(parsed);
  return parsed;
}

async function runCli() {
  const input = parseDemoDataMaintenanceArgs();
  const report = await runRemoteDemoDataMaintenance(input);
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
