/**
 * Drops and recreates the public schema, then re-applies migrations.
 * Development only — it destroys all data.
 *
 *   npm run db:reset
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset the database with NODE_ENV=production.");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    console.log("Dropping schema public…");
    await sql.unsafe("drop schema public cascade; create schema public;");
    console.log("Done. Run `npm run db:migrate && npm run db:seed` next.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Reset failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
