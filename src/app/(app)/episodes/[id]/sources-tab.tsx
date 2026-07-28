"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, EmptyState, Field } from "@/components/ui";
import { SOURCE_TYPES, type SourceType, type VerificationStatus } from "@/domain/types";

import type { ActionState } from "@/lib/action-state";

import { addSourceAction, deleteSourceAction, setSourceVerificationAction } from "../actions";

interface SourceRow {
  id: string;
  citation: string;
  sourceType: SourceType;
  author: string | null;
  publisher: string | null;
  publicationYear: number | null;
  url: string | null;
  archiveReference: string | null;
  supportsClaim: string | null;
  pageReference: string | null;
  verification: VerificationStatus;
  notes: string | null;
}

const VERIFICATION_TONE: Record<VerificationStatus, "good" | "warn" | "bad" | "neutral"> = {
  verified: "good",
  unverified: "warn",
  disputed: "bad",
  rejected: "bad",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Adding…" : "Add source"}
    </button>
  );
}

export function SourcesTab({ episodeId, sources }: { episodeId: string; sources: SourceRow[] }) {
  const [state, action] = useActionState<ActionState, FormData>(addSourceAction, {});
  const verified = sources.filter((s) => s.verification === "verified").length;

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">Research sources</h2>
          <div className="flex gap-1.5">
            <Badge tone={verified > 0 ? "good" : "warn"}>{verified} verified</Badge>
            <Badge>{sources.length} total</Badge>
          </div>
        </div>
        <p className="mb-4 text-sm text-black/60">
          Every historical claim on screen should trace to a source here. An episode cannot be
          approved until at least one source is marked verified. Nothing is auto-verified.
        </p>

        {sources.length === 0 ? (
          <EmptyState
            title="No sources recorded"
            description="Add the books, archives and primary documents behind this script."
          />
        ) : (
          <ul className="divide-y divide-black/10">
            {sources.map((source) => (
              <li key={source.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{source.citation}</p>
                    <p className="mt-0.5 text-xs text-black/60">
                      {[
                        source.author,
                        source.publisher,
                        source.publicationYear?.toString(),
                        source.pageReference,
                        source.archiveReference,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No bibliographic detail recorded"}
                    </p>
                    {source.supportsClaim ? (
                      <p className="mt-1 text-sm text-black/70">
                        <span className="font-medium">Supports:</span> {source.supportsClaim}
                      </p>
                    ) : null}
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="link mt-1 inline-block text-xs"
                      >
                        {source.url}
                      </a>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Badge tone={VERIFICATION_TONE[source.verification]}>{source.verification}</Badge>
                    <form action={setSourceVerificationAction} className="flex items-center gap-1">
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="sourceId" value={source.id} />
                      <label className="sr-only" htmlFor={`verification-${source.id}`}>
                        Set verification for {source.citation}
                      </label>
                      <select
                        id={`verification-${source.id}`}
                        name="verification"
                        defaultValue={source.verification}
                        className="input py-1 text-xs"
                      >
                        <option value="unverified">unverified</option>
                        <option value="verified">verified</option>
                        <option value="disputed">disputed</option>
                        <option value="rejected">rejected</option>
                      </select>
                      <button type="submit" className="btn-secondary py-1 text-xs">
                        Set
                      </button>
                    </form>
                    <form action={deleteSourceAction}>
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="sourceId" value={source.id} />
                      <button type="submit" className="btn-danger py-1 text-xs">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="mb-4 font-serif text-lg font-semibold">Add a source</h2>

        {state.error ? (
          <div className="mb-4">
            <Alert tone="error" title={state.error} />
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="mb-4">
            <Alert tone="success" title={state.message} />
          </div>
        ) : null}

        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="episodeId" value={episodeId} />

          <Field
            label="Full citation"
            name="citation"
            error={state.fields?.citation}
            hint="Write it as it should appear in the source-credits end screen."
          >
            <textarea id="citation" name="citation" rows={2} required className="input" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Source type" name="sourceType">
              <select id="sourceType" name="sourceType" className="input" defaultValue="secondary">
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Author" name="author" error={state.fields?.author}>
              <input id="author" name="author" className="input" />
            </Field>
            <Field label="Publisher" name="publisher" error={state.fields?.publisher}>
              <input id="publisher" name="publisher" className="input" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Year" name="publicationYear" error={state.fields?.publicationYear}>
              <input id="publicationYear" name="publicationYear" type="number" className="input" />
            </Field>
            <Field label="Page / folio" name="pageReference">
              <input id="pageReference" name="pageReference" className="input" />
            </Field>
            <Field
              label="Archive reference"
              name="archiveReference"
              hint="e.g. AGI, Santo Domingo, leg. 868"
            >
              <input id="archiveReference" name="archiveReference" className="input" />
            </Field>
          </div>

          <Field label="URL" name="url" error={state.fields?.url}>
            <input id="url" name="url" type="url" className="input" />
          </Field>

          <Field
            label="Which claim does this support?"
            name="supportsClaim"
            error={state.fields?.supportsClaim}
          >
            <textarea id="supportsClaim" name="supportsClaim" rows={2} className="input" />
          </Field>

          <Field label="Notes" name="notes">
            <textarea id="notes" name="notes" rows={2} className="input" />
          </Field>

          <Submit />
        </form>
      </section>
    </div>
  );
}
