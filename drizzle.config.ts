import "dotenv/config";
import type { Config } from "drizzle-kit";

/**
 * drizzle-kit is available for inspecting the schema and generating SQL when
 * adding a migration. Migrations themselves are applied by `scripts/migrate.ts`
 * from the plain .sql files in ./drizzle — that runner is the source of truth.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
} satisfies Config;
