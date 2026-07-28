"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, EmptyState, Field } from "@/components/ui";
import { ASSET_KINDS, LICENSE_TYPE_LABELS, type AssetKind, type LicenseType } from "@/domain/types";
import type { ActionState } from "@/lib/action-state";

import { deleteAssetAction, setAssetLicenseAction, uploadAssetAction } from "../../assets/actions";

interface AssetRow {
  id: string;
  title: string;
  kind: AssetKind;
  description: string | null;
  creditLine: string | null;
  byteSize: number | null;
  mimeType: string | null;
  objectKey: string;
  license: {
    id: string;
    name: string;
    licenseType: LicenseType;
    isCleared: boolean;
    attributionText: string | null;
    rightsHolder: string | null;
    sourceUrl: string | null;
  } | null;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Uploading…" : "Upload asset"}
    </button>
  );
}

export function AssetsTab({
  episodeId,
  assets,
  licenses,
}: {
  episodeId: string;
  assets: AssetRow[];
  licenses: { id: string; name: string; licenseType: LicenseType; isCleared: boolean }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(uploadAssetAction, {});
  const uncleared = assets.filter((a) => !a.license?.isCleared).length;

  return (
    <div className="space-y-6">
      {uncleared > 0 ? (
        <Alert
          tone="warning"
          title={`${uncleared} asset(s) have no cleared licence`}
          items={[
            "Approval is blocked until each attached asset points at a licence record marked cleared.",
          ]}
        />
      ) : null}

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">Episode assets</h2>
          <Badge>{assets.length} attached</Badge>
        </div>

        {assets.length === 0 ? (
          <EmptyState
            title="No assets attached"
            description="Upload archival stills, maps, music and narration for this episode below."
          />
        ) : (
          <ul className="divide-y divide-black/10">
            {assets.map((asset) => (
              <li key={asset.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{asset.title}</p>
                    <p className="text-xs text-black/60">
                      {asset.kind} · {formatBytes(asset.byteSize)} · {asset.mimeType ?? "unknown type"}
                    </p>
                    {asset.description ? (
                      <p className="mt-1 text-sm text-black/70">{asset.description}</p>
                    ) : null}

                    <div className="mt-2">
                      {asset.license ? (
                        <div className="rounded-md bg-black/[0.03] p-2 text-xs">
                          <p>
                            <Badge tone={asset.license.isCleared ? "good" : "bad"}>
                              {asset.license.isCleared ? "Licence cleared" : "NOT cleared"}
                            </Badge>{" "}
                            {asset.license.name} · {LICENSE_TYPE_LABELS[asset.license.licenseType]}
                          </p>
                          {asset.license.rightsHolder ? (
                            <p className="mt-1 text-black/70">
                              Rights holder: {asset.license.rightsHolder}
                            </p>
                          ) : null}
                          {asset.license.attributionText ? (
                            <p className="mt-1 text-black/70">
                              Credit: {asset.license.attributionText}
                            </p>
                          ) : null}
                          {asset.license.sourceUrl ? (
                            <a
                              href={asset.license.sourceUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="link"
                            >
                              Source
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <Badge tone="bad">No licence recorded</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <a
                      href={`/api/files/${asset.objectKey}`}
                      className="link text-xs"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open file
                    </a>
                    <form action={setAssetLicenseAction} className="flex gap-1">
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="assetId" value={asset.id} />
                      <label className="sr-only" htmlFor={`license-${asset.id}`}>
                        Licence for {asset.title}
                      </label>
                      <select
                        id={`license-${asset.id}`}
                        name="licenseId"
                        defaultValue={asset.license?.id ?? ""}
                        className="input py-1 text-xs"
                      >
                        <option value="">No licence</option>
                        {licenses.map((license) => (
                          <option key={license.id} value={license.id}>
                            {license.name}
                            {license.isCleared ? " ✓" : " (not cleared)"}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn-secondary py-1 text-xs">
                        Set
                      </button>
                    </form>
                    <form action={deleteAssetAction}>
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="assetId" value={asset.id} />
                      <button type="submit" className="btn-danger py-1 text-xs">
                        Delete
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

        <form action={action} className="space-y-4" encType="multipart/form-data" noValidate>
          <input type="hidden" name="episodeId" value={episodeId} />

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

            <Field
              label="Licence"
              name="licenseId"
              hint="Create licence records on the Asset library page."
            >
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
          </div>

          <Field label="File" name="file" error={state.fields?.file}>
            <input id="file" name="file" type="file" required className="input" />
          </Field>

          <Field label="Description" name="description">
            <textarea id="description" name="description" rows={2} className="input" />
          </Field>

          <Field
            label="Credit line"
            name="creditLine"
            hint="How the credit appears on screen or in the end card."
          >
            <input id="creditLine" name="creditLine" className="input" />
          </Field>

          <Field label="Tags" name="tags" hint="Comma separated.">
            <input id="tags" name="tags" className="input" />
          </Field>

          <Submit />
        </form>
      </section>
    </div>
  );
}
