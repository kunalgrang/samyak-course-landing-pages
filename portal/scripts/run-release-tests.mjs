import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const vitestBin = join(root, "node_modules", "vitest", "vitest.mjs");
const includeRoots = [
  { dir: "src", extensions: [".test.ts", ".test.tsx"] },
  { dir: "worker", extensions: [".test.ts"] },
];

function walk(dir, extensions, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, extensions, files);
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      files.push(relative(root, fullPath).split(sep).join("/"));
    }
  }
  return files;
}

const files = includeRoots
  .flatMap(({ dir, extensions }) => walk(join(root, dir), extensions))
  .sort((left, right) => left.localeCompare(right));

if (!files.length) {
  console.error("No release test files found.");
  process.exit(1);
}

let totalTests = 0;
const startedAt = Date.now();

console.log(`Release test files discovered: ${files.length}`);

for (const [index, file] of files.entries()) {
  const fileStartedAt = Date.now();
  const result = spawnSync(process.execPath, [
    vitestBin,
    "run",
    "--no-file-parallelism",
    "--maxWorkers=1",
    file,
  ], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    console.error(`Release test failed: ${file}`);
    process.exit(result.status || 1);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/Tests\s+(\d+)\s+passed/);
  if (!match) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    console.error(`Unable to parse test count for: ${file}`);
    process.exit(1);
  }

  const tests = Number(match[1]);
  totalTests += tests;
  const seconds = ((Date.now() - fileStartedAt) / 1000).toFixed(2);
  console.log(`[${index + 1}/${files.length}] ${file} - ${tests} tests passed in ${seconds}s`);
}

const duration = ((Date.now() - startedAt) / 1000).toFixed(2);
console.log(`Release Test Files ${files.length} passed (${files.length})`);
console.log(`Release Tests ${totalTests} passed (${totalTests})`);
console.log(`Release Duration ${duration}s`);
