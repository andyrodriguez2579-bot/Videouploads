import Link from "next/link";
import { asc, isNotNull } from "drizzle-orm";

import { db } from "@/db/client";
import { socialPosts } from "@/db/schema";
import { Badge, EmptyState, MilestoneNotice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const scheduled = await db
    .select()
    .from(socialPosts)
    .where(isNotNull(socialPosts.scheduledFor))
    .orderBy(asc(socialPosts.scheduledFor))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Publishing calendar"
        description="Scheduled and published posts across every platform."
      />

      {scheduled.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            title="Nothing scheduled"
            description="A post can only be scheduled after its episode is approved."
          />
          <MilestoneNotice milestone="Milestone 4/5 — not built yet">
            <p>
              The database already refuses to mark a post scheduled, publishing or published unless
              an approver is recorded on it — that constraint is live today, so the calendar can
              never fill with unapproved content.
            </p>
          </MilestoneNotice>
        </div>
      ) : (
        <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white">
          {scheduled.map((post) => (
            <li key={post.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-medium">{post.title ?? "(untitled post)"}</p>
                <p className="text-xs text-black/60">
                  <Link href={`/episodes/${post.episodeId}`} className="link">
                    Episode
                  </Link>{" "}
                  ·{" "}
                  {post.scheduledFor ? (
                    <time dateTime={post.scheduledFor.toISOString()}>
                      {post.scheduledFor.toLocaleString()}
                    </time>
                  ) : (
                    "unscheduled"
                  )}
                </p>
              </div>
              <span className="flex gap-1.5">
                <Badge tone="info">{post.platform}</Badge>
                <Badge>{post.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
