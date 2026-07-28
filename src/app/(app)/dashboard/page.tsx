import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { auditLog, episodes } from "@/db/schema";
import { Alert, EmptyState, PageHeader, StatTile, StatusBadge } from "@/components/ui";
import { REVIEW_STATUS_LABELS } from "@/domain/types";
import { getDashboardCounts } from "@/server/episodes";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const counts = await getDashboardCounts();

  const [pending, upcoming, recentActivity] = await Promise.all([
    db
      .select()
      .from(episodes)
      .where(eq(episodes.status, "in_review"))
      .orderBy(desc(episodes.updatedAt))
      .limit(10),
    db
      .select()
      .from(episodes)
      .where(eq(episodes.status, "scheduled"))
      .orderBy(desc(episodes.updatedAt))
      .limit(10),
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(12),
  ]);

  const failed = counts.byStatus.failed ?? 0;

  return (
    <>
      <PageHeader
        title="Production overview"
        description="Where every episode stands right now. Nothing leaves this workspace without an explicit human approval."
        actions={
          <Link href="/episodes/new" className="btn-primary">
            New episode
          </Link>
        }
      />

      {failed > 0 ? (
        <div className="mb-6">
          <Alert
            tone="error"
            title={`${failed} episode(s) in a failed state`}
            items={["Open the episode and use “Reopen as draft” once the cause is fixed."]}
          />
        </div>
      ) : null}

      <section aria-labelledby="counts-heading" className="mb-8">
        <h2 id="counts-heading" className="sr-only">
          Counts by status
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Episodes" value={counts.totalEpisodes} href="/episodes" />
          <StatTile
            label="Awaiting review"
            value={counts.byStatus.in_review ?? 0}
            href="/review"
            tone={(counts.byStatus.in_review ?? 0) > 0 ? "warn" : "neutral"}
          />
          <StatTile
            label="Sources unverified"
            value={counts.sources.unverified}
            tone={counts.sources.unverified > 0 ? "warn" : "neutral"}
          />
          <StatTile
            label="Assets without cleared licence"
            value={counts.assets.uncleared}
            href="/assets?clearance=uncleared"
            tone={counts.assets.uncleared > 0 ? "bad" : "neutral"}
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="pending-heading" className="card">
          <h2 id="pending-heading" className="mb-3 font-serif text-lg font-semibold">
            Pending approvals
          </h2>
          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting on you" description="No episodes are in review." />
          ) : (
            <ul className="divide-y divide-black/10">
              {pending.map((episode) => (
                <li key={episode.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/episodes/${episode.id}`} className="link text-sm">
                    {episode.title}
                  </Link>
                  <StatusBadge status={episode.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="upcoming-heading" className="card">
          <h2 id="upcoming-heading" className="mb-3 font-serif text-lg font-semibold">
            Scheduled
          </h2>
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="Approved episodes can be scheduled from the episode page."
            />
          ) : (
            <ul className="divide-y divide-black/10">
              {upcoming.map((episode) => (
                <li key={episode.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/episodes/${episode.id}`} className="link text-sm">
                    {episode.title}
                  </Link>
                  <StatusBadge status={episode.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="statuses-heading" className="card">
          <h2 id="statuses-heading" className="mb-3 font-serif text-lg font-semibold">
            Pipeline
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {Object.entries(REVIEW_STATUS_LABELS).map(([status, label]) => (
              <div key={status} className="flex items-baseline justify-between gap-2">
                <dt className="text-black/70">{label}</dt>
                <dd className="font-semibold tabular-nums">{counts.byStatus[status] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="activity-heading" className="card">
          <h2 id="activity-heading" className="mb-3 font-serif text-lg font-semibold">
            Recent activity
          </h2>
          {recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ol className="divide-y divide-black/10 text-sm">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="py-2">
                  <p>{entry.summary ?? entry.action}</p>
                  <p className="text-xs text-black/50">
                    {entry.actorEmail ?? "system"} ·{" "}
                    <time dateTime={entry.createdAt.toISOString()}>
                      {entry.createdAt.toLocaleString()}
                    </time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
