import { NextResponse } from "next/server";
import { sql as raw } from "drizzle-orm";

import { db } from "@/db/client";
import { parseEnv } from "@/lib/env";

/** Liveness + readiness for Docker and any cloud host. Never returns secrets. */
export async function GET() {
  const env = parseEnv();

  let database = "unknown";
  try {
    await db.execute(raw`select 1`);
    database = "ok";
  } catch (error) {
    database = error instanceof Error ? `error: ${error.message}` : "error";
  }

  const healthy = env.ok && database === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      env: env.ok ? "ok" : env.issues.map((i) => `${i.key}: ${i.message}`),
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
