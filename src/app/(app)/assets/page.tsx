import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { ASSET_KINDS, LICENSE_TYPE_LABELS } from "@/domain/types";
import { listAssetLibrary, listEpisodes, listLicenses } from "@/server/episodes";

import { LicenseForm, UploadForm } from "./forms";

export const dynamic = "force-dynamic";

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

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; clearance?: string }>;
}) {
  const params = await searchParams;

  const [assets, licenses, episodeRows] = await Promise.all([
    listAssetLibrary({ search: params.q, kind: params.kind, clearance: params.clearance }),
    listLicenses(),
    listEpisodes(),
  ]);

  const uncleared = assets.filter((a) => !a.license?.isCleared).length;

  return (
    <>
      <PageHeader
        title="Asset library"
        description="Images, video, audio, music and maps, each tied to a licence record. An asset with no cleared licence blocks episode approval."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-black/60">Assets</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{assets.length}</p>
        </div>
        <div className={`card ${uncleared > 0 ? "border-l-4 border-red-400" : ""}`}>
          <p className="text-sm text-black/60">Without cleared licence</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{uncleared}</p>
        </div>
        <div className="card">
          <p className="text-sm text-black/60">Licence records</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{licenses.length}</p>
        </div>
      </div>

      <form method="get" role="search" className="card mb-6 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" type="search" defaultValue={params.q ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="kind">
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={params.kind ?? ""} className="input">
            <option value="">All kinds</option>
            {ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="clearance">
              Clearance
            </label>
            <select
              id="clearance"
              name="clearance"
              defaultValue={params.clearance ?? ""}
              className="input"
            >
              <option value="">All</option>
              <option value="cleared">Cleared only</option>
              <option value="uncleared">Not cleared</option>
            </select>
          </div>
          <button type="submit" className="btn-secondary">
            Filter
          </button>
        </div>
      </form>

      <section aria-labelledby="assets-heading" className="mb-8">
        <h2 id="assets-heading" className="mb-3 font-serif text-lg font-semibold">
          Assets
        </h2>
        {assets.length === 0 ? (
          <EmptyState title="No assets match" description="Upload one below to get started." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">Media assets and their licence status</caption>
              <thead className="bg-black/[0.03] text-left">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Title
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Episode
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Licence
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Size
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    File
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {assets.map(({ asset, license, episodeTitle }) => (
                  <tr key={asset.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{asset.title}</p>
                      {asset.creditLine ? (
                        <p className="text-xs text-black/60">{asset.creditLine}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{asset.kind}</Badge>
                    </td>
                    <td className="px-4 py-3 text-black/70">{episodeTitle ?? "Shared library"}</td>
                    <td className="px-4 py-3">
                      {license ? (
                        <>
                          <Badge tone={license.isCleared ? "good" : "bad"}>
                            {license.isCleared ? "Cleared" : "Not cleared"}
                          </Badge>
                          <p className="mt-1 text-xs text-black/60">
                            {license.name} · {LICENSE_TYPE_LABELS[license.licenseType]}
                          </p>
                        </>
                      ) : (
                        <Badge tone="bad">No licence</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-black/70">
                      {formatBytes(asset.byteSize)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/api/files/${asset.objectKey}`}
                        className="link"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="licenses-heading" className="mb-8">
        <h2 id="licenses-heading" className="mb-3 font-serif text-lg font-semibold">
          Licence records
        </h2>
        {licenses.length === 0 ? (
          <EmptyState title="No licence records yet" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {licenses.map((license) => (
              <li key={license.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{license.name}</p>
                    <p className="text-xs text-black/60">
                      {LICENSE_TYPE_LABELS[license.licenseType]}
                      {license.rightsHolder ? ` · ${license.rightsHolder}` : ""}
                    </p>
                  </div>
                  <Badge tone={license.isCleared ? "good" : "bad"}>
                    {license.isCleared ? "Cleared" : "Not cleared"}
                  </Badge>
                </div>
                {license.attributionText ? (
                  <p className="mt-2 text-xs text-black/70">Credit: {license.attributionText}</p>
                ) : null}
                {license.sourceUrl ? (
                  <a
                    href={license.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="link mt-1 inline-block text-xs"
                  >
                    Source
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <UploadForm
          licenses={licenses.map((l) => ({ id: l.id, name: l.name, isCleared: l.isCleared }))}
          episodes={episodeRows.map(({ episode }) => ({ id: episode.id, title: episode.title }))}
        />
        <LicenseForm />
      </div>
    </>
  );
}
