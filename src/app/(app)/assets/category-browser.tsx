"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, Field } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

import {
  browseCategoryAction,
  importSelectedAction,
  type CategoryBrowseState,
} from "./import-actions";

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}

/**
 * Browsing a Wikimedia Commons category and importing from it.
 *
 * A category page is how Commons is actually searched — you land on
 * "Historical images of the Dominican Republic", not on forty file pages. This
 * lists what is in one, shows the licence on each thumbnail, and imports the
 * ticked ones through the same path as a single URL, licence record and all.
 */
export function CategoryBrowser({ episodes }: { episodes: { id: string; title: string }[] }) {
  const [browse, runBrowse] = useActionState<CategoryBrowseState, FormData>(
    browseCategoryAction,
    {},
  );
  const [imported, runImport] = useActionState<ActionState, FormData>(importSelectedAction, {});

  const listing = browse.listing;

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Browse a Commons category</h2>
      <p className="mb-4 text-xs text-black/60">
        Paste a Wikimedia Commons <strong>category</strong> page and pick images from it. Each
        one is imported at full size with a licence record built from the archive&rsquo;s
        metadata, exactly as a single-file import would be.
      </p>

      {browse.error ? (
        <div className="mb-4">
          <Alert tone="error" title={browse.error} />
        </div>
      ) : null}
      {imported.error ? (
        <div className="mb-4">
          <Alert tone="error" title={imported.error} />
        </div>
      ) : null}
      {imported.ok && imported.message ? (
        <div className="mb-4">
          <Alert tone="success" title={imported.message} />
        </div>
      ) : null}

      <form action={runBrowse} className="mb-4 space-y-4">
        <Field
          label="Category URL"
          name="categoryUrl"
          error={browse.fields?.categoryUrl}
          hint="e.g. https://commons.wikimedia.org/wiki/Category:Historical_images_of_the_Dominican_Republic"
        >
          <input
            id="categoryUrl"
            name="categoryUrl"
            type="url"
            required
            defaultValue={browse.categoryUrl ?? ""}
            className="input"
          />
        </Field>

        <Field
          label="Episode"
          name="browseEpisodeId"
          hint="Leave blank to keep imports in the shared library."
        >
          <select
            id="browseEpisodeId"
            name="episodeId"
            className="input"
            defaultValue={browse.episodeId ?? ""}
          >
            <option value="">Shared library</option>
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>
                {episode.title}
              </option>
            ))}
          </select>
        </Field>

        <Submit idle="Browse" busy="Reading category…" />
      </form>

      {listing && listing.files.length > 0 ? (
        <form action={runImport}>
          <input type="hidden" name="episodeId" value={browse.episodeId ?? ""} />

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-black/60">
              {listing.files.length} file(s)
              {listing.truncated ? " — first 50; open the category on Commons for the rest" : ""}
            </p>
            <Submit idle="Import selected" busy="Downloading…" />
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listing.files.map((file) => (
              <li key={file.sourceUrl} className="rounded border border-black/10 p-2">
                <label className="flex cursor-pointer gap-2">
                  <input type="checkbox" name="url" value={file.sourceUrl} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    {file.thumbnailUrl ? (
                      // Commons thumbnails are arbitrary remote URLs, so this
                      // stays a plain <img> rather than next/image.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={file.thumbnailUrl}
                        alt={file.title}
                        className="mb-2 h-32 w-full rounded object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="block truncate text-sm font-medium" title={file.title}>
                      {file.title}
                    </span>
                    <span className="mt-1 block text-xs text-black/60">
                      {[file.date, file.width && file.height ? `${file.width}×${file.height}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {file.creator ? (
                      <span className="mt-0.5 block truncate text-xs text-black/60">
                        {file.creator}
                      </span>
                    ) : null}
                    <span className="mt-1 block">
                      <Badge tone={file.licenseName ? "neutral" : "warn"}>
                        {file.licenseName ?? "licence not stated"}
                      </Badge>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </form>
      ) : null}

      {listing && listing.subcategories.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium">Sub-categories</p>
          <p className="mb-2 text-xs text-black/60">
            Not searched automatically — Commons categories nest deeply and wander off subject,
            so pulling them in would import images nobody chose. Open one and browse it.
          </p>
          <ul className="flex flex-wrap gap-2">
            {listing.subcategories.map((sub) => (
              <li key={sub.url}>
                <a className="link text-xs" href={sub.url} target="_blank" rel="noreferrer">
                  {sub.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-black/60">
        Commons is a mixed bag by design: public domain sits beside CC-BY-SA and disputed
        uploads. Every licence lands <strong>uncleared</strong>, and approval stays blocked
        until a person has read the rights on the source page and ticked it.
      </p>
    </section>
  );
}
