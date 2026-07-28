import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { episodes, renderJobs, renders } from "@/db/schema";
import { Badge, EmptyState, MilestoneNotice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RenderCenterPage() {
  const rows = await db
    .select({ render: renders, job: renderJobs, episodeTitle: episodes.title })
    .from(renders)
    .leftJoin(renderJobs, eq(renderJobs.renderId, renders.id))
    .innerJoin(episodes, eq(episodes.id, renders.episodeId))
    .orderBy(desc(renders.createdAt))
    .limit(100);

  return (
    <>
      <PageHeader
        title="Render center"
        description="Render status, progress, errors, outputs and retries."
      />

      {rows.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            title="No renders yet"
            description="Render records appear here once the pipeline is built."
          />
          <MilestoneNotice milestone="Milestone 2 — not built yet">
            <p>The pipeline will run entirely on your own machine:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Remotion for the 16:9 documentary and 9:16 vertical templates</li>
              <li>FFmpeg for encoding, loudness normalisation and thumbnails</li>
              <li>BullMQ + Redis for retry-safe background jobs with progress</li>
              <li>faster-whisper for subtitle timing, Piper for optional narration</li>
            </ul>
            <p className="mt-2">
              None of it requires a paid API. The <code>renders</code> and <code>render_jobs</code>{" "}
              tables already exist, so nothing here needs a schema change.
            </p>
          </MilestoneNotice>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
          <table className="w-full min-w-[48rem] text-sm">
            <caption className="sr-only">Render jobs and their status</caption>
            <thead className="bg-black/[0.03] text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Episode
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Output
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Progress
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Error
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {rows.map(({ render, job, episodeTitle }) => (
                <tr key={render.id}>
                  <td className="px-4 py-3">
                    <Link href={`/episodes/${render.episodeId}`} className="link">
                      {episodeTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {render.kind} · {render.aspectRatio}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={render.status === "failed" ? "bad" : "neutral"}>
                      {render.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{job ? `${job.progress}%` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-red-800">
                    {render.errorMessage ?? job?.errorMessage ?? ""}
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
