import { describe, expect, it } from "vitest";

import {
  ASPECT_DIMENSIONS,
  SCENE_NARRATION_TAIL_SECONDS,
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

describe("fitting the plan to narration", () => {
  const scenes = [
    scene({ id: "a", position: 1, estimatedSeconds: 4 }),
    scene({ id: "b", position: 2, estimatedSeconds: 6 }),
  ];

  it("holds the last scene when the narration outlasts the scene plan", () => {
    const plan = buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 15 });

    expect(plan.totalSeconds).toBe(15);
    // Only the final scene stretches; earlier cuts keep their timing.
    expect(plan.segments.map((s) => s.durationSeconds)).toEqual([4, 11]);
    expect(plan.segments.map((s) => s.startSeconds)).toEqual([0, 4]);
  });

  it("marks a stretched final scene as estimated", () => {
    const plan = buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 15 });
    expect(plan.segments.at(-1)!.durationIsEstimated).toBe(true);
  });

  it("leaves the plan alone when the narration is shorter", () => {
    const plan = buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 6 });
    expect(plan.totalSeconds).toBe(10);
    expect(plan.segments.map((s) => s.durationSeconds)).toEqual([4, 6]);
  });

  it("records the narration length it was fitted to", () => {
    expect(buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 20 }).narrationSeconds)
      .toBe(20);
    expect(buildRenderPlan(scenes, { aspectRatio: "16:9" }).narrationSeconds).toBeNull();
  });

  it("ignores an unreadable narration duration rather than producing NaN", () => {
    const plan = buildRenderPlan(scenes, {
      aspectRatio: "16:9",
      narrationSeconds: Number.NaN,
    });
    expect(plan.totalSeconds).toBe(10);
  });

  it("warns when narration runs well past the scene plan", () => {
    const plan = buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 40 });
    const decision = assessRender(
      { sceneCount: 2, scenesWithoutDuration: 0, targetWindow: null, plannedSceneSeconds: 10 },
      plan,
    );

    expect(decision.canRender).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/longer than the scene plan/i);
  });

  it("warns when the film would end in silence", () => {
    const plan = buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 2 });
    const decision = assessRender(
      { sceneCount: 2, scenesWithoutDuration: 0, targetWindow: null, plannedSceneSeconds: 10 },
      plan,
    );

    expect(decision.warnings.join(" ")).toMatch(/ends in silence/i);
  });

  it("stays silent when narration and scene plan are close enough", () => {
    const plan = buildRenderPlan(scenes, { aspectRatio: "16:9", narrationSeconds: 12 });
    const decision = assessRender(
      { sceneCount: 2, scenesWithoutDuration: 0, targetWindow: null, plannedSceneSeconds: 10 },
      plan,
    );

    expect(decision.warnings).toEqual([]);
  });
});

describe("per-scene narration", () => {
  function withNarration(seconds: number | null, estimated: number | null, id = "a") {
    return scene({ id, position: 1, estimatedSeconds: estimated, narrationSeconds: seconds, narrationKey: seconds === null ? null : `k-${id}` });
  }

  it("times a scene to its own line plus a tail", () => {
    const plan = buildRenderPlan([withNarration(9, 4)], { aspectRatio: "16:9" });
    expect(plan.segments[0]!.durationSeconds).toBe(9 + SCENE_NARRATION_TAIL_SECONDS);
  });

  it("keeps the planned length when it already exceeds the line", () => {
    // The estimate is a floor: a short line on a scene meant to breathe still
    // gets the length someone deliberately planned for it.
    const plan = buildRenderPlan([withNarration(3, 12)], { aspectRatio: "16:9" });
    expect(plan.segments[0]!.durationSeconds).toBe(12);
  });

  it("carries each scene's narration key onto its segment", () => {
    const plan = buildRenderPlan(
      [withNarration(5, 4, "a"), scene({ id: "b", position: 2, estimatedSeconds: 3 })],
      { aspectRatio: "16:9" },
    );
    expect(plan.segments.map((s) => s.narrationKey)).toEqual(["k-a", null]);
  });

  it("lays scenes end to end using their fitted durations", () => {
    const plan = buildRenderPlan(
      [withNarration(6, 2, "a"), { ...withNarration(4, 2, "b"), position: 2 }],
      { aspectRatio: "16:9" },
    );
    expect(plan.segments.map((s) => s.startSeconds)).toEqual([0, 6.4]);
    expect(plan.totalSeconds).toBe(10.8);
  });

  it("does not also stretch the last scene for an episode recording", () => {
    // Per-scene wins. Stretching on top of it would just add dead air.
    const plan = buildRenderPlan([withNarration(6, 2)], {
      aspectRatio: "16:9",
      narrationSeconds: 60,
    });
    expect(plan.totalSeconds).toBe(6.4);
    expect(plan.narrationSeconds).toBeNull();
  });

  it("warns that an episode recording is ignored when scenes have their own", () => {
    const plan = buildRenderPlan([withNarration(6, 2)], { aspectRatio: "16:9" });
    const decision = assessRender(
      { sceneCount: 1, scenesWithoutDuration: 0, targetWindow: null, perSceneNarrationCount: 1, hasEpisodeNarration: true },
      plan,
    );
    expect(decision.canRender).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/whole-episode recording is not used/i);
  });

  it("warns about scenes left silent in per-scene mode", () => {
    const plan = buildRenderPlan([withNarration(6, 2)], { aspectRatio: "16:9" });
    const decision = assessRender(
      { sceneCount: 4, scenesWithoutDuration: 0, targetWindow: null, perSceneNarrationCount: 1 },
      plan,
    );
    expect(decision.warnings.join(" ")).toMatch(/3 scene\(s\) have no narration/i);
  });

  it("stays silent when every scene is covered", () => {
    const plan = buildRenderPlan([withNarration(6, 2)], { aspectRatio: "16:9" });
    const decision = assessRender(
      { sceneCount: 1, scenesWithoutDuration: 0, targetWindow: null, perSceneNarrationCount: 1 },
      plan,
    );
    expect(decision.warnings).toEqual([]);
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
