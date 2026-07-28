/**
 * Episode review workflow.
 *
 * This module is pure — no database, no I/O — so the rules can be unit tested
 * and reused by the render worker (M2) and the publisher (M4) without dragging
 * in a connection. Every status change in the app must go through
 * `evaluateTransition`; nothing writes `episodes.status` directly.
 */
import type { ReviewStatus } from "./types";

export type TransitionAction =
  | "submit_for_review"
  | "approve"
  | "request_changes"
  | "reject"
  | "reopen"
  | "schedule"
  | "mark_published"
  | "mark_failed";

/** Which statuses each action may be applied from, and where it lands. */
const TRANSITIONS: Record<TransitionAction, { from: ReviewStatus[]; to: ReviewStatus }> = {
  submit_for_review: { from: ["draft", "rejected"], to: "in_review" },
  approve: { from: ["in_review"], to: "approved" },
  request_changes: { from: ["in_review"], to: "draft" },
  reject: { from: ["in_review", "approved", "scheduled"], to: "rejected" },
  reopen: { from: ["approved", "rejected", "failed", "scheduled"], to: "draft" },
  schedule: { from: ["approved"], to: "scheduled" },
  mark_published: { from: ["scheduled"], to: "published" },
  mark_failed: { from: ["scheduled", "published"], to: "failed" },
};

export const TRANSITION_LABELS: Record<TransitionAction, string> = {
  submit_for_review: "Submit for review",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
  reopen: "Reopen as draft",
  schedule: "Schedule",
  mark_published: "Mark published",
  mark_failed: "Mark failed",
};

/**
 * Facts about an episode that gate a transition. Assembled by the caller from
 * the database so this module stays pure.
 */
export interface EpisodeReadiness {
  hasScript: boolean;
  wordCount: number;
  sceneCount: number;
  /** Sources whose verification is 'verified'. */
  verifiedSourceCount: number;
  /** Sources still sitting at 'unverified' or flagged 'disputed'. */
  unresolvedSourceCount: number;
  /** Assets attached to this episode whose license row is missing or not cleared. */
  unclearedAssetCount: number;
  /** Scenes proposed by an AI provider that no human has ticked off yet. */
  unreviewedAiSceneCount: number;
  /** True once a human has explicitly approved a version. */
  hasApprovedVersion: boolean;
  /** Sum of the scene plan's estimated seconds. */
  plannedSeconds: number;
  /** Series duration window for this episode's format. Advisory, never blocking. */
  targetMinSeconds: number | null;
  targetMaxSeconds: number | null;
}

/** Formats a second count as "5m 20s" for reviewer-facing messages. */
function formatSeconds(total: number): string {
  const rounded = Math.round(total);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export interface TransitionResult {
  allowed: boolean;
  /** Target status when allowed. */
  to?: ReviewStatus;
  /** Hard failures — these block the transition. */
  errors: string[];
  /** Soft notes shown to the reviewer but not blocking. */
  warnings: string[];
}

/**
 * Blocking checks per action. Approval is the strict gate: everything a
 * publish would rely on has to be settled before an episode can be approved,
 * because once approved it becomes schedulable.
 */
function gateErrors(action: TransitionAction, r: EpisodeReadiness): string[] {
  const errors: string[] = [];

  if (action === "submit_for_review") {
    if (!r.hasScript || r.wordCount === 0) {
      errors.push("Add a script before submitting for review.");
    }
    if (r.sceneCount === 0) {
      errors.push("Add at least one scene before submitting for review.");
    }
  }

  if (action === "approve") {
    if (!r.hasScript || r.wordCount === 0) {
      errors.push("Cannot approve an episode with no script.");
    }
    if (r.sceneCount === 0) {
      errors.push("Cannot approve an episode with no scenes.");
    }
    if (r.verifiedSourceCount === 0) {
      errors.push("At least one research source must be marked verified before approval.");
    }
    if (r.unclearedAssetCount > 0) {
      errors.push(
        `${r.unclearedAssetCount} attached asset(s) have no cleared licence. Clear or remove them before approval.`,
      );
    }
    if (r.unreviewedAiSceneCount > 0) {
      errors.push(
        `${r.unreviewedAiSceneCount} AI-suggested scene(s) have not been reviewed by a human.`,
      );
    }
  }

  if (action === "schedule" && !r.hasApprovedVersion) {
    // Belt and braces: `schedule` is already only reachable from `approved`,
    // but scheduling without a recorded approval must never be possible.
    errors.push("Scheduling requires a human-approved script version.");
  }

  return errors;
}

function gateWarnings(action: TransitionAction, r: EpisodeReadiness): string[] {
  const warnings: string[] = [];
  if ((action === "approve" || action === "submit_for_review") && r.unresolvedSourceCount > 0) {
    warnings.push(
      `${r.unresolvedSourceCount} source(s) are still unverified or disputed. They will be shown as unverified in the credits.`,
    );
  }
  if (action === "approve" && r.wordCount < 150) {
    warnings.push("Script is unusually short for a documentary episode.");
  }

  // Runtime drift is a note, not a gate: a 6m40s episode that earns its length
  // should not be blocked, but the reviewer should see it before signing off.
  if (
    (action === "approve" || action === "submit_for_review") &&
    r.plannedSeconds > 0 &&
    r.targetMinSeconds != null &&
    r.targetMaxSeconds != null
  ) {
    if (r.plannedSeconds < r.targetMinSeconds) {
      warnings.push(
        `Scene plan runs ${formatSeconds(r.plannedSeconds)}, under the ${formatSeconds(r.targetMinSeconds)} target minimum.`,
      );
    } else if (r.plannedSeconds > r.targetMaxSeconds) {
      warnings.push(
        `Scene plan runs ${formatSeconds(r.plannedSeconds)}, over the ${formatSeconds(r.targetMaxSeconds)} target maximum.`,
      );
    }
  }

  return warnings;
}

export function evaluateTransition(
  current: ReviewStatus,
  action: TransitionAction,
  readiness: EpisodeReadiness,
): TransitionResult {
  const rule = TRANSITIONS[action];

  if (!rule.from.includes(current)) {
    return {
      allowed: false,
      errors: [`"${TRANSITION_LABELS[action]}" is not available from status "${current}".`],
      warnings: [],
    };
  }

  const errors = gateErrors(action, readiness);
  return {
    allowed: errors.length === 0,
    to: errors.length === 0 ? rule.to : undefined,
    errors,
    warnings: gateWarnings(action, readiness),
  };
}

/** Actions reachable from a status, ignoring readiness. Drives the button row. */
export function availableActions(current: ReviewStatus): TransitionAction[] {
  return (Object.keys(TRANSITIONS) as TransitionAction[]).filter((a) =>
    TRANSITIONS[a].from.includes(current),
  );
}

/**
 * The one rule the whole product hangs on: no publish path — scheduling,
 * queuing, or uploading — may run unless a human approved this episode.
 */
export function canEnterPublishingPipeline(
  status: ReviewStatus,
  hasApprovedVersion: boolean,
): boolean {
  return hasApprovedVersion && (status === "approved" || status === "scheduled");
}
