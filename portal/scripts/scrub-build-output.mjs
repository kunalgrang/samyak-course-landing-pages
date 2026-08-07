import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const emittedDevVars = join(process.cwd(), "dist", "samyak_student_portal", ".dev.vars");

if (existsSync(emittedDevVars)) {
  rmSync(emittedDevVars, { force: true });
}

if (existsSync(emittedDevVars)) {
  throw new Error("Build output still contains .dev.vars");
}
