/// <reference types="node" />
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { PRODUCTION_DEMO_DATABASE, runRemoteDemoMaintenance, validateDemoMaintenanceRequest, type DemoMaintenanceArgs } from "./organisation-demo-maintenance.ts";

export function parseOrganisationDemoMaintenanceArgs(argv = process.argv.slice(2)): DemoMaintenanceArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      remote: { type: "boolean", default: false },
      preflight: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "confirm-apply": { type: "boolean", default: false },
      "confirm-production-demo": { type: "boolean", default: false },
      organisation: { type: "string", default: "" },
      "expected-name": { type: "string", default: "" },
      reason: { type: "string", default: "" },
      database: { type: "string", default: PRODUCTION_DEMO_DATABASE },
    },
  });

  const parsed = {
    remote: Boolean(values.remote),
    preflight: Boolean(values.preflight),
    apply: Boolean(values.apply),
    confirmApply: Boolean(values["confirm-apply"]),
    confirmProductionDemo: Boolean(values["confirm-production-demo"]),
    organisationId: values.organisation.trim(),
    expectedName: values["expected-name"].trim(),
    reason: values.reason.trim(),
    databaseName: values.database.trim(),
  };
  validateDemoMaintenanceRequest(parsed);
  return parsed;
}

async function runCli() {
  const input = parseOrganisationDemoMaintenanceArgs();
  const report = await runRemoteDemoMaintenance(input);
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
