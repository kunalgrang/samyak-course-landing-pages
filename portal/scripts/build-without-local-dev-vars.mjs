import { existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const portalRoot = fileURLToPath(new URL("..", import.meta.url));
const devVarsPath = join(portalRoot, ".dev.vars");
const backupPath = join(portalRoot, ".dev.vars.build-backup");
const viteBin = join(portalRoot, "node_modules", "vite", "bin", "vite.js");

if (existsSync(backupPath)) {
  throw new Error("Refusing to build while .dev.vars.build-backup already exists.");
}

const movedDevVars = existsSync(devVarsPath);

try {
  if (movedDevVars) renameSync(devVarsPath, backupPath);
  const build = spawnSync(process.execPath, [viteBin, "build"], {
    cwd: portalRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) process.exitCode = build.status || 1;
} finally {
  if (movedDevVars && existsSync(backupPath)) renameSync(backupPath, devVarsPath);
}

if (!process.exitCode) {
  const scrub = spawnSync(process.execPath, ["./scripts/scrub-build-output.mjs"], {
    cwd: portalRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (scrub.status !== 0) process.exitCode = scrub.status || 1;
}
