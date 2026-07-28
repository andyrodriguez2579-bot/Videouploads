import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { getEnv } from "@/lib/env";
import type { UserRole } from "@/domain/types";

import { SESSION_COOKIE } from "./cookie";

export { SESSION_COOKIE };

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_SECRET);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const env = getEnv();
  return new SignJWT({
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_TTL_HOURS}h`)
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      id: payload.sub,
      email: payload.email,
      displayName: typeof payload.displayName === "string" ? payload.displayName : payload.email,
      role: (payload.role as UserRole) ?? "viewer",
    };
  } catch {
    // Expired or tampered token — treat as signed out rather than erroring.
    return null;
  }
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const env = getEnv();
  const token = await createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

/** For server components and actions that must not run signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");
  return user;
}

const WRITE_ROLES: UserRole[] = ["owner", "editor"];
const APPROVE_ROLES: UserRole[] = ["owner", "reviewer"];

export function canEdit(role: UserRole): boolean {
  return WRITE_ROLES.includes(role);
}

/**
 * Approval is deliberately separate from editing. An `editor` can prepare an
 * episode but cannot sign it off; that keeps the human approval gate meaningful
 * once more than one person uses the tool.
 */
export function canApprove(role: UserRole): boolean {
  return APPROVE_ROLES.includes(role);
}
