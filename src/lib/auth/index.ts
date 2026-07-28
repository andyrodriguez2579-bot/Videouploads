import "server-only";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/env";

import type { SessionUser } from "./session";

export interface AuthProviderAdapter {
  readonly name: "local" | "supabase";
  signIn(email: string, password: string): Promise<SessionUser | null>;
}

/**
 * Email + password against the local `users` table. This is the default so the
 * app runs with no cloud dependency; passwords are bcrypt hashed at cost 12.
 */
const localProvider: AuthProviderAdapter = {
  name: "local",
  async signIn(email, password) {
    const [record] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);

    // Compare against a dummy hash when the user is missing so a bad email and
    // a bad password take the same amount of time.
    const hash = record?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO";
    const matches = await bcrypt.compare(password, hash);

    if (!record || !record.isActive || !record.passwordHash || !matches) return null;

    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
    };
  },
};

/**
 * Placeholder for Supabase Auth. Turning this on means the browser talks to
 * Supabase directly and this app trusts the verified JWT; the local `users`
 * row is then keyed by `external_id`. Wired up when the owner provisions a
 * Supabase project — not needed for the free local workflow.
 */
const supabaseProvider: AuthProviderAdapter = {
  name: "supabase",
  async signIn() {
    throw new Error(
      "AUTH_PROVIDER=supabase is configured but the Supabase adapter is not implemented yet. " +
        "Set AUTH_PROVIDER=local to use local accounts.",
    );
  },
};

export function getAuthProvider(): AuthProviderAdapter {
  return getEnv().AUTH_PROVIDER === "supabase" ? supabaseProvider : localProvider;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
