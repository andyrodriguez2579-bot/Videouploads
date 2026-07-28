"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge } from "@/components/ui";
import type { ReviewStatus } from "@/domain/types";
import { availableActions, TRANSITION_LABELS, type EpisodeReadiness } from "@/domain/workflow";
import type { ActionState } from "@/lib/action-state";

import { transitionEpisodeAction } from "../actions";

const APPROVAL_ACTIONS = ["approve", "reject", "schedule", "mark_published"];

function ActionButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={danger ? "btn-danger" : "btn-secondary"} disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={ok ? "text-emerald-700" : "text-amber-700"}>
        {ok ? "✓" : "•"}
      </span>
      <span className={ok ? "text-black/70" : "font-medium"}>
        {children}
        <span className="sr-only">{ok ? " — done" : " — outstanding"}</span>
      </span>
    </li>
  );
}

export function WorkflowPanel({
  episodeId,
  status,
  readiness,
  canApprove,
  approvedVersionNumber,
  approvedAt,
}: {
  episodeId: string;
  status: ReviewStatus;
  readiness: EpisodeReadiness;
  canApprove: boolean;
  approvedVersionNumber: number | null;
  approvedAt: string | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(transitionEpisodeAction, {});
  const actions = availableActions(status);

  const { plannedSeconds, targetMinSeconds, targetMaxSeconds } = readiness;
  const hasTarget = targetMinSeconds != null && targetMaxSeconds != null;
  const inWindow =
    hasTarget && plannedSeconds >= targetMinSeconds! && plannedSeconds <= targetMaxSeconds!;

  const formatSeconds = (total: number) => {
    const rounded = Math.round(total);
    const minutes = Math.floor(rounded / 60);
    return minutes > 0 ? `${minutes}m ${rounded % 60}s` : `${rounded}s`;
  };

  return (
    <div className="space-y-4">
      <section className="card">
        <h2 className="mb-3 font-serif text-lg font-semibold">Readiness</h2>
        <ul className="space-y-1.5 text-sm">
          <Check ok={readiness.hasScript && readiness.wordCount > 0}>
            Script saved ({readiness.wordCount} words)
          </Check>
          <Check ok={readiness.sceneCount > 0}>Scene plan ({readiness.sceneCount} scenes)</Check>
          <Check ok={readiness.verifiedSourceCount > 0}>
            At least one verified source ({readiness.verifiedSourceCount} verified)
          </Check>
          <Check ok={readiness.unclearedAssetCount === 0}>
            All assets licence-cleared
            {readiness.unclearedAssetCount > 0 ? ` (${readiness.unclearedAssetCount} outstanding)` : ""}
          </Check>
          <Check ok={readiness.unreviewedAiSceneCount === 0}>
            AI suggestions reviewed
            {readiness.unreviewedAiSceneCount > 0
              ? ` (${readiness.unreviewedAiSceneCount} outstanding)`
              : ""}
          </Check>
        </ul>

        {hasTarget ? (
          <div className="mt-3 rounded-md bg-black/[0.03] p-2.5 text-sm">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-black/60">Planned runtime</span>
              <span className="font-semibold tabular-nums">{formatSeconds(plannedSeconds)}</span>
            </p>
            <p className="mt-0.5 text-xs text-black/60">
              Target {formatSeconds(targetMinSeconds!)}–{formatSeconds(targetMaxSeconds!)}
              {plannedSeconds === 0 ? " · no scene timings entered yet" : ""}
            </p>
            {plannedSeconds > 0 && !inWindow ? (
              <p className="mt-1 text-xs font-medium text-amber-800">
                Outside the target window — a warning, not a blocker.
              </p>
            ) : null}
          </div>
        ) : null}

        {readiness.unresolvedSourceCount > 0 ? (
          <p className="mt-3 text-xs text-amber-800">
            {readiness.unresolvedSourceCount} source(s) still unverified or disputed — allowed, but
            they will be labelled as such.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="mb-1 font-serif text-lg font-semibold">Review workflow</h2>
        <p className="mb-3 text-xs text-black/60">
          Nothing renders for publication or uploads anywhere until a human approves it here.
        </p>

        {approvedVersionNumber ? (
          <div className="mb-3">
            <Badge tone="good">
              Approved: script version {approvedVersionNumber}
              {approvedAt ? ` · ${new Date(approvedAt).toLocaleDateString()}` : ""}
            </Badge>
          </div>
        ) : null}

        {state.error ? (
          <div className="mb-3">
            <Alert tone="error" title={state.error} items={state.blocked} />
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="mb-3">
            <Alert tone="success" title={state.message} items={state.warnings} />
          </div>
        ) : null}

        <div className="space-y-2">
          {actions.map((transitionAction) => {
            const needsApproval = APPROVAL_ACTIONS.includes(transitionAction);
            const blockedByRole = needsApproval && !canApprove;
            const destructive = transitionAction === "reject" || transitionAction === "mark_failed";

            return (
              <form key={transitionAction} action={action} className="space-y-2">
                <input type="hidden" name="episodeId" value={episodeId} />
                <input type="hidden" name="action" value={transitionAction} />

                {transitionAction === "reject" ? (
                  <>
                    <label className="label text-xs" htmlFor="reason">
                      Reason (required to reject)
                    </label>
                    <textarea id="reason" name="reason" rows={2} className="input text-sm" />
                    {state.fields?.reason ? (
                      <p className="text-xs font-medium text-red-800">{state.fields.reason}</p>
                    ) : null}
                  </>
                ) : null}

                {blockedByRole ? (
                  <p className="text-xs text-black/50">
                    {TRANSITION_LABELS[transitionAction]} — needs an owner or reviewer.
                  </p>
                ) : (
                  <ActionButton label={TRANSITION_LABELS[transitionAction]} danger={destructive} />
                )}
              </form>
            );
          })}

          {actions.length === 0 ? (
            <p className="text-sm text-black/60">No workflow actions available from this status.</p>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-2 font-serif text-base font-semibold">Next milestones</h2>
        <ul className="space-y-1 text-xs text-black/60">
          <li>M2 — Remotion + FFmpeg render pipeline, local sample render.</li>
          <li>M3 — Optional AI providers behind the same interfaces.</li>
          <li>M4 — YouTube publishing (mocked adapters until connected).</li>
        </ul>
      </section>
    </div>
  );
}
