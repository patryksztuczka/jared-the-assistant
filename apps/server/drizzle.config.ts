import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "file:./db/sqlite.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
