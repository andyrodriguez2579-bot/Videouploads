/**
 * Migration runner.
 *
 * Applies every `drizzle/*.sql` file in filename order, once, inside a
 * transaction, and records what it applied in `_migrations`. Deliberately a
 * plain SQL runner rather than drizzle-kit's journal: the SQL files are the
 * source of truth and stay readable and reviewable.
 *
 *   npm run db:migrate
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import "dotenv/config";
import postgres from "postgres";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    await sql`
      create table if not exists _migrations (
        filename    text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )
    `;

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migration files found in ./drizzle");
      return;
    }

    const applied = await sql<{ filename: string; checksum: string }[]>`
      select filename, checksum from _migrations
    `;
    const appliedMap = new Map(applied.map((row) => [row.filename, row.checksum]));

    let ran = 0;
    for (const filename of files) {
      const body = await fs.readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      const previous = appliedMap.get(filename);

      if (previous) {
        if (previous !== checksum) {
          // Editing an applied migration silently diverges dev from production.
          throw new Error(
            `Migration ${filename} has already been applied but its contents changed. ` +
              `Add a new migration file instead of editing this one.`,
          );
        }
        continue;
      }

      console.log(`Applying ${filename}…`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into _migrations (filename, checksum) values (${filename}, ${checksum})`;
      });
      ran += 1;
    }

    console.log(ran === 0 ? "Database is already up to date." : `Applied ${ran} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
