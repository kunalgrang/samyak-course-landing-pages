import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = join(import.meta.dirname, "..");
const persistTo = mkdtempSync(join(tmpdir(), "samyak-d1-wrangler-"));
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

try {
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "samyak-student-portal",
    "--local",
    "--persist-to",
    persistTo,
  ]);

  const schema = query("select name, type from sqlite_master where name in ('class_sessions','attendance_records','user_sessions_active_subject_type_idx','class_sessions_batch_date_start_unique','attendance_records_session_membership_unique') order by type, name;");
  const columns = query("select name from pragma_table_info('user_sessions') where name = 'active_subject_type';");
  const migrations = query("select name from d1_migrations where name = '0027_trainer_attendance_sessions.sql';");
  const subjectTriggers = query("select name from sqlite_master where type = 'trigger' and name like 'user_sessions_active_subject_%';");

  expectSome(columns, "active_subject_type column");
  expectSome(migrations, "0027 migration record");
  expectNames(schema, [
    "attendance_records",
    "class_sessions",
    "attendance_records_session_membership_unique",
    "class_sessions_batch_date_start_unique",
    "user_sessions_active_subject_type_idx",
  ]);
  if (subjectTriggers.length !== 0) {
    throw new Error("0027 should not create user_sessions_active_subject_* triggers through Wrangler migrations.");
  }

  console.log("Wrangler local D1 migration apply passed through 0027.");
} finally {
  rmSync(persistTo, { recursive: true, force: true });
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`wrangler ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function query(command) {
  const output = runWrangler([
    "d1",
    "execute",
    "samyak-student-portal",
    "--local",
    "--persist-to",
    persistTo,
    "--json",
    "--command",
    command,
  ]);
  const jsonStart = output.indexOf("[");
  if (jsonStart === -1) throw new Error(`Wrangler JSON output not found: ${output}`);
  const parsed = JSON.parse(output.slice(jsonStart));
  return parsed.flatMap((result) => result.results || []);
}

function expectSome(rows, label) {
  if (rows.length === 0) throw new Error(`Missing ${label}.`);
}

function expectNames(rows, expected) {
  const actual = new Set(rows.map((row) => row.name));
  const missing = expected.filter((name) => !actual.has(name));
  if (missing.length > 0) throw new Error(`Missing schema objects: ${missing.join(", ")}`);
}
