/// <reference types="node" />
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeLegacyImportPlan } from "../worker/lib/legacy-import.ts";

const DEFAULT_OUTPUT = "./.wrangler/tmp/imported-contact-recovery-payload.json";

type RecoveryEntry = {
  legacyStudentRef: string;
  mobile: string;
};

if (!process.argv[2]) {
  throw new Error("Usage: npm run contact-recovery:payload -- <source-csv-path> [output-json-path]");
}

const sourcePath = resolve(process.argv[2]);
const outputPath = resolve(process.argv[3] || DEFAULT_OUTPUT);
const csvText = readFileSync(sourcePath, "utf8");
const plan = analyzeLegacyImportPlan(csvText, {
  organisationId: "org_samyak",
  branchCode: "branch_sion",
  sourceFileName: "legacy-students.csv",
});

const validRows = plan.rows.filter((row) => row.validationStatus !== "error" && row.normalizedMobile && row.legacyStudentRef);
const byPerson = new Map<string, RecoveryEntry>();
for (const row of validRows) {
  const existing = byPerson.get(row.legacyStudentRef);
  if (existing && existing.mobile !== row.normalizedMobile) {
    throw new Error("Source shape changed: one legacy person has multiple mobiles.");
  }
  byPerson.set(row.legacyStudentRef, { legacyStudentRef: row.legacyStudentRef, mobile: row.normalizedMobile! });
}

const mobileCounts = new Map<string, number>();
for (const entry of byPerson.values()) mobileCounts.set(entry.mobile, (mobileCounts.get(entry.mobile) || 0) + 1);
const sharedMobileValues = [...mobileCounts.values()].filter((count) => count > 1).length;
const peopleOnSharedMobiles = [...mobileCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);

const shape = {
  enrolmentRows: plan.rows.length,
  validRows: validRows.length,
  uniquePeople: byPerson.size,
  uniqueMobiles: mobileCounts.size,
  sharedMobileValues,
  peopleOnSharedMobiles,
};

if (
  shape.enrolmentRows !== 59 ||
  shape.validRows !== 59 ||
  shape.uniquePeople !== 56 ||
  shape.uniqueMobiles !== 55 ||
  shape.sharedMobileValues !== 1 ||
  shape.peopleOnSharedMobiles !== 2
) {
  throw new Error(`Source shape changed: ${JSON.stringify(shape)}`);
}

const payload = {
  mode: "dry_run",
  entries: [...byPerson.values()].sort((left, right) => left.legacyStudentRef.localeCompare(right.legacyStudentRef)),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });

console.log(JSON.stringify({
  outputPath,
  ...shape,
}, null, 2));
