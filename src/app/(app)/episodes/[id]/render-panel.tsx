"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

import { Alert, Badge, Field } from "@/components/ui";
import { ASPECT_RATIOS, formatSeconds } from "@/domain/render";
import type { ActionState } from "@/lib/action-state";

import { startRenderAction } from "../../renders/actions";

const ASPECT_LABELS: Record<string, string> = {
  "16:9": "16:9 — long form (YouTube)",
  "9:16": "9:16 — vertical short",
};

export interface RenderRow {
  id: string;
  kind: string;
  aspectRatio: string;
  status: string;
  objectKey: string | null;
  durationSeconds: string | null;
  byteSize: number | null;
  errorMessage: string | null;
  progress: number | null;
  stage: string | null;
}

function Submit({ idle, busy, disabled }: { idle: string; busy: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending || disabled}>
      {pending ? busy : idle}
    </button>
  );
}

function isActive(row: RenderRow): boolean {
  return row.status === "queued" || row.status === "running" || row.status === "pending";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RenderPanel({
  episodeId,
  renders,
  plannedSeconds,
  sceneCount,
  canRender,
  blockers,
  warnings,
}: {
  episodeId: string;
  renders: RenderRow[];
  plannedSeconds: number;
  sceneCount: number;
  canRender: boolean;
  blockers: string[];
  warnings: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(startRenderAction, {});
  const router = useRouter();

  // Encoding happens outside the request, so the only way the page learns a
  // render finished is to ask again. Polling stops as soon as nothing is
  // running, rather than refreshing this route forever.
  const hasActive = renders.some(isActive);
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [hasActive, router]);

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Render</h2>
      <p className="mb-4 text-xs text-black/60">
        Builds an MP4 from the scene plan on this machine — no external service, no account.
        Rendering a draft is deliberately allowed: you need to watch a cut before you can
        sensibly approve it.
      </p>

      {state.error ? (
        <div className="mb-4">
          <Alert tone="error" title={state.error} />
        </div>
      ) : null}
      {state.ok && state.message ? (
        <div className="mb-4">
          <Alert tone="success" title={state.message} />
        </div>
      ) : null}

      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-black/60">Scenes</dt>
          <dd className="font-medium tabular-nums">{sceneCount}</dd>
        </div>
        <div>
          <dt className="text-black/60">Planned runtime</dt>
          <dd className="font-medium tabular-nums">{formatSeconds(plannedSeconds)}</dd>
        </div>
      </dl>

      {blockers.length > 0 ? (
        <div className="mb-4">
          <Alert tone="error" title="This episode cannot be rendered yet." items={blockers} />
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="mb-4">
          <Alert tone="warning" title="Worth knowing before you watch it" items={warnings} />
        </div>
      ) : null}

      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="episodeId" value={episodeId} />
        <div className="min-w-[16rem] flex-1">
          <Field label="Aspect ratio" name="aspectRatio" error={state.fields?.aspectRatio}>
            <select id="aspectRatio" name="aspectRatio" className="input" defaultValue="16:9">
              {ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ASPECT_LABELS[ratio] ?? ratio}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Submit idle="Start render" busy="Starting…" disabled={!canRender} />
      </form>

      <h3 className="mb-2 mt-6 font-serif text-base font-semibold">Renders</h3>
      {renders.length === 0 ? (
        <p className="text-sm text-black/60">Nothing rendered yet.</p>
      ) : (
        <ul className="divide-y divide-black/10">
          {renders.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Badge tone={row.status === "failed" ? "bad" : row.status === "succeeded" ? "good" : "neutral"}>
                {row.status}
              </Badge>
              <span className="tabular-nums text-black/70">{row.aspectRatio}</span>
              <span className="text-black/70">
                {row.durationSeconds ? formatSeconds(Number(row.durationSeconds)) : "—"}
              </span>
              <span className="tabular-nums text-black/60">{formatBytes(row.byteSize)}</span>

              {isActive(row) ? (
                <span className="flex items-center gap-2 text-black/70">
                  <progress
                    className="h-2 w-32"
                    value={row.progress ?? 0}
                    max={100}
                    aria-label="Render progress"
                  />
                  <span className="tabular-nums">{row.progress ?? 0}%</span>
                  {row.stage ? <span className="text-xs">{row.stage}</span> : null}
                </span>
              ) : null}

              {row.status === "succeeded" && row.objectKey ? (
                <a
                  className="link"
                  href={`/api/files/${row.objectKey}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Watch
                </a>
              ) : null}

              {row.errorMessage ? (
                <span className="w-full text-xs text-red-800">{row.errorMessage}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
