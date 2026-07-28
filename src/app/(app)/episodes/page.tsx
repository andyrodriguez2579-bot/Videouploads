import Link from "next/link";

import { Badge, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from "@/domain/types";
import { listEpisodes, listSeries } from "@/server/episodes";

export const dynamic = "force-dynamic";

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; series?: string }>;
}) {
  const params = await searchParams;
  const [rows, allSeries] = await Promise.all([
    listEpisodes({ search: params.q, status: params.status, seriesId: params.series }),
    listSeries(),
  ]);

  return (
    <>
      <PageHeader
        title="Episodes"
        description="Every episode in the series and where it sits in the review workflow."
        actions={
          <Link href="/episodes/new" className="btn-primary">
            New episode
          </Link>
        }
      />

      <form method="get" role="search" className="card mb-6 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={params.q ?? ""}
            placeholder="Title, synopsis or period"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={params.status ?? ""} className="input">
            <option value="">All statuses</option>
            {REVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {REVIEW_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="series">
              Series
            </label>
            <select id="series" name="series" defaultValue={params.series ?? ""} className="input">
              <option value="">All series</option>
              {allSeries.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary">
            Filter
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No episodes match"
          description="Adjust the filters, or create the first episode of the series."
          action={
            <Link href="/episodes/new" className="btn-primary">
              New episode
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Episodes and their current review status</caption>
            <thead className="bg-black/[0.03] text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  #
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Title
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Period
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Content
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {rows.map(({ episode, seriesTitle, sceneCount, sourceCount, assetCount }) => (
                <tr key={episode.id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-3 tabular-nums text-black/60">
                    {episode.episodeNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/episodes/${episode.id}`} className="link font-medium">
                      {episode.title}
                    </Link>
                    <p className="text-xs text-black/50">
                      {seriesTitle} · {episode.language === "en" ? "English" : "Spanish"}
                      {episode.translationOfId ? " (translation)" : ""} ·{" "}
                      {episode.primaryFormat === "short_form" ? "short form" : "long form"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-black/70">{episode.periodLabel ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={episode.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      <Badge>{sceneCount} scenes</Badge>
                      <Badge>{sourceCount} sources</Badge>
                      <Badge>{assetCount} assets</Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-black/60">
                    <time dateTime={episode.updatedAt.toISOString()}>
                      {episode.updatedAt.toLocaleDateString()}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
