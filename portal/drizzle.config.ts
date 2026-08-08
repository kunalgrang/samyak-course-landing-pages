import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./db/schema.ts", "./db/student-master-schema.ts", "./db/referral-schema.ts", "./db/legacy-import-schema.ts"],
  out: "./migrations",
  dialect: "sqlite",
  strict: true,
  verbose: true,
});
