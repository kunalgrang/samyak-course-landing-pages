import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./db/schema.ts", "./db/student-master-schema.ts"],
  out: "./migrations",
  dialect: "sqlite",
  strict: true,
  verbose: true,
});
