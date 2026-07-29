import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { captions, episodes, scenes } from "@/db/schema";
import {
  buildCues,
  parseSubtitles,
  reviewCaptions,
  toSrt,
  toVtt,
  type CaptionReview,
  type CaptionScene,
  type Cue,
} from "@/domain/subtitles";
import type { AspectRatio } from "@/domain/render";

import { previewRender } from "./renders";

/**
 * Captions are generated from the scene plan, not transcribed from the audio.
 *
 * The timings come from the same render plan the video is built from, so a cue
 * can never drift onto the wrong picture: change a scene's length and the
 * subtitles move with it. The words come from `scenes.narration_text`, which is
 * the script someone wrote and approved.
 */

export interface GeneratedCaptions {
  cues: Cue[];
  srt: string;
  vtt: string;
  review: CaptionReview;
}

/**
 * Builds cues for an episode without storing anything, so the UI can show what
 * generating would produce.
 */
export async function buildCaptionsFor(
  episodeId: string,
  aspectRatio: AspectRatio = "16:9",
): Promise<GeneratedCaptions> {
  const [plan, sceneRows] = await Promise.all([
    previewRender(episodeId, aspectRatio),
    db
      .select({
        id: scenes.id,
        narrationText: scenes.narrationText,
      })
      .from(scenes)
      .where(eq(scenes.episodeId, episodeId))
      .orderBy(asc(scenes.position)),
  ]);

  const narrationByScene = new Map(sceneRows.map((row) => [row.id, row.narrationText]));

  // Timings come from the plan's segments rather than the raw estimates: those
  // are the durations the film will actually use, including any fitting to
  // narration that has already happened.
  const captionScenes: CaptionScene[] = plan.plan.segments.map((segment) => ({
    startSeconds: segment.startSeconds,
    durationSeconds: segment.durationSeconds,
    narrationText: narrationByScene.get(segment.sceneId) ?? null,
  }));

  const cues = buildCues(captionScenes);
  return { cues, srt: toSrt(cues), vtt: toVtt(cues), review: reviewCaptions(cues) };
}

/**
 * Generates captions and stores them as the selected set.
 *
 * `human_reviewed` is deliberately reset to false: the text is machine-timed,
 * and a previous sign-off says nothing about cues that have just been rebuilt.
 */
export async function generateCaptions(input: {
  episodeId: string;
  userId: string;
  aspectRatio?: AspectRatio;
}): Promise<{ captionId: string; review: CaptionReview }> {
  const generated = await buildCaptionsFor(input.episodeId, input.aspectRatio ?? "16:9");
  if (generated.cues.length === 0) {
    throw new Error(
      "No narration text to caption. Add narration text to the scenes on the Scene plan tab.",
    );
  }

  const [episode] = await db
    .select({ language: episodes.language })
    .from(episodes)
    .where(eq(episodes.id, input.episodeId))
    .limit(1);

  await deselectExisting(input.episodeId);

  const [row] = await db
    .insert(captions)
    .values({
      episodeId: input.episodeId,
      language: episode?.language ?? "es",
      format: "srt",
      source: "manual",
      provider: "scene-plan",
      content: generated.srt,
      cueCount: generated.cues.length,
      status: "ready",
      humanReviewed: false,
      isSelected: true,
      createdBy: input.userId,
    })
    .returning();

  if (!row) throw new Error("Could not store the generated captions.");
  return { captionId: row.id, review: generated.review };
}

/**
 * Stores a subtitle file made elsewhere. Parsed on the way in so a malformed
 * file is refused now rather than producing an empty caption track in a render.
 */
export async function importCaptions(input: {
  episodeId: string;
  userId: string;
  filename: string;
  source: string;
}): Promise<{ captionId: string; review: CaptionReview }> {
  const cues = parseSubtitles(input.source);
  if (cues.length === 0) {
    throw new Error(
      `No cues could be read from "${input.filename}". It should be SRT or WebVTT.`,
    );
  }

  const [episode] = await db
    .select({ language: episodes.language })
    .from(episodes)
    .where(eq(episodes.id, input.episodeId))
    .limit(1);

  await deselectExisting(input.episodeId);

  // Normalised to SRT on the way in, so everything downstream reads one format.
  const [row] = await db
    .insert(captions)
    .values({
      episodeId: input.episodeId,
      language: episode?.language ?? "es",
      format: "srt",
      source: "upload",
      content: toSrt(cues),
      cueCount: cues.length,
      status: "ready",
      humanReviewed: false,
      isSelected: true,
      createdBy: input.userId,
    })
    .returning();

  if (!row) throw new Error("Could not store the imported captions.");
  return { captionId: row.id, review: reviewCaptions(cues) };
}

/** The caption set a render should burn in, if one is selected. */
export async function getSelectedCaptions(episodeId: string): Promise<{
  id: string;
  content: string;
  cueCount: number | null;
  humanReviewed: boolean;
} | null> {
  const [row] = await db
    .select({
      id: captions.id,
      content: captions.content,
      cueCount: captions.cueCount,
      humanReviewed: captions.humanReviewed,
    })
    .from(captions)
    .where(
      and(
        eq(captions.episodeId, episodeId),
        eq(captions.isSelected, true),
        eq(captions.status, "ready"),
      ),
    )
    .limit(1);

  return row?.content ? { ...row, content: row.content } : null;
}

async function deselectExisting(episodeId: string): Promise<void> {
  await db
    .update(captions)
    .set({ isSelected: false, updatedAt: new Date() })
    .where(and(eq(captions.episodeId, episodeId), eq(captions.isSelected, true)));
}

export { toSrt, toVtt, parseSubtitles };
