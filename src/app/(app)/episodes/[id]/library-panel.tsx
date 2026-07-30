"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, Field } from "@/components/ui";

import {
  addLibrarySourceAction,
  searchLibraryAction,
  type LibrarySearchState,
} from "./library-actions";

function Submit({ idle, busy, secondary }: { idle: string; busy: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={secondary ? "btn-secondary text-xs" : "btn-primary"}
      disabled={pending}
    >
      {pending ? busy : idle}
    </button>
  );
}

/**
 * Searching the Biblioteca Nacional Pedro Henríquez Ureña from inside the app.
 *
 * The catalogue is public; the scans are not. So this imports a citation, and
 * the reading still happens on their site — which is why every result links out.
 */
export function LibraryPanel({ episodeId }: { episodeId: string }) {
  const [state, search] = useActionState<LibrarySearchState, FormData>(searchLibraryAction, {});

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">
        Search the national library
      </h2>
      <p className="mb-4 text-xs text-black/60">
        Searches the Biblioteca Nacional Pedro Henríquez Ureña&rsquo;s catalogue and files the
        citation against this episode — author, publisher, year and shelf reference, as the
        library records them. The scans stay on their site; every result links back.
      </p>

      {state.error ? (
        <div className="mb-4">
          <Alert tone="error" title={state.error} />
        </div>
      ) : null}
      {state.ok && state.message ? (
        <div className="mb-4">
          <Alert tone="info" title={state.message} />
        </div>
      ) : null}

      <form action={search} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[18rem] flex-1">
          <Field
            label="Search"
            name="query"
            error={state.fields?.query}
            hint="Try a subject, a person, or a year — e.g. “Drake Santo Domingo 1586”."
          >
            <input
              id="query"
              name="query"
              defaultValue={state.query ?? ""}
              required
              className="input"
            />
          </Field>
        </div>
        <Submit idle="Search" busy="Searching…" />
      </form>

      {state.hits && state.hits.length > 0 ? (
        <ul className="divide-y divide-black/10">
          {state.hits.map((hit) => (
            <li key={hit.id} className="py-3">
              <p className="font-medium">{hit.title}</p>
              <p className="mt-0.5 text-xs text-black/70">
                {[hit.author, hit.publicationYear, hit.publisher].filter(Boolean).join(" · ")}
              </p>

              {hit.subjects.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-1">
                  {hit.subjects.slice(0, 3).map((subject) => (
                    <Badge key={subject}>{subject}</Badge>
                  ))}
                </p>
              ) : null}

              {hit.abstract ? (
                <p className="mt-1 line-clamp-2 text-xs text-black/60">{hit.abstract}</p>
              ) : null}

              <form action={addLibrarySourceAction} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="episodeId" value={episodeId} />
                <input type="hidden" name="catalogueId" value={hit.id} />
                <input
                  name="supportsClaim"
                  className="input max-w-md text-xs"
                  placeholder="Which claim does this back up? (optional)"
                  aria-label={`Claim supported by ${hit.title}`}
                />
                <Submit idle="Add as source" busy="Adding…" secondary />
                {hit.url ? (
                  <a className="link text-xs" href={hit.url} target="_blank" rel="noreferrer">
                    Open in the library
                  </a>
                ) : null}
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 text-xs text-black/60">
        Imported sources are always <strong>unverified</strong>. A catalogue can tell you a book
        exists and what it covers; it cannot tell you it supports the sentence you wrote. Read it,
        then mark it verified.
      </p>
    </section>
  );
}
