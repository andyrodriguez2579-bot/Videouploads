import "server-only";

import { and, asc, desc, eq, isNull, or, sql as raw } from "drizzle-orm";

import { db } from "@/db/client";
import {
  assetLicenses,
  captions,
  episodes,
  episodeVersions,
  mediaAssets,
  renders,
  researchSources,
  sceneAssets,
  sceneSources,
  scenes,
  series,
  socialPosts,
  voiceovers,
} from "@/db/schema";
import type { EpisodeReadiness } from "@/domain/workflow";

export async function listSeries() {
  return db.select().from(series).orderBy(asc(series.title));
}

export interface EpisodeListFilters {
  search?: string;
  status?: string;
  seriesId?: string;
}

export async function listEpisodes(filters: EpisodeListFilters = {}) {
  const conditions = [];
  if (filters.status) conditions.push(eq(episodes.status, filters.status as never));
  if (filters.seriesId) conditions.push(eq(episodes.seriesId, filters.seriesId));
  if (filters.search) {
    const pattern = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      or(
        raw`lower(${episodes.title}) like ${pattern}`,
        raw`lower(coalesce(${episodes.synopsis}, '')) like ${pattern}`,
        raw`lower(coalesce(${episodes.periodLabel}, '')) like ${pattern}`,
      ),
    );
  }

  const rows = await db
    .select({
      episode: episodes,
      seriesTitle: series.title,
      sceneCount: raw<number>`(select count(*)::int from scenes s where s.episode_id = ${episodes.id})`,
      sourceCount: raw<number>`(select count(*)::int from research_sources rs where rs.episode_id = ${episodes.id})`,
      assetCount: raw<number>`(select count(*)::int from media_assets ma where ma.episode_id = ${episodes.id})`,
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(episodes.episodeNumber), desc(episodes.updatedAt));

  return rows;
}

export async function getEpisode(episodeId: string) {
  const [row] = await db
    .select({ episode: episodes, series })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(episodes.id, episodeId))
    .limit(1);
  return row ?? null;
}

export async function getLatestVersion(episodeId: string) {
  const [row] = await db
    .select()
    .from(episodeVersions)
    .where(eq(episodeVersions.episodeId, episodeId))
    .orderBy(desc(episodeVersions.versionNumber))
    .limit(1);
  return row ?? null;
}

export async function listVersions(episodeId: string) {
  return db
    .select()
    .from(episodeVersions)
    .where(eq(episodeVersions.episodeId, episodeId))
    .orderBy(desc(episodeVersions.versionNumber));
}

export async function listSources(episodeId: string) {
  return db
    .select()
    .from(researchSources)
    .where(eq(researchSources.episodeId, episodeId))
    .orderBy(asc(researchSources.createdAt));
}

export async function listScenes(episodeId: string) {
  return db
    .select({
      scene: scenes,
      assetCount: raw<number>`(select count(*)::int from scene_assets sa where sa.scene_id = ${scenes.id})`,
      sourceCount: raw<number>`(select count(*)::int from scene_sources ss where ss.scene_id = ${scenes.id})`,
    })
    .from(scenes)
    .where(eq(scenes.episodeId, episodeId))
    .orderBy(asc(scenes.position));
}

/** Assets attached to an episode, joined to their licence record. */
export async function listEpisodeAssets(episodeId: string) {
  return db
    .select({ asset: mediaAssets, license: assetLicenses })
    .from(mediaAssets)
    .leftJoin(assetLicenses, eq(assetLicenses.id, mediaAssets.licenseId))
    .where(eq(mediaAssets.episodeId, episodeId))
    .orderBy(desc(mediaAssets.createdAt));
}

export interface AssetLibraryFilters {
  kind?: string;
  search?: string;
  /** 'cleared' | 'uncleared' */
  clearance?: string;
  scope?: "all" | "library";
}

export async function listAssetLibrary(filters: AssetLibraryFilters = {}) {
  const conditions = [];
  if (filters.kind) conditions.push(eq(mediaAssets.kind, filters.kind as never));
  if (filters.scope === "library") conditions.push(isNull(mediaAssets.episodeId));
  if (filters.clearance === "cleared") conditions.push(eq(assetLicenses.isCleared, true));
  if (filters.clearance === "uncleared") {
    conditions.push(
      or(isNull(mediaAssets.licenseId), eq(assetLicenses.isCleared, false)),
    );
  }
  if (filters.search) {
    const pattern = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      or(
        raw`lower(${mediaAssets.title}) like ${pattern}`,
        raw`lower(coalesce(${mediaAssets.description}, '')) like ${pattern}`,
        raw`lower(coalesce(${mediaAssets.creditLine}, '')) like ${pattern}`,
      ),
    );
  }

  return db
    .select({ asset: mediaAssets, license: assetLicenses, episodeTitle: episodes.title })
    .from(mediaAssets)
    .leftJoin(assetLicenses, eq(assetLicenses.id, mediaAssets.licenseId))
    .leftJoin(episodes, eq(episodes.id, mediaAssets.episodeId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(mediaAssets.createdAt));
}

export async function listLicenses() {
  return db.select().from(assetLicenses).orderBy(asc(assetLicenses.name));
}

export async function listVoiceovers(episodeId: string) {
  return db
    .select()
    .from(voiceovers)
    .where(eq(voiceovers.episodeId, episodeId))
    .orderBy(desc(voiceovers.createdAt));
}

export async function listCaptions(episodeId: string) {
  return db
    .select()
    .from(captions)
    .where(eq(captions.episodeId, episodeId))
    .orderBy(desc(captions.createdAt));
}

export async function listRenders(episodeId: string) {
  return db
    .select()
    .from(renders)
    .where(eq(renders.episodeId, episodeId))
    .orderBy(desc(renders.createdAt));
}

export async function listSocialPosts(episodeId: string) {
  return db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.episodeId, episodeId))
    .orderBy(asc(socialPosts.platform));
}

/**
 * Gathers everything the workflow rules need in one round trip. Kept as one
 * query so the readiness shown in the UI and the readiness checked on submit
 * can never disagree.
 */
export async function getReadiness(episodeId: string): Promise<EpisodeReadiness> {
  const [row] = await db.execute<{
    has_script: boolean;
    word_count: number;
    scene_count: number;
    verified_sources: number;
    unresolved_sources: number;
    uncleared_assets: number;
    unreviewed_ai_scenes: number;
    has_approved_version: boolean;
    planned_seconds: number;
    target_min_seconds: number | null;
    target_max_seconds: number | null;
  }>(raw`
    select
      exists (select 1 from episode_versions v where v.episode_id = ${episodeId}) as has_script,
      coalesce((
        select v.word_count from episode_versions v
        where v.episode_id = ${episodeId}
        order by v.version_number desc limit 1
      ), 0)::int as word_count,
      (select count(*) from scenes s where s.episode_id = ${episodeId})::int as scene_count,
      (select count(*) from research_sources r
        where r.episode_id = ${episodeId} and r.verification = 'verified')::int as verified_sources,
      (select count(*) from research_sources r
        where r.episode_id = ${episodeId} and r.verification in ('unverified','disputed'))::int as unresolved_sources,
      (select count(*) from media_assets m
        left join asset_licenses l on l.id = m.license_id
        where m.episode_id = ${episodeId}
          and (m.license_id is null or l.is_cleared = false))::int as uncleared_assets,
      (select count(*) from scenes s
        where s.episode_id = ${episodeId}
          and s.is_ai_suggested = true and s.human_reviewed = false)::int as unreviewed_ai_scenes,
      (select e.approved_version_id is not null from episodes e where e.id = ${episodeId}) as has_approved_version,
      coalesce((select sum(s.estimated_seconds) from scenes s where s.episode_id = ${episodeId}), 0)::float8 as planned_seconds,
      -- The target window depends on whether this row is the long-form cut or a
      -- standalone social bite.
      (select case when e.primary_format = 'short_form'
                   then sr.short_form_target_min_seconds
                   else sr.long_form_target_min_seconds end
         from episodes e join series sr on sr.id = e.series_id
        where e.id = ${episodeId}) as target_min_seconds,
      (select case when e.primary_format = 'short_form'
                   then sr.short_form_target_max_seconds
                   else sr.long_form_target_max_seconds end
         from episodes e join series sr on sr.id = e.series_id
        where e.id = ${episodeId}) as target_max_seconds
  `);

  return {
    hasScript: Boolean(row?.has_script),
    wordCount: Number(row?.word_count ?? 0),
    sceneCount: Number(row?.scene_count ?? 0),
    verifiedSourceCount: Number(row?.verified_sources ?? 0),
    unresolvedSourceCount: Number(row?.unresolved_sources ?? 0),
    unclearedAssetCount: Number(row?.uncleared_assets ?? 0),
    unreviewedAiSceneCount: Number(row?.unreviewed_ai_scenes ?? 0),
    hasApprovedVersion: Boolean(row?.has_approved_version),
    plannedSeconds: Number(row?.planned_seconds ?? 0),
    targetMinSeconds: row?.target_min_seconds != null ? Number(row.target_min_seconds) : null,
    targetMaxSeconds: row?.target_max_seconds != null ? Number(row.target_max_seconds) : null,
  };
}

/**
 * The other language versions of an episode: its original (if this row is a
 * translation) and every translation of the original.
 */
export async function listTranslations(episodeId: string) {
  return db.execute<{
    id: string;
    title: string;
    language: string;
    status: string;
    is_original: boolean;
  }>(raw`
    with root as (
      select coalesce(translation_of_id, id) as root_id from episodes where id = ${episodeId}
    )
    select e.id, e.title, e.language, e.status, (e.translation_of_id is null) as is_original
    from episodes e, root
    where (e.id = root.root_id or e.translation_of_id = root.root_id)
      and e.id <> ${episodeId}
    order by e.translation_of_id nulls first, e.language
  `);
}

/** Counts for the dashboard tiles. */
export async function getDashboardCounts() {
  const rows = await db
    .select({ status: episodes.status, count: raw<number>`count(*)::int` })
    .from(episodes)
    .groupBy(episodes.status);

  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = Number(row.count);

  const [assetRow] = await db
    .select({
      total: raw<number>`count(*)::int`,
      uncleared: raw<number>`count(*) filter (where ${mediaAssets.licenseId} is null or ${assetLicenses.isCleared} = false)::int`,
    })
    .from(mediaAssets)
    .leftJoin(assetLicenses, eq(assetLicenses.id, mediaAssets.licenseId));

  const [sourceRow] = await db
    .select({
      total: raw<number>`count(*)::int`,
      unverified: raw<number>`count(*) filter (where ${researchSources.verification} = 'unverified')::int`,
    })
    .from(researchSources);

  return {
    byStatus,
    totalEpisodes: Object.values(byStatus).reduce((a, b) => a + b, 0),
    assets: { total: Number(assetRow?.total ?? 0), uncleared: Number(assetRow?.uncleared ?? 0) },
    sources: { total: Number(sourceRow?.total ?? 0), unverified: Number(sourceRow?.unverified ?? 0) },
  };
}

export async function listSceneAssetLinks(episodeId: string) {
  return db
    .select({ link: sceneAssets, asset: mediaAssets })
    .from(sceneAssets)
    .innerJoin(scenes, eq(scenes.id, sceneAssets.sceneId))
    .innerJoin(mediaAssets, eq(mediaAssets.id, sceneAssets.assetId))
    .where(eq(scenes.episodeId, episodeId))
    .orderBy(asc(sceneAssets.position));
}

export async function listSceneSourceLinks(episodeId: string) {
  return db
    .select({ link: sceneSources, source: researchSources })
    .from(sceneSources)
    .innerJoin(scenes, eq(scenes.id, sceneSources.sceneId))
    .innerJoin(researchSources, eq(researchSources.id, sceneSources.sourceId))
    .where(eq(scenes.episodeId, episodeId));
}
