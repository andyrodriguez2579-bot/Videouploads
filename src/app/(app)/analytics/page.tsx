import { desc } from "drizzle-orm";

import { db } from "@/db/client";
import { analyticsSnapshots } from "@/db/schema";
import { EmptyState, MilestoneNotice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const snapshots = await db
    .select()
    .from(analyticsSnapshots)
    .orderBy(desc(analyticsSnapshots.capturedAt))
    .limit(100);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Views, likes, comments and engagement, as far as each platform's API allows."
      />

      {snapshots.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            title="No analytics yet"
            description="Metrics arrive once posts are published through a connected account."
          />
          <MilestoneNotice milestone="Milestone 5 — not built yet">
            <p>
              Snapshots are stored per post per capture time, so trends survive even when a platform
              only exposes lifetime totals.
            </p>
          </MilestoneNotice>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Analytics snapshots</caption>
            <thead className="bg-black/[0.03] text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Captured
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Views
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Likes
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Comments
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td className="px-4 py-2.5">
                    <time dateTime={snapshot.capturedAt.toISOString()}>
                      {snapshot.capturedAt.toLocaleString()}
                    </time>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{snapshot.views ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{snapshot.likes ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{snapshot.comments ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
