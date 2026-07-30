"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Field } from "@/components/ui";
import { ASSET_KINDS, LICENSE_TYPES, LICENSE_TYPE_LABELS } from "@/domain/types";
import type { ActionState } from "@/lib/action-state";

import { createLicenseAction, uploadAssetAction } from "./actions";
import { importAssetAction } from "./import-actions";

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}

export function ImportForm({
  episodes,
}: {
  episodes: { id: string; title: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(importAssetAction, {});

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Import from an archive</h2>
      <p className="mb-4 text-xs text-black/60">
        Paste a Wikimedia Commons file page, a loc.gov item, or a direct image link. The image
        is downloaded at the largest size offered, and a licence record is created from the
        archive&rsquo;s own metadata — creator, date, rights wording, reference.
      </p>

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

      <form action={action} className="space-y-4">
        <Field
          label="Archive URL"
          name="url"
          error={state.fields?.url}
          hint="e.g. https://commons.wikimedia.org/wiki/File:Example.jpg"
        >
          <input id="url" name="url" type="url" required className="input" />
        </Field>

        <Field label="Episode" name="importEpisodeId" hint="Leave blank to keep it in the shared library.">
          <select id="importEpisodeId" name="episodeId" className="input" defaultValue="">
            <option value="">Shared library</option>
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>
                {episode.title}
              </option>
            ))}
          </select>
        </Field>

        <Submit idle="Import" busy="Fetching…" />
      </form>

      <p className="mt-3 text-xs text-black/60">
        The licence is always created <strong>uncleared</strong>. An archive tells you what it
        believes about an item; it does not clear the rights for your use, and public-domain
        status varies by country. Approval stays blocked until you have checked and ticked it.
      </p>
    </section>
  );
}

export function UploadForm({
  licenses,
  episodes,
}: {
  licenses: { id: string; name: string; isCleared: boolean }[];
  episodes: { id: string; title: string }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(uploadAssetAction, {});

  return (
    <section className="card">
      <h2 className="mb-4 font-serif text-lg font-semibold">Upload an asset</h2>

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

      {/* No encType: React sets it itself for a function action and warns if we do. */}
      <form action={action} className="space-y-4" noValidate>
        <Field label="Title" name="title" error={state.fields?.title}>
          <input id="title" name="title" required className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind" name="kind" error={state.fields?.kind}>
            <select id="kind" name="kind" className="input" defaultValue="image">
              {ASSET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Episode" name="episodeId" hint="Leave blank to keep it in the shared library.">
            <select id="episodeId" name="episodeId" className="input" defaultValue="">
              <option value="">Shared library</option>
              {episodes.map((episode) => (
                <option key={episode.id} value={episode.id}>
                  {episode.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Licence" name="licenseId">
          <select id="licenseId" name="licenseId" className="input" defaultValue="">
            <option value="">No licence yet</option>
            {licenses.map((license) => (
              <option key={license.id} value={license.id}>
                {license.name}
                {license.isCleared ? " ✓" : " (not cleared)"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="File" name="file" error={state.fields?.file}>
          <input id="file" name="file" type="file" required className="input" />
        </Field>

        <Field label="Description" name="description">
          <textarea id="description" name="description" rows={2} className="input" />
        </Field>

        <Field label="Credit line" name="creditLine">
          <input id="creditLine" name="creditLine" className="input" />
        </Field>

        <Field label="Tags" name="tags" hint="Comma separated.">
          <input id="tags" name="tags" className="input" />
        </Field>

        <Submit idle="Upload asset" busy="Uploading…" />
      </form>
    </section>
  );
}

export function LicenseForm() {
  const [state, action] = useActionState<ActionState, FormData>(createLicenseAction, {});

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Record a licence</h2>
      <p className="mb-4 text-sm text-black/60">
        Only tick “cleared” when the rights are genuinely documented — public domain status
        confirmed, a written permission on file, or a paid licence receipt.
      </p>

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
        <Field label="Name" name="name" error={state.fields?.name}>
          <input id="name" name="name" required className="input" />
        </Field>

        <Field label="Licence type" name="licenseType" error={state.fields?.licenseType}>
          <select id="licenseType" name="licenseType" className="input" defaultValue="public_domain">
            {LICENSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {LICENSE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Rights holder" name="rightsHolder">
          <input id="rightsHolder" name="rightsHolder" className="input" />
        </Field>

        <Field label="Attribution text" name="attributionText">
          <input id="attributionText" name="attributionText" className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source URL" name="sourceUrl" error={state.fields?.sourceUrl}>
            <input id="sourceUrl" name="sourceUrl" type="url" className="input" />
          </Field>
          <Field label="Licence URL" name="licenseUrl" error={state.fields?.licenseUrl}>
            <input id="licenseUrl" name="licenseUrl" type="url" className="input" />
          </Field>
        </div>

        <Field label="Territory" name="territory">
          <input id="territory" name="territory" className="input" />
        </Field>

        <Field label="Notes" name="notes">
          <textarea id="notes" name="notes" rows={2} className="input" />
        </Field>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isCleared" className="h-4 w-4" />
            Rights are documented and cleared for use
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiresAttribution" defaultChecked className="h-4 w-4" />
            Requires on-screen attribution
          </label>
        </div>

        <Submit idle="Record licence" busy="Saving…" />
      </form>
    </section>
  );
}
