import { describe, expect, it } from "vitest";

import {
  ASPECT_DIMENSIONS,
  DEFAULT_SCENE_SECONDS,
  MAX_SCENE_SECONDS,
  MIN_SCENE_SECONDS,
  assessRender,
  buildRenderPlan,
  formatSeconds,
  resolveSceneSeconds,
  type PlannedScene,
} from "./render";

function scene(overrides: Partial<PlannedScene> = {}): PlannedScene {
  return {
    id: "scene-1",
    position: 1,
    heading: "Opening",
    onScreenText: null,
    narrationText: null,
    template: "archival_still",
    estimatedSeconds: 10,
    backgroundKey: null,
    ...overrides,
  };
}

describe("resolveSceneSeconds", () => {
  it("keeps a sensible planned duration as-is", () => {
    expect(resolveSceneSeconds(12)).toEqual({ seconds: 12, isEstimated: false });
  });

  it("falls back to the default when no estimate was recorded", () => {
    expect(resolveSceneSeconds(null)).toEqual({
      seconds: DEFAULT_SCENE_SECONDS,
      isEstimated: true,
    });
  });

  it("treats zero and negatives as missing rather than encoding them", () => {
    expect(resolveSceneSeconds(0).seconds).toBe(DEFAULT_SCENE_SECONDS);
    expect(resolveSceneSeconds(-4).seconds).toBe(DEFAULT_SCENE_SECONDS);
    expect(resolveSceneSeconds(Number.NaN).seconds).toBe(DEFAULT_SCENE_SECONDS);
  });

  it("clamps durations that would be unencodable or absurd", () => {
    expect(resolveSceneSeconds(0.2)).toEqual({ seconds: MIN_SCENE_SECONDS, isEstimated: true });
    expect(resolveSceneSeconds(9999)).toEqual({ seconds: MAX_SCENE_SECONDS, isEstimated: true });
  });
});

describe("buildRenderPlan", () => {
  it("lays scenes end to end with cumulative start offsets", () => {
    const plan = buildRenderPlan(
      [
        scene({ id: "a", position: 1, estimatedSeconds: 4 }),
        scene({ id: "b", position: 2, estimatedSeconds: 6 }),
        scene({ id: "c", position: 3, estimatedSeconds: 2.5 }),
      ],
      { aspectRatio: "16:9" },
    );

    expect(plan.segments.map((s) => s.startSeconds)).toEqual([0, 4, 10]);
    expect(plan.totalSeconds).toBe(12.5);
  });

  it("orders by position rather than trusting input order", () => {
    const plan = buildRenderPlan(
      [
        scene({ id: "third", position: 3 }),
        scene({ id: "first", position: 1 }),
        scene({ id: "second", position: 2 }),
      ],
      { aspectRatio: "16:9" },
    );

    expect(plan.segments.map((s) => s.sceneId)).toEqual(["first", "second", "third"]);
  });

  it("uses the dimensions of the requested aspect ratio", () => {
    const wide = buildRenderPlan([scene()], { aspectRatio: "16:9" });
    const tall = buildRenderPlan([scene()], { aspectRatio: "9:16" });

    expect({ width: wide.width, height: wide.height }).toEqual(ASPECT_DIMENSIONS["16:9"]);
    expect({ width: tall.width, height: tall.height }).toEqual(ASPECT_DIMENSIONS["9:16"]);
  });

  it("produces even dimensions, which H.264 with yuv420p requires", () => {
    for (const ratio of ["16:9", "9:16"] as const) {
      const { width, height } = ASPECT_DIMENSIONS[ratio];
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });

  it("prefers on-screen text over narration for the caption", () => {
    const plan = buildRenderPlan(
      [scene({ onScreenText: "Santo Domingo, 1586", narrationText: "Drake's raid began…" })],
      { aspectRatio: "16:9" },
    );

    expect(plan.segments[0]!.caption).toBe("Santo Domingo, 1586");
  });

  it("borrows only the first sentence of narration when there is no on-screen text", () => {
    const plan = buildRenderPlan(
      [scene({ narrationText: "Drake landed at dawn. The city fell within hours." })],
      { aspectRatio: "16:9" },
    );

    expect(plan.segments[0]!.caption).toBe("Drake landed at dawn.");
  });

  it("truncates a very long narration sentence rather than overflowing the frame", () => {
    const plan = buildRenderPlan([scene({ narrationText: "x".repeat(400) })], {
      aspectRatio: "16:9",
    });

    const caption = plan.segments[0]!.caption!;
    expect(caption.length).toBeLessThanOrEqual(160);
    expect(caption.endsWith("…")).toBe(true);
  });

  it("leaves the caption empty when a scene has neither kind of text", () => {
    const plan = buildRenderPlan([scene()], { aspectRatio: "16:9" });
    expect(plan.segments[0]!.caption).toBeNull();
  });

  it("flags segments whose duration was invented", () => {
    const plan = buildRenderPlan(
      [scene({ id: "a", position: 1, estimatedSeconds: 8 }), scene({ id: "b", position: 2, estimatedSeconds: null })],
      { aspectRatio: "16:9" },
    );

    expect(plan.segments.map((s) => s.durationIsEstimated)).toEqual([false, true]);
  });

  it("returns an empty plan rather than throwing when there are no scenes", () => {
    const plan = buildRenderPlan([], { aspectRatio: "16:9" });
    expect(plan.segments).toEqual([]);
    expect(plan.totalSeconds).toBe(0);
  });
});

describe("assessRender", () => {
  // 5:00 total, built from scenes short enough not to hit the per-scene clamp.
  const plan = buildRenderPlan(
    [
      scene({ id: "a", position: 1, estimatedSeconds: 100 }),
      scene({ id: "b", position: 2, estimatedSeconds: 100 }),
      scene({ id: "c", position: 3, estimatedSeconds: 100 }),
    ],
    { aspectRatio: "16:9" },
  );

  it("blocks only when there is nothing to show", () => {
    const decision = assessRender(
      { sceneCount: 0, scenesWithoutDuration: 0, targetWindow: null },
      buildRenderPlan([], { aspectRatio: "16:9" }),
    );

    expect(decision.canRender).toBe(false);
    expect(decision.blockers.join(" ")).toMatch(/at least one scene/i);
  });

  it("allows a render with scenes present", () => {
    const decision = assessRender(
      { sceneCount: 1, scenesWithoutDuration: 0, targetWindow: null },
      plan,
    );

    expect(decision.canRender).toBe(true);
    expect(decision.blockers).toEqual([]);
  });

  it("warns, never blocks, when runtime is under the target window", () => {
    const decision = assessRender(
      { sceneCount: 1, scenesWithoutDuration: 0, targetWindow: { minSeconds: 400, maxSeconds: 500 } },
      plan,
    );

    expect(decision.canRender).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/under the/i);
  });

  it("warns, never blocks, when runtime is over the target window", () => {
    const decision = assessRender(
      { sceneCount: 1, scenesWithoutDuration: 0, targetWindow: { minSeconds: 60, maxSeconds: 120 } },
      plan,
    );

    expect(decision.canRender).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/over the/i);
  });

  it("stays silent when runtime sits inside the target window", () => {
    const decision = assessRender(
      { sceneCount: 1, scenesWithoutDuration: 0, targetWindow: { minSeconds: 240, maxSeconds: 360 } },
      plan,
    );

    expect(decision.warnings).toEqual([]);
  });

  it("warns about scenes that will run for the default duration", () => {
    const decision = assessRender(
      { sceneCount: 3, scenesWithoutDuration: 2, targetWindow: null },
      plan,
    );

    expect(decision.canRender).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/no planned duration/i);
  });
});

describe("formatSeconds", () => {
  it("formats as m:ss with a padded seconds field", () => {
    expect(formatSeconds(0)).toBe("0:00");
    expect(formatSeconds(9)).toBe("0:09");
    expect(formatSeconds(65)).toBe("1:05");
    expect(formatSeconds(313)).toBe("5:13");
  });
});
