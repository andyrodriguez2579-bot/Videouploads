import { asc } from "drizzle-orm";

import { db } from "@/db/client";
import { socialAccounts } from "@/db/schema";
import { Badge, EmptyState, MilestoneNotice, PageHeader } from "@/components/ui";
import { PLATFORMS } from "@/domain/types";

export const dynamic = "force-dynamic";

export default async function SocialAccountsPage() {
  const accounts = await db.select().from(socialAccounts).orderBy(asc(socialAccounts.platform));

  return (
    <>
      <PageHeader
        title="Social accounts"
        description="OAuth connections and connection health. Publishing uses official platform APIs only — never browser automation."
      />

      <section aria-labelledby="platforms-heading" className="mb-8">
        <h2 id="platforms-heading" className="mb-3 font-serif text-lg font-semibold">
          Platforms
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PLATFORMS.map((platform) => {
            const account = accounts.find((a) => a.platform === platform);
            return (
              <li key={platform} className="card flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium capitalize">{platform}</p>
                  <p className="text-xs text-black/60">
                    {account?.handle ?? account?.accountLabel ?? "Not connected"}
                  </p>
                </div>
                <Badge
                  tone={
                    account?.connectionStatus === "connected"
                      ? "good"
                      : account?.connectionStatus === "error" || account?.connectionStatus === "expired"
                        ? "bad"
                        : "neutral"
                  }
                >
                  {account?.connectionStatus ?? "disconnected"}
                </Badge>
              </li>
            );
          })}
        </ul>
      </section>

      {accounts.length === 0 ? <EmptyState title="No accounts connected yet" /> : null}

      <MilestoneNotice milestone="Milestone 4 — not built yet">
        <p>
          Adapters land one at a time, YouTube first. Until then, the recommended workflow is
          manual upload: render locally, review, then upload the file yourself. Every episode can
          choose “manual upload” or “API” independently.
        </p>
        <p className="mt-2">
          Tokens will be stored AES-256-GCM encrypted; the columns already exist and are named
          <code> access_token_encrypted</code> / <code>refresh_token_encrypted</code> so plaintext
          has nowhere to go.
        </p>
      </MilestoneNotice>
    </>
  );
}
