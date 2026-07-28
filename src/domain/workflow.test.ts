import { describe, expect, it } from "vitest";

import {
  availableActions,
  canEnterPublishingPipeline,
  evaluateTransition,
  type EpisodeReadiness,
} from "./workflow";

const ready: EpisodeReadiness = {
  hasScript: true,
  wordCount: 1200,
  sceneCount: 8,
  verifiedSourceCount: 3,
  unresolvedSourceCount: 0,
  unclearedAssetCount: 0,
  unreviewedAiSceneCount: 0,
  hasApprovedVersion: false,
};

describe("evaluateTransition", () => {
  it("moves a complete draft into review", () => {
    const result = evaluateTransition("draft", "submit_for_review", ready);
    expect(result.allowed).toBe(true);
    expect(result.to).toBe("in_review");
  });

  it("refuses to submit an empty script", () => {
    const result = evaluateTransition("draft", "submit_for_review", {
      ...ready,
      hasScript: false,
      wordCount: 0,
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(" ")).toContain("script");
  });

  it("refuses to submit with no scenes", () => {
    const result = evaluateTransition("draft", "submit_for_review", { ...ready, sceneCount: 0 });
    expect(result.allowed).toBe(false);
  });

  it("rejects an action that is not legal from the current status", () => {
    const result = evaluateTransition("draft", "approve", ready);
    expect(result.allowed).toBe(false);
    expect(result.errors[0]).toContain("not available from status");
  });

  it("approves a fully prepared episode", () => {
    const result = evaluateTransition("in_review", "approve", ready);
    expect(result.allowed).toBe(true);
    expect(result.to).toBe("approved");
  });

  it("blocks approval when no source is verified", () => {
    const result = evaluateTransition("in_review", "approve", { ...ready, verifiedSourceCount: 0 });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(" ")).toContain("verified");
  });

  it("blocks approval when an attached asset has no cleared licence", () => {
    const result = evaluateTransition("in_review", "approve", { ...ready, unclearedAssetCount: 2 });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(" ")).toContain("licence");
  });

  it("blocks approval while AI-suggested scenes are unreviewed", () => {
    const result = evaluateTransition("in_review", "approve", {
      ...ready,
      unreviewedAiSceneCount: 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(" ")).toContain("AI-suggested");
  });

  it("warns but does not block when sources are still unverified", () => {
    const result = evaluateTransition("in_review", "approve", {
      ...ready,
      unresolvedSourceCount: 2,
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings.join(" ")).toContain("unverified");
  });

  it("only allows scheduling from approved with a recorded approval", () => {
    expect(evaluateTransition("draft", "schedule", ready).allowed).toBe(false);
    expect(evaluateTransition("in_review", "schedule", ready).allowed).toBe(false);
    expect(evaluateTransition("approved", "schedule", ready).allowed).toBe(false);
    expect(
      evaluateTransition("approved", "schedule", { ...ready, hasApprovedVersion: true }).allowed,
    ).toBe(true);
  });

  it("allows publishing only from scheduled", () => {
    expect(evaluateTransition("approved", "mark_published", ready).allowed).toBe(false);
    expect(evaluateTransition("scheduled", "mark_published", ready).allowed).toBe(true);
  });

  it("lets a rejected episode be resubmitted", () => {
    expect(evaluateTransition("rejected", "submit_for_review", ready).allowed).toBe(true);
  });
});

describe("availableActions", () => {
  it("offers nothing terminal from published except failure", () => {
    expect(availableActions("published")).toEqual(["mark_failed"]);
  });

  it("offers review actions from in_review", () => {
    expect(availableActions("in_review").sort()).toEqual(
      ["approve", "reject", "request_changes"].sort(),
    );
  });
});

describe("canEnterPublishingPipeline", () => {
  it("is false for every status without a human approval", () => {
    for (const status of ["draft", "in_review", "approved", "rejected", "scheduled", "published", "failed"] as const) {
      expect(canEnterPublishingPipeline(status, false)).toBe(false);
    }
  });

  it("is true only for approved and scheduled with an approval on record", () => {
    expect(canEnterPublishingPipeline("approved", true)).toBe(true);
    expect(canEnterPublishingPipeline("scheduled", true)).toBe(true);
    expect(canEnterPublishingPipeline("draft", true)).toBe(false);
    expect(canEnterPublishingPipeline("in_review", true)).toBe(false);
  });
});
