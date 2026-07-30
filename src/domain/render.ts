/**
 * Turning an approved scene plan into a timed video plan.
 *
 * Like `workflow.ts` this module is pure — no database, no ffmpeg, no file
 * system — so the timing rules can be unit tested and reused by the worker, the
 * review screen and (later) the publisher without dragging in a connection.
 *
 * Rendering is deliberately *not* gated on approval. Approval governs
 * publishing; you need to watch a cut before you can sensibly approve it. What
 * a render does record is which script version it was built from, so an
 * approved episode can never be confused with a render of a later draft.
 */
import type { SceneTemplate } from "./types";

export const ASPECT_RATIOS = ["16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * 1080p in both orientations. Both are even in each axis, which H.264 with
 * yuv420p chroma subsampling requires — odd dimensions fail to encode.
 */
export const ASPECT_DIMENSIONS: Record<AspectRatio, Dimensions> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

export const DEFAULT_FPS = 30;

/**
 * Used when a scene carries no estimate. Short enough that an unplanned scene
 * is visibly a placeholder rather than dead air someone might not notice.
 */
export const DEFAULT_SCENE_SECONDS = 5;

/** Below this a scene is a subliminal flash; above it, almost certainly a typo. */
export const MIN_SCENE_SECONDS = 1;
export const MAX_SCENE_SECONDS = 120;

/**
 * Breathing room left after a scene's own narration finishes.
 *
 * Cutting on the last syllable reads as a mistake. Four tenths of a second is
 * long enough to feel deliberate and short enough not to drag across forty
 * scenes, where it would otherwise add sixteen seconds of dead air.
 */
export const SCENE_NARRATION_TAIL_SECONDS = 0.4;

export interface PlannedScene {
  id: string;
  position: number;
  heading: string;
  onScreenText: string | null;
  narrationText: string | null;
  template: SceneTemplate;
  estimatedSeconds: number | null;
  /**
   * Storage key of the still to use as this scene's background, if one is
   * linked. Absent means the segment falls back to a plain card, which is a
   * legitimate look for title and quote cards.
   */
  backgroundKey: string | null;
  /** Storage key of this scene's own narration, when recorded per scene. */
  narrationKey?: string | null;
  /** Length of that narration, so the scene can be timed to it. */
  narrationSeconds?: number | null;
}

export interface RenderSegment {
  sceneId: string;
  position: number;
  /** Large text: the scene heading. */
  heading: string;
  /** Smaller supporting text drawn under the heading, if any. */
  caption: string | null;
  template: SceneTemplate;
  backgroundKey: string | null;
  /** This scene's own narration, laid under it rather than under the episode. */
  narrationKey: string | null;
  startSeconds: number;
  durationSeconds: number;
  /** True when `durationSeconds` came from a fallback rather than the plan. */
  durationIsEstimated: boolean;
}

export interface RenderPlan {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  segments: RenderSegment[];
  totalSeconds: number;
  /** Length of the narration this plan was fitted to, when one is selected. */
  narrationSeconds: number | null;
}

/**
 * Clamps a scene's planned duration into a range that can actually be encoded,
 * and reports whether the value had to be invented or corrected.
 */
export function resolveSceneSeconds(estimated: number | null): {
  seconds: number;
  isEstimated: boolean;
} {
  if (estimated === null || !Number.isFinite(estimated) || estimated <= 0) {
    return { seconds: DEFAULT_SCENE_SECONDS, isEstimated: true };
  }
  const clamped = Math.min(Math.max(estimated, MIN_SCENE_SECONDS), MAX_SCENE_SECONDS);
  return { seconds: clamped, isEstimated: clamped !== estimated };
}

/**
 * The text drawn beneath the heading. `on_screen_text` is what an editor wrote
 * *for the screen*, so it wins; narration is spoken, not shown, and is only
 * borrowed as a legible fallback for a scene that has no on-screen copy.
 */
function captionFor(scene: PlannedScene, suppressNarration = false): string | null {
  const onScreen = scene.onScreenText?.trim();
  if (onScreen) return onScreen;
  // With subtitles burned in, borrowing the narration here would print the same
  // words twice, in two different places, in the same frame.
  if (suppressNarration) return null;
  const narration = scene.narrationText?.trim();
  if (!narration) return null;
  // A full narration paragraph would overflow the frame; one sentence reads.
  const firstSentence = narration.split(/(?<=[.!?])\s+/)[0] ?? narration;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence;
}

/**
 * Lays scenes end to end, assigning each a start offset. Scenes are ordered by
 * `position` rather than trusting input order, because the scene planner
 * reorders by mutating positions.
 */
export function buildRenderPlan(
  scenes: PlannedScene[],
  options: {
    aspectRatio: AspectRatio;
    fps?: number;
    narrationSeconds?: number | null;
    /**
     * Set when subtitles will be burned in: the narration then appears as a
     * caption *and* as a subtitle, which is the same sentence twice.
     */
    suppressNarrationCaptions?: boolean;
  },
): RenderPlan {
  const { width, height } = ASPECT_DIMENSIONS[options.aspectRatio];
  const ordered = [...scenes].sort((a, b) => a.position - b.position);

  let cursor = 0;
  const segments: RenderSegment[] = ordered.map((scene) => {
    const planned = resolveSceneSeconds(scene.estimatedSeconds);
    let seconds = planned.seconds;
    let isEstimated = planned.isEstimated;

    // A scene with its own narration is timed to that recording, not to the
    // estimate someone typed before it existed. The estimate becomes a floor:
    // a short line on a scene meant to breathe still gets its planned length.
    const own = scene.narrationSeconds ?? null;
    if (own !== null && Number.isFinite(own) && own > 0) {
      const needed = own + SCENE_NARRATION_TAIL_SECONDS;
      if (needed > seconds) {
        seconds = needed;
        isEstimated = true;
      }
    }

    const segment: RenderSegment = {
      sceneId: scene.id,
      position: scene.position,
      heading: scene.heading,
      caption: captionFor(scene, options.suppressNarrationCaptions),
      template: scene.template,
      backgroundKey: scene.backgroundKey,
      narrationKey: scene.narrationKey ?? null,
      startSeconds: round3(cursor),
      durationSeconds: round3(seconds),
      durationIsEstimated: isEstimated,
    };
    cursor += seconds;
    return segment;
  });

  // Narration must never be cut off mid-sentence. If the recording outlasts the
  // scene plan, hold the last scene until it finishes rather than truncating —
  // a picture that lingers is a stylistic wrinkle, a clipped word is a defect.
  //
  // This only applies to one recording laid under the whole episode. With
  // per-scene narration each scene has already been timed to its own line, and
  // stretching the last one on top of that would just add dead air.
  const hasPerScene = segments.some((segment) => segment.narrationKey !== null);
  const narration = hasPerScene ? null : options.narrationSeconds ?? null;
  const lastSegment = segments.at(-1);
  if (narration !== null && Number.isFinite(narration) && narration > cursor && lastSegment) {
    const shortfall = narration - cursor;
    lastSegment.durationSeconds = round3(lastSegment.durationSeconds + shortfall);
    lastSegment.durationIsEstimated = true;
    cursor = narration;
  }

  return {
    aspectRatio: options.aspectRatio,
    width,
    height,
    fps: options.fps ?? DEFAULT_FPS,
    segments,
    totalSeconds: round3(cursor),
    narrationSeconds: narration,
  };
}

export interface RenderReadiness {
  sceneCount: number;
  /** Scenes whose duration had to be invented, i.e. no estimate was recorded. */
  scenesWithoutDuration: number;
  /** Target window for this episode's format, when the series defines one. */
  targetWindow: { minSeconds: number; maxSeconds: number } | null;
  /** Total of the scene estimates before any narration fitting was applied. */
  plannedSceneSeconds?: number;
  /** Scenes carrying their own narration. */
  perSceneNarrationCount?: number;
  /** True when a whole-episode recording is also selected. */
  hasEpisodeNarration?: boolean;
}

/**
 * How far the scene plan may sit under the narration before it is worth saying
 * so. Below this, holding the last frame is unnoticeable.
 */
export const NARRATION_DRIFT_WARN_SECONDS = 5;

export interface RenderDecision {
  canRender: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Whether a render can start, and what the operator should know before watching
 * the result.
 *
 * Only one thing genuinely blocks a render: having nothing to show. Everything
 * else warns. A render is a draft artefact — refusing to produce one because
 * the runtime drifts from target would stop the very feedback that lets someone
 * fix the drift.
 */
export function assessRender(readiness: RenderReadiness, plan: RenderPlan): RenderDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (readiness.sceneCount === 0) {
    blockers.push("Add at least one scene before rendering.");
  }

  if (readiness.scenesWithoutDuration > 0) {
    warnings.push(
      `${readiness.scenesWithoutDuration} scene(s) have no planned duration and will run ` +
        `for the ${DEFAULT_SCENE_SECONDS}s default.`,
    );
  }

  // Both kinds of narration at once would overlap, so per-scene wins and the
  // episode take is ignored. Saying so is the whole point: silently picking one
  // is how someone spends an afternoon wondering why a re-record changed nothing.
  const perScene = readiness.perSceneNarrationCount ?? 0;
  if (perScene > 0) {
    if (readiness.hasEpisodeNarration) {
      warnings.push(
        `${perScene} scene(s) have their own narration, so the whole-episode recording ` +
          `is not used. Remove the per-scene takes to go back to one recording.`,
      );
    }
    if (perScene < readiness.sceneCount) {
      warnings.push(
        `${readiness.sceneCount - perScene} scene(s) have no narration and will play silent.`,
      );
    }
  }

  const narration = plan.narrationSeconds;
  if (narration !== null && readiness.plannedSceneSeconds !== undefined) {
    const drift = narration - readiness.plannedSceneSeconds;
    if (drift > NARRATION_DRIFT_WARN_SECONDS) {
      warnings.push(
        `Narration runs ${formatSeconds(drift)} longer than the scene plan; the last ` +
          `scene is held to cover it. Add or lengthen scenes to control what is on screen.`,
      );
    } else if (-drift > NARRATION_DRIFT_WARN_SECONDS) {
      warnings.push(
        `The scene plan runs ${formatSeconds(-drift)} longer than the narration; the ` +
          `film ends in silence.`,
      );
    }
  }

  const target = readiness.targetWindow;
  if (target && plan.totalSeconds > 0) {
    if (plan.totalSeconds < target.minSeconds) {
      warnings.push(
        `Planned runtime ${formatSeconds(plan.totalSeconds)} is under the ` +
          `${formatSeconds(target.minSeconds)} target.`,
      );
    } else if (plan.totalSeconds > target.maxSeconds) {
      warnings.push(
        `Planned runtime ${formatSeconds(plan.totalSeconds)} is over the ` +
          `${formatSeconds(target.maxSeconds)} target.`,
      );
    }
  }

  return { canRender: blockers.length === 0, blockers, warnings };
}

/** `m:ss`, the form the review screen already uses for runtimes. */
export function formatSeconds(total: number): string {
  const whole = Math.round(total);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Milliseconds are the finest unit the schema stores (NUMERIC(10,3)). */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
