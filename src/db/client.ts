import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@/lib/env";

import * as schema from "./schema";

// Next.js dev mode re-evaluates modules on every hot reload; without the global
// cache each reload would open a new pool and exhaust Postgres connections.
const globalForDb = globalThis as unknown as {
  __historiaSql?: ReturnType<typeof postgres>;
  __historiaDb?: ReturnType<typeof drizzle<typeof schema>>;
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

/**
 * Connections are built on first use, not at import time.
 *
 * `next build` imports every server module to collect page data. If this module
 * connected at import, the build would demand DATABASE_URL and SESSION_SECRET —
 * which the Dockerfile has no way to supply, since those are runtime secrets.
 * Deferring the work keeps the build a pure compile step.
 */
function getSql(): ReturnType<typeof postgres> {
  if (!globalForDb.__historiaSql) globalForDb.__historiaSql = createClient();
  return globalForDb.__historiaSql;
}

function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!globalForDb.__historiaDb) {
    globalForDb.__historiaDb = drizzle(getSql(), { schema });
  }
  return globalForDb.__historiaDb;
}

/**
 * Lazy façades. Callers use `db` and `sql` as if they were eagerly constructed;
 * the first property access is what actually opens the pool. Methods are bound
 * to the real instance so `this` behaves normally inside Drizzle.
 */
function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const instance = resolve() as Record<string | symbol, unknown>;
      const value = instance[property];
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has(_target, property) {
      return property in (resolve() as object);
    },
    // postgres.js is callable as a tagged template: sql`select 1`.
    apply(_target, thisArg, args: unknown[]) {
      return (resolve() as unknown as (...a: unknown[]) => unknown).apply(thisArg, args);
    },
  });
}

export const db = lazyProxy(getDb);
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  get(_target, property) {
    const instance = getSql() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
  apply(_target, thisArg, args: unknown[]) {
    return (getSql() as unknown as (...a: unknown[]) => unknown).apply(thisArg, args);
  },
});

export { schema };
