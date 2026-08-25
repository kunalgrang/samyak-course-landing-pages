import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

const failures = [];

for (const file of migrationFiles) {
  const bytes = readFileSync(join(migrationsDir, file));
  let crlf = 0;
  let bareLf = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    if (index > 0 && bytes[index - 1] === 0x0d) crlf += 1;
    else bareLf += 1;
  }

  const type = crlf === 0 ? "LF only" : bareLf === 0 ? "CRLF" : "mixed";
  console.log(`${file}: ${type} (CRLF=${crlf}, bare LF=${bareLf})`);

  if (crlf > 0) failures.push(`${file} contains ${crlf} CRLF line ending(s)`);
}

if (failures.length > 0) {
  console.error("\nMigration SQL files must use LF line endings for D1 remote parser compatibility.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
