import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { Alert, Badge, PageHeader, StatusBadge } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import {
  getEpisode,
  getLatestVersion,
  getReadiness,
  listCaptions,
  listEpisodeAssets,
  listLicenses,
  listRenders,
  listSceneAssetLinks,
  listSceneSourceLinks,
  listScenes,
  listSources,
  listVersions,
  listVoiceovers,
} from "@/server/episodes";

import { AssetsTab } from "./assets-tab";
import { DetailsTab } from "./details-tab";
import { ProductionTab } from "./production-tab";
import { ScenesTab } from "./scenes-tab";
import { ScriptTab } from "./script-tab";
import { SourcesTab } from "./sources-tab";
import { WorkflowPanel } from "./workflow-panel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "script", label: "Script" },
  { key: "sources", label: "Sources" },
  { key: "scenes", label: "Scene plan" },
  { key: "assets", label: "Assets" },
  { key: "production", label: "Voice & captions" },
  { key: "details", label: "Details" },
  { key: "history", label: "History" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function EpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  const row = await getEpisode(id);
  if (!row) notFound();

  const { episode } = row;
  const active: TabKey = (TABS.find((t) => t.key === tab)?.key ?? "script") as TabKey;

  const [
    user,
    readiness,
    latestVersion,
    versions,
    sources,
    sceneRows,
    episodeAssets,
    licenses,
    sceneAssetLinks,
    sceneSourceLinks,
    voiceoverRows,
    captionRows,
    renderRows,
    history,
  ] = await Promise.all([
    getSessionUser(),
    getReadiness(id),
    getLatestVersion(id),
    listVersions(id),
    listSources(id),
    listScenes(id),
    listEpisodeAssets(id),
    listLicenses(),
    listSceneAssetLinks(id),
    listSceneSourceLinks(id),
    listVoiceovers(id),
    listCaptions(id),
    listRenders(id),
    db.select().from(auditLog).where(eq(auditLog.episodeId, id)).orderBy(desc(auditLog.createdAt)).limit(50),
  ]);

  const approvedVersion = episode.approvedVersionId
    ? versions.find((v) => v.id === episode.approvedVersionId)
    : undefined;

  return (
    <>
      <PageHeader
        title={episode.title}
        description={
          [episode.periodLabel, row.series.title].filter(Boolean).join(" · ") || undefined
        }
        actions={
          <>
            <StatusBadge status={episode.status} />
            <Link href="/episodes" className="btn-secondary">
              All episodes
            </Link>
          </>
        }
      />

      {episode.status === "rejected" && episode.rejectionReason ? (
        <div className="mb-6">
          <Alert tone="error" title="Changes requested">
            <p className="mt-1">{episode.rejectionReason}</p>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <nav aria-label="Episode sections" className="mb-4 border-b border-black/10">
            <ul className="-mb-px flex flex-wrap gap-1">
              {TABS.map((t) => (
                <li key={t.key}>
                  <Link
                    href={`/episodes/${id}?tab=${t.key}`}
                    aria-current={active === t.key ? "page" : undefined}
                    className={`inline-block border-b-2 px-3 py-2 text-sm ${
                      active === t.key
                        ? "border-indigo-700 font-medium text-indigo-800"
                        : "border-transparent text-black/60 hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {active === "script" ? (
            <ScriptTab
              episodeId={id}
              title={episode.title}
              latestVersion={
                latestVersion
                  ? {
                      id: latestVersion.id,
                      versionNumber: latestVersion.versionNumber,
                      scriptBody: latestVersion.scriptBody,
                      scriptFormat: latestVersion.scriptFormat,
                      wordCount: latestVersion.wordCount,
                      contentHash: latestVersion.contentHash,
                      authorship: latestVersion.authorship,
                      createdAt: latestVersion.createdAt.toISOString(),
                    }
                  : null
              }
              versions={versions.map((v) => ({
                id: v.id,
                versionNumber: v.versionNumber,
                wordCount: v.wordCount,
                authorship: v.authorship,
                changeNote: v.changeNote,
                createdAt: v.createdAt.toISOString(),
                isApproved: v.id === episode.approvedVersionId,
              }))}
              locked={episode.status === "published"}
            />
          ) : null}

          {active === "sources" ? (
            <SourcesTab
              episodeId={id}
              sources={sources.map((s) => ({
                id: s.id,
                citation: s.citation,
                sourceType: s.sourceType,
                author: s.author,
                publisher: s.publisher,
                publicationYear: s.publicationYear,
                url: s.url,
                archiveReference: s.archiveReference,
                supportsClaim: s.supportsClaim,
                pageReference: s.pageReference,
                verification: s.verification,
                notes: s.notes,
              }))}
            />
          ) : null}

          {active === "scenes" ? (
            <ScenesTab
              episodeId={id}
              scenes={sceneRows.map(({ scene, assetCount, sourceCount }) => ({
                id: scene.id,
                position: scene.position,
                heading: scene.heading,
                narrationText: scene.narrationText,
                onScreenText: scene.onScreenText,
                visualDirection: scene.visualDirection,
                template: scene.template,
                estimatedSeconds: scene.estimatedSeconds,
                notes: scene.notes,
                isAiSuggested: scene.isAiSuggested,
                aiProvider: scene.aiProvider,
                humanReviewed: scene.humanReviewed,
                assetCount: Number(assetCount),
                sourceCount: Number(sourceCount),
              }))}
              availableAssets={episodeAssets.map(({ asset, license }) => ({
                id: asset.id,
                title: asset.title,
                kind: asset.kind,
                cleared: Boolean(license?.isCleared),
              }))}
              availableSources={sources.map((s) => ({
                id: s.id,
                citation: s.citation,
                verification: s.verification,
              }))}
              sceneAssetLinks={sceneAssetLinks.map(({ link, asset }) => ({
                id: link.id,
                sceneId: link.sceneId,
                assetTitle: asset.title,
              }))}
              sceneSourceLinks={sceneSourceLinks.map(({ link, source }) => ({
                id: link.id,
                sceneId: link.sceneId,
                citation: source.citation,
              }))}
            />
          ) : null}

          {active === "assets" ? (
            <AssetsTab
              episodeId={id}
              assets={episodeAssets.map(({ asset, license }) => ({
                id: asset.id,
                title: asset.title,
                kind: asset.kind,
                description: asset.description,
                creditLine: asset.creditLine,
                byteSize: asset.byteSize,
                mimeType: asset.mimeType,
                objectKey: asset.objectKey,
                license: license
                  ? {
                      id: license.id,
                      name: license.name,
                      licenseType: license.licenseType,
                      isCleared: license.isCleared,
                      attributionText: license.attributionText,
                      rightsHolder: license.rightsHolder,
                      sourceUrl: license.sourceUrl,
                    }
                  : null,
              }))}
              licenses={licenses.map((l) => ({
                id: l.id,
                name: l.name,
                licenseType: l.licenseType,
                isCleared: l.isCleared,
              }))}
            />
          ) : null}

          {active === "production" ? (
            <ProductionTab
              episodeId={id}
              narrationMode={episode.narrationMode}
              captionMode={episode.captionMode}
              voiceovers={voiceoverRows.map((v) => ({
                id: v.id,
                source: v.source,
                provider: v.provider,
                objectKey: v.objectKey,
                durationSeconds: v.durationSeconds,
                status: v.status,
                isSelected: v.isSelected,
              }))}
              captions={captionRows.map((c) => ({
                id: c.id,
                format: c.format,
                source: c.source,
                cueCount: c.cueCount,
                status: c.status,
                humanReviewed: c.humanReviewed,
              }))}
              renderCount={renderRows.length}
            />
          ) : null}

          {active === "details" ? (
            <DetailsTab
              episode={{
                id: episode.id,
                title: episode.title,
                synopsis: episode.synopsis,
                episodeNumber: episode.episodeNumber,
                periodLabel: episode.periodLabel,
                periodStartYear: episode.periodStartYear,
                periodEndYear: episode.periodEndYear,
                narrationMode: episode.narrationMode,
                captionMode: episode.captionMode,
                scenePlanMode: episode.scenePlanMode,
                publishMode: episode.publishMode,
                targetDurationSeconds: episode.targetDurationSeconds,
              }}
            />
          ) : null}

          {active === "history" ? (
            <section className="card">
              <h2 className="mb-3 font-serif text-lg font-semibold">Audit trail</h2>
              {history.length === 0 ? (
                <p className="text-sm text-black/60">No recorded activity yet.</p>
              ) : (
                <ol className="divide-y divide-black/10 text-sm">
                  {history.map((entry) => (
                    <li key={entry.id} className="py-2.5">
                      <p>{entry.summary ?? entry.action}</p>
                      <p className="text-xs text-black/50">
                        <Badge>{entry.action}</Badge> {entry.actorEmail ?? "system"} ·{" "}
                        <time dateTime={entry.createdAt.toISOString()}>
                          {entry.createdAt.toLocaleString()}
                        </time>
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </div>

        <aside className="min-w-0">
          <WorkflowPanel
            episodeId={id}
            status={episode.status}
            readiness={readiness}
            canApprove={user ? user.role === "owner" || user.role === "reviewer" : false}
            approvedVersionNumber={approvedVersion?.versionNumber ?? null}
            approvedAt={episode.approvedAt ? episode.approvedAt.toISOString() : null}
          />
        </aside>
      </div>
    </>
  );
}
