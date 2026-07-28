"use server";

import { redirect } from "next/navigation";

import { getAuthProvider } from "@/lib/auth";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { fieldErrors, signInSchema } from "@/lib/validation";

export interface SignInState {
  error?: string;
  fields?: Record<string, string>;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error) };
  }

  let user;
  try {
    user = await getAuthProvider().signIn(parsed.data.email, parsed.data.password);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sign in failed." };
  }

  if (!user) {
    // Deliberately does not say which half was wrong.
    return { error: "Email or password is incorrect." };
  }

  await setSessionCookie(user);
  await recordAudit({
    actor: user,
    action: "auth.sign_in",
    entityType: "user",
    entityId: user.id,
    summary: `${user.email} signed in`,
  });

  const next = String(formData.get("next") ?? "/dashboard");
  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
