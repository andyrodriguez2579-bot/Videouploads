"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

import { createTranslationAction } from "../actions";

const LANGUAGE_LABELS: Record<string, string> = { es: "Spanish", en: "English" };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-secondary w-full" disabled={pending}>
      {pending ? "Creating…" : label}
    </button>
  );
}

export function TranslationPanel({
  episodeId,
  language,
  isTranslation,
  siblings,
}: {
  episodeId: string;
  language: string;
  isTranslation: boolean;
  siblings: { id: string; title: string; language: string; status: string; isOriginal: boolean }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createTranslationAction, {});

  const missing = (["es", "en"] as const).filter(
    (candidate) => candidate !== language && !siblings.some((s) => s.language === candidate),
  );

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Language versions</h2>
      <p className="mb-3 text-xs text-black/60">
        Each language is approved separately — a translation can be wrong where the original is not.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge tone="info">
          This version: {LANGUAGE_LABELS[language] ?? language}
          {isTranslation ? " (translation)" : " (original)"}
        </Badge>
      </div>

      {siblings.length > 0 ? (
        <ul className="mb-3 divide-y divide-black/10 text-sm">
          {siblings.map((sibling) => (
            <li key={sibling.id} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/episodes/${sibling.id}`} className="link truncate">
                {LANGUAGE_LABELS[sibling.language] ?? sibling.language}
                {sibling.isOriginal ? " · original" : ""}
              </Link>
              <Badge>{sibling.status.replace("_", " ")}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-black/60">No other language version yet.</p>
      )}

      {state.error ? (
        <div className="mb-3">
          <Alert tone="error" title={state.error} />
        </div>
      ) : null}

      {isTranslation ? (
        <p className="text-xs text-black/60">
          Create further languages from the original episode.
        </p>
      ) : missing.length === 0 ? (
        <p className="text-xs text-black/60">Both language versions exist.</p>
      ) : (
        <div className="space-y-2">
          {missing.map((candidate) => (
            <form key={candidate} action={action}>
              <input type="hidden" name="episodeId" value={episodeId} />
              <input type="hidden" name="language" value={candidate} />
              <Submit label={`Create ${LANGUAGE_LABELS[candidate]} version`} />
            </form>
          ))}
          <p className="text-xs text-black/60">
            Copies the scene plan and all research sources. The script starts empty so an
            untranslated draft can never be mistaken for approved copy; assets stay shared.
          </p>
        </div>
      )}
    </section>
  );
}
