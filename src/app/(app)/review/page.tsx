import Link from "next/link";
import { desc, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { episodes } from "@/db/schema";
import { Alert, Badge, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { getReadiness } from "@/server/episodes";

export const dynamic = "force-dynamic";

/**
 * The human gate. Everything that could go out sits here first; approval is
 * only possible from the episode page, where the full script, sources and
 * licences are visible.
 */
export default async function ReviewQueuePage() {
  const queue = await db
    .select()
    .from(episodes)
    .where(inArray(episodes.status, ["in_review", "rejected", "approved"]))
    .orderBy(desc(episodes.updatedAt));

  const withReadiness = await Promise.all(
    queue.map(async (episode) => ({ episode, readiness: await getReadiness(episode.id) })),
  );

  const inReview = withReadiness.filter((r) => r.episode.status === "in_review");
  const others = withReadiness.filter((r) => r.episode.status !== "in_review");

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Nothing renders for publication or uploads to any platform until it is approved here."
      />

      <div className="mb-6">
        <Alert
          tone="info"
          title="How approval works"
          items={[
            "Approving pins the exact script version being signed off.",
            "Editing an approved script automatically withdraws the approval.",
            "An asset without a cleared licence blocks approval outright.",
          ]}
        />
      </div>

      <section aria-labelledby="in-review-heading" className="mb-8">
        <h2 id="in-review-heading" className="mb-3 font-serif text-lg font-semibold">
          Awaiting review ({inReview.length})
        </h2>
        {inReview.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Episodes appear here once an editor submits them for review."
          />
        ) : (
          <ul className="space-y-3">
            {inReview.map(({ episode, readiness }) => {
              const blockers = [
                readiness.verifiedSourceCount === 0 ? "No verified source" : null,
                readiness.unclearedAssetCount > 0
                  ? `${readiness.unclearedAssetCount} asset(s) not licence-cleared`
                  : null,
                readiness.unreviewedAiSceneCount > 0
                  ? `${readiness.unreviewedAiSceneCount} unreviewed AI scene(s)`
                  : null,
                readiness.sceneCount === 0 ? "No scenes" : null,
              ].filter(Boolean) as string[];

              return (
                <li key={episode.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/episodes/${episode.id}`} className="link font-medium">
                        {episode.title}
                      </Link>
                      <p className="text-xs text-black/60">
                        {episode.periodLabel ?? "No period recorded"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge>{readiness.wordCount} words</Badge>
                        <Badge>{readiness.sceneCount} scenes</Badge>
                        <Badge tone={readiness.verifiedSourceCount > 0 ? "good" : "warn"}>
                          {readiness.verifiedSourceCount} verified sources
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={episode.status} />
                      <Link href={`/episodes/${episode.id}`} className="btn-primary text-sm">
                        Open to review
                      </Link>
                    </div>
                  </div>

                  {blockers.length > 0 ? (
                    <div className="mt-3">
                      <Alert tone="warning" title="Approval is blocked" items={blockers} />
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-emerald-800">
                      Ready to approve — open it to read the script and sources first.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 font-serif text-lg font-semibold">
          Recently decided
        </h2>
        {others.length === 0 ? (
          <EmptyState title="No decisions yet" />
        ) : (
          <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white">
            {others.map(({ episode }) => (
              <li key={episode.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <Link href={`/episodes/${episode.id}`} className="link font-medium">
                    {episode.title}
                  </Link>
                  {episode.rejectionReason ? (
                    <p className="text-xs text-red-800">{episode.rejectionReason}</p>
                  ) : null}
                </div>
                <StatusBadge status={episode.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
