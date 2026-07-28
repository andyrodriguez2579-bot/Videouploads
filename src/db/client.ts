import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@/lib/env";

import * as schema from "./schema";

// Next.js dev mode re-evaluates modules on every hot reload; without the global
// cache each reload would open a new pool and exhaust Postgres connections.
const globalForDb = globalThis as unknown as {
  __historiaSql?: ReturnType<typeof postgres>;
};

function createClient() {
  const env = getEnv();
  return postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "production" ? 10 : 3,
    idle_timeout: 20,
    // Supabase's pooled connection string does not support prepared statements.
    prepare: !env.DATABASE_URL.includes("pgbouncer"),
  });
}

export const sql = globalForDb.__historiaSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__historiaSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
