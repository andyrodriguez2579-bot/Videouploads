import "server-only";

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";

import { db } from "@/db/client";
import {
  episodes,
  episodeVersions,
  mediaAssets,
  renderJobs,
  renders,
  sceneAssets,
  scenes,
  series,
  voiceovers,
} from "@/db/schema";
import {
  assessRender,
  buildRenderPlan,
  type AspectRatio,
  type PlannedScene,
  type RenderPlan,
} from "@/domain/render";
import type { RenderKind } from "@/domain/types";
import { enqueueRender } from "@/lib/queue";
import { getRenderProvider } from "@/lib/render";
import { buildObjectKey, getStorage } from "@/lib/storage";

/**
 * Rendering orchestration: assemble the plan from the database, create the
 * render and job rows, run the encoder, and store the result.
 *
 * The job row is written before any encoding starts, so a render that dies
 * mid-way leaves a visible failed record rather than nothing at all. Progress
 * is persisted rather than held in memory for the same reason — the render
 * centre reads it straight from the table.
 */

/** Visual roles that can supply a scene's background still, best first. */
const BACKGROUND_ROLES = ["primary", "background", "map"] as const;
const BACKGROUND_KINDS = ["image", "map"] as const;

export interface RenderPreview {
  plan: RenderPlan;
  canRender: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Builds the plan for an episode without starting anything, so the UI can show
 * what a render *would* produce — runtime, scene count, outstanding warnings.
 */
export async function previewRender(
  episodeId: string,
  aspectRatio: AspectRatio,
): Promise<RenderPreview> {
  const { plannedScenes, targetWindow, narration, perSceneNarrationCount } = await loadPlanInputs(
    episodeId,
    aspectRatio,
  );
  const scenePlan = buildRenderPlan(plannedScenes, { aspectRatio });
  const plan = buildRenderPlan(plannedScenes, {
    aspectRatio,
    narrationSeconds: narration?.seconds ?? null,
  });
  const decision = assessRender(
    {
      sceneCount: plannedScenes.length,
      scenesWithoutDuration: plannedScenes.filter((s) => s.estimatedSeconds === null).length,
      targetWindow,
      plannedSceneSeconds: scenePlan.totalSeconds,
      perSceneNarrationCount,
      hasEpisodeNarration: narration !== null,
    },
    plan,
  );

  return { plan, ...decision };
}

/**
 * Creates the render and job rows and kicks the encoder off in the background.
 *
 * Returns as soon as the rows exist: a five-minute episode takes far longer to
 * encode than a request should be held open, and the render centre already
 * polls the job row for progress.
 *
 * Where the work then runs depends on `REDIS_URL`. With it, the render goes to
 * a BullMQ worker that survives a restart and retries on failure. Without it,
 * it runs in this process — which is fine on a laptop, and is why Redis stays
 * optional rather than becoming a hard dependency of rendering at all.
 */
export async function startRender(input: {
  episodeId: string;
  kind: RenderKind;
  aspectRatio: AspectRatio;
  label?: string | null;
}): Promise<{ renderId: string; jobId: string }> {
  const preview = await previewRender(input.episodeId, input.aspectRatio);
  if (!preview.canRender) {
    throw new Error(preview.blockers.join(" "));
  }

  // Pin the script version this render was built from, so an approved episode
  // can never be confused with a render of a later draft.
  const [latestVersion] = await db
    .select({ id: episodeVersions.id })
    .from(episodeVersions)
    .where(eq(episodeVersions.episodeId, input.episodeId))
    .orderBy(asc(episodeVersions.versionNumber))
    .limit(1);

  const [render] = await db
    .insert(renders)
    .values({
      episodeId: input.episodeId,
      episodeVersionId: latestVersion?.id ?? null,
      kind: input.kind,
      aspectRatio: input.aspectRatio,
      label: input.label ?? null,
      status: "queued",
      storageDriver: getStorage().name,
      details: {
        plannedSeconds: preview.plan.totalSeconds,
        sceneCount: preview.plan.segments.length,
        warnings: preview.warnings,
      },
    })
    .returning();

  if (!render) throw new Error("Could not create the render record.");

  const [job] = await db
    .insert(renderJobs)
    .values({
      renderId: render.id,
      queueName: "renders",
      externalJobId: randomUUID(),
      status: "queued",
      progress: 0,
      stage: "Queued",
    })
    .returning();

  if (!job) throw new Error("Could not create the render job.");

  // With Redis configured the work is handed to a worker that survives a
  // restart. Without it, run in-process: the job row is still the record of
  // progress, but an interrupted render is orphaned until reclaimed.
  let queuedJobId: string | null;
  try {
    queuedJobId = await enqueueRender(render.id);
  } catch (error) {
    // Redis is configured but unreachable. Fail the render now rather than
    // leaving it at `queued` forever: nothing will ever pick it up, and the
    // stale reclaimer deliberately only touches jobs that reached `running`.
    const message = `Could not queue the render: ${
      error instanceof Error ? error.message : "the job queue is unreachable"
    }`;
    const now = new Date();
    await db
      .update(renders)
      .set({ status: "failed", errorMessage: message, updatedAt: now })
      .where(eq(renders.id, render.id));
    await db
      .update(renderJobs)
      .set({ status: "failed", stage: "Not queued", errorMessage: message, finishedAt: now, updatedAt: now })
      .where(eq(renderJobs.id, job.id));
    throw new Error(message);
  }

  if (queuedJobId) {
    await db
      .update(renderJobs)
      .set({ externalJobId: queuedJobId, stage: "Waiting for a worker", updatedAt: new Date() })
      .where(eq(renderJobs.id, job.id));
  } else {
    void runRenderJob(render.id).catch((error) => {
      console.error("[renders] job crashed outside its own handler", {
        renderId: render.id,
        error,
      });
    });
  }

  return { renderId: render.id, jobId: job.id };
}

/**
 * Runs one queued render to completion. Exported so a queue worker can call it
 * directly once BullMQ lands, and so it can be driven from a script.
 */
export async function runRenderJob(renderId: string): Promise<void> {
  const [render] = await db.select().from(renders).where(eq(renders.id, renderId)).limit(1);
  if (!render) return;

  const [job] = await db
    .select()
    .from(renderJobs)
    .where(eq(renderJobs.renderId, renderId))
    .limit(1);

  const started = new Date();
  await db
    .update(renders)
    .set({ status: "running", updatedAt: started })
    .where(eq(renders.id, renderId));
  if (job) {
    await db
      .update(renderJobs)
      .set({
        status: "running",
        attempt: job.attempt + 1,
        startedAt: started,
        stage: "Preparing",
        updatedAt: started,
      })
      .where(eq(renderJobs.id, job.id));
  }

  const aspectRatio = (render.aspectRatio === "9:16" ? "9:16" : "16:9") as AspectRatio;
  const workDir = await mkdtemp(path.join(tmpdir(), "historia-job-"));

  try {
    const { plannedScenes, narration } = await loadPlanInputs(render.episodeId, aspectRatio);
    const plan = buildRenderPlan(plannedScenes, {
      aspectRatio,
      narrationSeconds: narration?.seconds ?? null,
    });
    if (plan.segments.length === 0) throw new Error("The episode has no scenes to render.");

    const storage = getStorage();
    const outputPath = path.join(workDir, "render.mp4");

    const result = await getRenderProvider().render({
      plan,
      outputPath,
      resolveAsset: (key) => stageAsset(storage, key, workDir),
      narrationPath: narration ? await stageAsset(storage, narration.objectKey, workDir) : null,
      onProgress: async (progress) => {
        if (!job) return;
        const percent = Math.min(
          99,
          Math.round((progress.completed / Math.max(progress.total, 1)) * 100),
        );
        await db
          .update(renderJobs)
          .set({ progress: percent, stage: progress.stage, updatedAt: new Date() })
          .where(eq(renderJobs.id, job.id));
      },
    });

    const objectKey = buildObjectKey({
      scope: "episodes",
      scopeId: render.episodeId,
      category: "renders",
      filename: `${render.kind}-${aspectRatio.replace(":", "x")}.mp4`,
    });

    const stored = await storage.put({
      key: objectKey,
      body: await readFile(result.outputPath),
      contentType: result.mimeType,
    });

    const finished = new Date();
    await db
      .update(renders)
      .set({
        status: "succeeded",
        objectKey: stored.key,
        storageDriver: stored.driver,
        mimeType: result.mimeType,
        byteSize: stored.byteSize,
        durationSeconds: String(result.durationSeconds),
        width: result.width,
        height: result.height,
        errorMessage: null,
        details: {
          ...(render.details as Record<string, unknown>),
          narrationMixed: Boolean(narration),
          loudnessLufs: result.loudnessLufs,
        },
        updatedAt: finished,
      })
      .where(eq(renders.id, renderId));

    // Record what the narration actually measured once normalised, so an
    // operator can see the delivered loudness without re-probing the file.
    if (narration && result.loudnessLufs !== null) {
      await db
        .update(voiceovers)
        .set({ loudnessLufs: String(result.loudnessLufs), updatedAt: finished })
        .where(eq(voiceovers.id, narration.id));
    }

    if (job) {
      await db
        .update(renderJobs)
        .set({
          status: "succeeded",
          progress: 100,
          stage: "Complete",
          log: result.log,
          finishedAt: finished,
          updatedAt: finished,
        })
        .where(eq(renderJobs.id, job.id));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The render failed.";
    const finished = new Date();

    await db
      .update(renders)
      .set({ status: "failed", errorMessage: message, updatedAt: finished })
      .where(eq(renders.id, renderId));

    if (job) {
      await db
        .update(renderJobs)
        .set({
          status: "failed",
          stage: "Failed",
          errorMessage: message,
          finishedAt: finished,
          updatedAt: finished,
        })
        .where(eq(renderJobs.id, job.id));
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      // Losing a temp directory is not worth surfacing to the operator.
    });
  }
}

/**
 * How long a job may sit in `running` without its progress moving before it is
 * presumed dead. Comfortably longer than a slow encode's gap between segments.
 */
export const STALE_RENDER_MINUTES = 30;

/**
 * Fails jobs left `running` by a process that died mid-encode.
 *
 * Only `running` is reclaimed, never `queued`: with a worker configured a job
 * legitimately waits in `queued` until one picks it up, and failing those would
 * break the very durability this exists to provide. Progress updates keep
 * `updated_at` moving, so a live render is never mistaken for a dead one.
 */
export async function reclaimStaleRenders(
  olderThanMinutes: number = STALE_RENDER_MINUTES,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const message =
    "The process running this render stopped before it finished. Start it again.";

  const stale = await db
    .select({ id: renderJobs.id, renderId: renderJobs.renderId })
    .from(renderJobs)
    .where(and(eq(renderJobs.status, "running"), lt(renderJobs.updatedAt, cutoff)));

  if (stale.length === 0) return 0;

  const now = new Date();
  await db
    .update(renderJobs)
    .set({ status: "failed", stage: "Interrupted", errorMessage: message, finishedAt: now, updatedAt: now })
    .where(
      inArray(
        renderJobs.id,
        stale.map((row) => row.id),
      ),
    );

  await db
    .update(renders)
    .set({ status: "failed", errorMessage: message, updatedAt: now })
    .where(
      inArray(
        renders.id,
        stale.map((row) => row.renderId),
      ),
    );

  return stale.length;
}

/**
 * Copies a stored object to a local file the encoder can read. Going through
 * the storage driver rather than touching the filesystem keeps this working
 * unchanged when assets live in S3.
 */
async function stageAsset(
  storage: ReturnType<typeof getStorage>,
  key: string,
  workDir: string,
): Promise<string | null> {
  try {
    const body = await storage.get(key);
    const localPath = path.join(workDir, `asset-${path.basename(key)}`);
    await writeFile(localPath, body);
    return localPath;
  } catch {
    // A missing still must not fail the whole render — the scene falls back to
    // a plain card, which is visibly wrong in the output rather than silently.
    return null;
  }
}

/**
 * Reads everything the planner needs: ordered scenes, each scene's background
 * still, and the series duration window for this episode's format.
 */
async function loadPlanInputs(
  episodeId: string,
  aspectRatio: AspectRatio,
): Promise<{
  plannedScenes: PlannedScene[];
  targetWindow: { minSeconds: number; maxSeconds: number } | null;
  narration: { objectKey: string; seconds: number | null; id: string } | null;
  perSceneNarrationCount: number;
}> {
  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.episodeId, episodeId))
    .orderBy(asc(scenes.position));

  const sceneIds = sceneRows.map((scene) => scene.id);
  const backgrounds = await loadBackgroundKeys(sceneIds);
  const sceneNarration = await loadSceneNarration(sceneIds);

  const plannedScenes: PlannedScene[] = sceneRows.map((scene) => ({
    id: scene.id,
    position: scene.position,
    heading: scene.heading,
    onScreenText: scene.onScreenText,
    narrationText: scene.narrationText,
    template: scene.template,
    estimatedSeconds: scene.estimatedSeconds === null ? null : Number(scene.estimatedSeconds),
    backgroundKey: backgrounds.get(scene.id) ?? null,
    narrationKey: sceneNarration.get(scene.id)?.objectKey ?? null,
    narrationSeconds: sceneNarration.get(scene.id)?.seconds ?? null,
  }));

  const [narrationRow] = await db
    .select({
      id: voiceovers.id,
      objectKey: voiceovers.objectKey,
      durationSeconds: voiceovers.durationSeconds,
    })
    .from(voiceovers)
    .where(
      and(
        eq(voiceovers.episodeId, episodeId),
        eq(voiceovers.isSelected, true),
        eq(voiceovers.status, "ready"),
        // Full-episode narration only. Per-scene narration is a later slice;
        // mixing the two would produce overlapping audio.
        isNull(voiceovers.sceneId),
      ),
    )
    .limit(1);

  return {
    plannedScenes,
    perSceneNarrationCount: sceneNarration.size,
    targetWindow: await loadTargetWindow(episodeId, aspectRatio),
    narration:
      narrationRow?.objectKey
        ? {
            id: narrationRow.id,
            objectKey: narrationRow.objectKey,
            seconds:
              narrationRow.durationSeconds === null ? null : Number(narrationRow.durationSeconds),
          }
        : null,
  };
}

/**
 * The selected narration for each scene, when narration was recorded per scene
 * rather than as one take for the episode.
 */
async function loadSceneNarration(
  sceneIds: string[],
): Promise<Map<string, { objectKey: string; seconds: number | null }>> {
  const byScene = new Map<string, { objectKey: string; seconds: number | null }>();
  if (sceneIds.length === 0) return byScene;

  const rows = await db
    .select({
      sceneId: voiceovers.sceneId,
      objectKey: voiceovers.objectKey,
      durationSeconds: voiceovers.durationSeconds,
    })
    .from(voiceovers)
    .where(
      and(
        inArray(voiceovers.sceneId, sceneIds),
        eq(voiceovers.isSelected, true),
        eq(voiceovers.status, "ready"),
      ),
    );

  for (const row of rows) {
    if (!row.sceneId || !row.objectKey) continue;
    byScene.set(row.sceneId, {
      objectKey: row.objectKey,
      seconds: row.durationSeconds === null ? null : Number(row.durationSeconds),
    });
  }
  return byScene;
}

/** The best available still per scene, preferring the `primary` role. */
async function loadBackgroundKeys(sceneIds: string[]): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  if (sceneIds.length === 0) return keys;

  const rows = await db
    .select({
      sceneId: sceneAssets.sceneId,
      role: sceneAssets.role,
      position: sceneAssets.position,
      objectKey: mediaAssets.objectKey,
      kind: mediaAssets.kind,
    })
    .from(sceneAssets)
    .innerJoin(mediaAssets, eq(mediaAssets.id, sceneAssets.assetId))
    .where(
      and(
        inArray(sceneAssets.sceneId, sceneIds),
        inArray(mediaAssets.kind, [...BACKGROUND_KINDS]),
        inArray(sceneAssets.role, [...BACKGROUND_ROLES]),
      ),
    );

  const rank = (role: string) => {
    const index = BACKGROUND_ROLES.indexOf(role as (typeof BACKGROUND_ROLES)[number]);
    return index === -1 ? BACKGROUND_ROLES.length : index;
  };

  const best = new Map<string, { rank: number; position: number; key: string }>();
  for (const row of rows) {
    const candidate = { rank: rank(row.role), position: row.position, key: row.objectKey };
    const current = best.get(row.sceneId);
    if (
      !current ||
      candidate.rank < current.rank ||
      (candidate.rank === current.rank && candidate.position < current.position)
    ) {
      best.set(row.sceneId, candidate);
    }
  }

  for (const [sceneId, chosen] of best) keys.set(sceneId, chosen.key);
  return keys;
}

/** The series window for this episode's format, when the series defines one. */
async function loadTargetWindow(
  episodeId: string,
  aspectRatio: AspectRatio,
): Promise<{ minSeconds: number; maxSeconds: number } | null> {
  const [row] = await db
    .select({
      primaryFormat: episodes.primaryFormat,
      longMin: series.longFormTargetMinSeconds,
      longMax: series.longFormTargetMaxSeconds,
      shortMin: series.shortFormTargetMinSeconds,
      shortMax: series.shortFormTargetMaxSeconds,
    })
    .from(episodes)
    .innerJoin(series, eq(series.id, episodes.seriesId))
    .where(eq(episodes.id, episodeId))
    .limit(1);

  if (!row) return null;

  // A vertical render is a short by definition, whatever the episode's own
  // format says — that is the frame it will be published in.
  const isShort = aspectRatio === "9:16" || row.primaryFormat === "short_form";
  const min = isShort ? row.shortMin : row.longMin;
  const max = isShort ? row.shortMax : row.longMax;

  return min !== null && max !== null ? { minSeconds: min, maxSeconds: max } : null;
}
