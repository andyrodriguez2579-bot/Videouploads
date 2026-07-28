import { PageHeader } from "@/components/ui";
import { listSeries } from "@/server/episodes";

import { NewEpisodeForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewEpisodePage() {
  const allSeries = await listSeries();

  return (
    <>
      <PageHeader
        title="New episode"
        description="Start with the historical framing. Script, sources, scenes and assets come next."
      />
      <div className="max-w-3xl">
        <NewEpisodeForm series={allSeries.map((s) => ({ id: s.id, title: s.title }))} />
      </div>
    </>
  );
}
