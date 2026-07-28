"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, Field } from "@/components/ui";

import type { ActionState } from "@/lib/action-state";

import { restoreVersionAction, saveScriptAction } from "../actions";

interface LatestVersion {
  id: string;
  versionNumber: number;
  scriptBody: string;
  scriptFormat: "markdown" | "plaintext";
  wordCount: number;
  contentHash: string;
  authorship: string;
  createdAt: string;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  wordCount: number;
  authorship: string;
  changeNote: string | null;
  createdAt: string;
  isApproved: boolean;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ScriptTab({
  episodeId,
  title,
  latestVersion,
  versions,
  locked,
}: {
  episodeId: string;
  title: string;
  latestVersion: LatestVersion | null;
  versions: VersionRow[];
  locked: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveScriptAction, {});

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">Script</h2>
          <div className="flex flex-wrap gap-1.5">
            {latestVersion ? (
              <>
                <Badge tone="info">Version {latestVersion.versionNumber}</Badge>
                <Badge>{latestVersion.wordCount} words</Badge>
                {latestVersion.authorship !== "human" ? (
                  <Badge tone="warn">AI-assisted — needs human approval</Badge>
                ) : (
                  <Badge tone="good">Human-written</Badge>
                )}
              </>
            ) : (
              <Badge tone="warn">No script yet</Badge>
            )}
          </div>
        </div>

        {locked ? (
          <div className="mb-4">
            <Alert
              tone="info"
              title="This episode is published — the script is locked."
              items={["Use “Reopen as draft” in the workflow panel to make changes."]}
            />
          </div>
        ) : null}

        {state.error ? (
          <div className="mb-4">
            <Alert tone="error" title={state.error} />
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="mb-4">
            <Alert tone="success" title={state.message} items={state.warnings} />
          </div>
        ) : null}

        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="episodeId" value={episodeId} />

          <Field label="Episode title" name="title" error={state.fields?.title}>
            <input id="title" name="title" defaultValue={title} className="input" disabled={locked} />
          </Field>

          <Field
            label="Script"
            name="scriptBody"
            error={state.fields?.scriptBody}
            hint="Markdown. Saving creates a new immutable version — earlier versions are never overwritten."
          >
            <textarea
              id="scriptBody"
              name="scriptBody"
              rows={24}
              required
              disabled={locked}
              defaultValue={latestVersion?.scriptBody ?? ""}
              className="input font-mono text-[13px] leading-relaxed"
            />
          </Field>

          <Field
            label="What changed?"
            name="changeNote"
            error={state.fields?.changeNote}
            hint="Optional note stored with this version."
          >
            <input id="changeNote" name="changeNote" className="input" disabled={locked} />
          </Field>

          <input type="hidden" name="scriptFormat" value="markdown" />

          {!locked ? <Submit label="Save new version" /> : null}
        </form>
      </section>

      <section className="card">
        <h2 className="mb-3 font-serif text-lg font-semibold">Version history</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-black/60">No versions saved yet.</p>
        ) : (
          <ul className="divide-y divide-black/10 text-sm">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-medium">
                    Version {version.versionNumber}{" "}
                    {version.isApproved ? <Badge tone="good">Approved</Badge> : null}{" "}
                    {version.authorship !== "human" ? <Badge tone="warn">AI draft</Badge> : null}
                  </p>
                  <p className="text-xs text-black/50">
                    {version.wordCount} words ·{" "}
                    <time dateTime={version.createdAt}>
                      {new Date(version.createdAt).toLocaleString()}
                    </time>
                    {version.changeNote ? ` · ${version.changeNote}` : ""}
                  </p>
                </div>
                {!locked && version.versionNumber !== versions[0]?.versionNumber ? (
                  <form action={restoreVersionAction}>
                    <input type="hidden" name="episodeId" value={episodeId} />
                    <input type="hidden" name="versionId" value={version.id} />
                    <button type="submit" className="btn-secondary text-xs">
                      Restore as new version
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
