"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Alert, Field } from "@/components/ui";

import { signInAction, type SignInState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [state, action] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <form action={action} className="card space-y-4" noValidate>
      <input type="hidden" name="next" value={params.get("next") ?? "/dashboard"} />

      {state.error ? <Alert tone="error" title={state.error} /> : null}

      <Field label="Email" name="email" error={state.fields?.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="input"
          aria-describedby={state.fields?.email ? "email-error" : undefined}
        />
      </Field>

      <Field label="Password" name="password" error={state.fields?.password}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          aria-describedby={state.fields?.password ? "password-error" : undefined}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="mb-6 text-center">
        <h1 className="font-serif text-2xl font-semibold">Historia Dominicana Studio</h1>
        <p className="mt-1 text-sm text-black/60">Editorial and production workspace</p>
      </div>
      <Suspense fallback={<div className="card">Loading…</div>}>
        <LoginForm />
      </Suspense>
      <p className="mt-4 text-center text-xs text-black/50">
        Seeded local account: <code>owner@historia.local</code> / <code>historia-dev</code>
      </p>
    </main>
  );
}
