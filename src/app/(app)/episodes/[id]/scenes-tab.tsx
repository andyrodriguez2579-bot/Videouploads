"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, EmptyState, Field } from "@/components/ui";
import { SCENE_TEMPLATES, SCENE_TEMPLATE_LABELS, type SceneTemplate } from "@/domain/types";

import type { ActionState } from "@/lib/action-state";

import {
  addSceneAction,
  deleteSceneAction,
  linkSceneAssetAction,
  linkSceneSourceAction,
  markSceneReviewedAction,
  moveSceneAction,
  unlinkSceneAssetAction,
  updateSceneAction,
} from "../actions";

interface SceneRow {
  id: string;
  position: number;
  heading: string;
  narrationText: string | null;
  onScreenText: string | null;
  visualDirection: string | null;
  template: SceneTemplate;
  estimatedSeconds: string | null;
  notes: string | null;
  isAiSuggested: boolean;
  aiProvider: string | null;
  humanReviewed: boolean;
  assetCount: number;
  sourceCount: number;
}

interface Props {
  episodeId: string;
  scenes: SceneRow[];
  availableAssets: { id: string; title: string; kind: string; cleared: boolean }[];
  availableSources: { id: string; citation: string; verification: string }[];
  sceneAssetLinks: { id: string; sceneId: string; assetTitle: string }[];
  sceneSourceLinks: { id: string; sceneId: string; citation: string }[];
}

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}

function SceneEditor({
  episodeId,
  scene,
  onDone,
}: {
  episodeId: string;
  scene: SceneRow;
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateSceneAction, {});

  return (
    <form action={action} className="mt-3 space-y-3 rounded-md bg-black/[0.03] p-3" noValidate>
      <input type="hidden" name="episodeId" value={episodeId} />
      <input type="hidden" name="sceneId" value={scene.id} />

      {state.error ? <Alert tone="error" title={state.error} /> : null}
      {state.ok && state.message ? <Alert tone="success" title={state.message} /> : null}

      <Field label="Heading" name={`heading-${scene.id}`} error={state.fields?.heading}>
        <input id={`heading-${scene.id}`} name="heading" defaultValue={scene.heading} className="input" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template" name={`template-${scene.id}`}>
          <select
            id={`template-${scene.id}`}
            name="template"
            defaultValue={scene.template}
            className="input"
          >
            {SCENE_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {SCENE_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estimated seconds" name={`estimatedSeconds-${scene.id}`}>
          <input
            id={`estimatedSeconds-${scene.id}`}
            name="estimatedSeconds"
            type="number"
            step="0.5"
            defaultValue={scene.estimatedSeconds ?? ""}
            className="input"
          />
        </Field>
      </div>

      <Field label="Narration" name={`narrationText-${scene.id}`}>
        <textarea
          id={`narrationText-${scene.id}`}
          name="narrationText"
          rows={4}
          defaultValue={scene.narrationText ?? ""}
          className="input"
        />
      </Field>

      <Field label="On-screen text" name={`onScreenText-${scene.id}`}>
        <input
          id={`onScreenText-${scene.id}`}
          name="onScreenText"
          defaultValue={scene.onScreenText ?? ""}
          className="input"
        />
      </Field>

      <Field label="Visual direction" name={`visualDirection-${scene.id}`}>
        <textarea
          id={`visualDirection-${scene.id}`}
          name="visualDirection"
          rows={2}
          defaultValue={scene.visualDirection ?? ""}
          className="input"
        />
      </Field>

      <div className="flex gap-2">
        <Submit idle="Save scene" busy="Saving…" />
        <button type="button" className="btn-secondary" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

export function ScenesTab({
  episodeId,
  scenes,
  availableAssets,
  availableSources,
  sceneAssetLinks,
  sceneSourceLinks,
}: Props) {
  const [addState, addAction] = useActionState<ActionState, FormData>(addSceneAction, {});
  const [editingId, setEditingId] = useState<string | null>(null);

  const totalSeconds = scenes.reduce((sum, s) => sum + Number(s.estimatedSeconds ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">Scene plan</h2>
          <div className="flex gap-1.5">
            <Badge>{scenes.length} scenes</Badge>
            <Badge>
              ≈ {Math.floor(totalSeconds / 60)}m {Math.round(totalSeconds % 60)}s
            </Badge>
          </div>
        </div>

        {scenes.length === 0 ? (
          <EmptyState
            title="No scenes yet"
            description="Break the script into scenes below. Each scene maps to one Remotion template at render time."
          />
        ) : (
          <ol className="space-y-3">
            {scenes.map((scene, index) => {
              const assets = sceneAssetLinks.filter((l) => l.sceneId === scene.id);
              const sources = sceneSourceLinks.filter((l) => l.sceneId === scene.id);
              const unsourced = sources.length === 0;

              return (
                <li key={scene.id} className="rounded-md border border-black/10 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="mr-2 tabular-nums text-black/40">{scene.position}.</span>
                        {scene.heading}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="info">{SCENE_TEMPLATE_LABELS[scene.template]}</Badge>
                        {scene.estimatedSeconds ? <Badge>{scene.estimatedSeconds}s</Badge> : null}
                        <Badge tone={scene.assetCount > 0 ? "neutral" : "warn"}>
                          {scene.assetCount} assets
                        </Badge>
                        <Badge tone={unsourced ? "warn" : "good"}>
                          {unsourced ? "No citation" : `${sources.length} cited`}
                        </Badge>
                        {scene.isAiSuggested && !scene.humanReviewed ? (
                          <Badge tone="warn">
                            AI draft — unreviewed{scene.aiProvider ? ` · ${scene.aiProvider}` : ""}
                          </Badge>
                        ) : null}
                      </div>
                      {scene.narrationText ? (
                        <p className="mt-2 line-clamp-3 text-sm text-black/70">{scene.narrationText}</p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-1">
                      <form action={moveSceneAction}>
                        <input type="hidden" name="episodeId" value={episodeId} />
                        <input type="hidden" name="sceneId" value={scene.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          className="btn-secondary py-1 text-xs"
                          disabled={index === 0}
                          aria-label={`Move "${scene.heading}" earlier`}
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moveSceneAction}>
                        <input type="hidden" name="episodeId" value={episodeId} />
                        <input type="hidden" name="sceneId" value={scene.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          className="btn-secondary py-1 text-xs"
                          disabled={index === scenes.length - 1}
                          aria-label={`Move "${scene.heading}" later`}
                        >
                          ↓
                        </button>
                      </form>
                      <button
                        type="button"
                        className="btn-secondary py-1 text-xs"
                        aria-expanded={editingId === scene.id}
                        onClick={() => setEditingId(editingId === scene.id ? null : scene.id)}
                      >
                        {editingId === scene.id ? "Close" : "Edit"}
                      </button>
                      <form action={deleteSceneAction}>
                        <input type="hidden" name="episodeId" value={episodeId} />
                        <input type="hidden" name="sceneId" value={scene.id} />
                        <button type="submit" className="btn-danger py-1 text-xs">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>

                  {scene.isAiSuggested && !scene.humanReviewed ? (
                    <form action={markSceneReviewedAction} className="mt-2">
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="sceneId" value={scene.id} />
                      <button type="submit" className="btn-secondary py-1 text-xs">
                        I have reviewed this AI suggestion
                      </button>
                    </form>
                  ) : null}

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-black/60">Assets</p>
                      {assets.length > 0 ? (
                        <ul className="mt-1 space-y-1">
                          {assets.map((link) => (
                            <li key={link.id} className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate">{link.assetTitle}</span>
                              <form action={unlinkSceneAssetAction}>
                                <input type="hidden" name="episodeId" value={episodeId} />
                                <input type="hidden" name="linkId" value={link.id} />
                                <button type="submit" className="link text-xs">
                                  Remove
                                </button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-black/50">None attached.</p>
                      )}

                      {availableAssets.length > 0 ? (
                        <form action={linkSceneAssetAction} className="mt-2 flex gap-1">
                          <input type="hidden" name="episodeId" value={episodeId} />
                          <input type="hidden" name="sceneId" value={scene.id} />
                          <label className="sr-only" htmlFor={`asset-${scene.id}`}>
                            Attach asset to scene {scene.position}
                          </label>
                          <select id={`asset-${scene.id}`} name="assetId" className="input py-1 text-xs">
                            <option value="">Attach an asset…</option>
                            {availableAssets.map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.title} ({asset.kind}){asset.cleared ? "" : " — licence not cleared"}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn-secondary py-1 text-xs">
                            Add
                          </button>
                        </form>
                      ) : (
                        <p className="mt-2 text-xs text-black/50">
                          Upload assets on the Assets tab first.
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-medium text-black/60">Citations</p>
                      {sources.length > 0 ? (
                        <ul className="mt-1 space-y-1 text-xs">
                          {sources.map((link) => (
                            <li key={link.id} className="truncate">
                              {link.citation}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-black/50">
                          No source cited for this scene yet.
                        </p>
                      )}

                      {availableSources.length > 0 ? (
                        <form action={linkSceneSourceAction} className="mt-2 flex gap-1">
                          <input type="hidden" name="episodeId" value={episodeId} />
                          <input type="hidden" name="sceneId" value={scene.id} />
                          <label className="sr-only" htmlFor={`source-${scene.id}`}>
                            Cite a source on scene {scene.position}
                          </label>
                          <select id={`source-${scene.id}`} name="sourceId" className="input py-1 text-xs">
                            <option value="">Cite a source…</option>
                            {availableSources.map((source) => (
                              <option key={source.id} value={source.id}>
                                {source.citation.slice(0, 70)}
                                {source.verification === "verified" ? " ✓" : ""}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn-secondary py-1 text-xs">
                            Add
                          </button>
                        </form>
                      ) : (
                        <p className="mt-2 text-xs text-black/50">Add sources on the Sources tab first.</p>
                      )}
                    </div>
                  </div>

                  {editingId === scene.id ? (
                    <SceneEditor
                      episodeId={episodeId}
                      scene={scene}
                      onDone={() => setEditingId(null)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="card">
        <h2 className="mb-4 font-serif text-lg font-semibold">Add a scene</h2>

        {addState.error ? (
          <div className="mb-4">
            <Alert tone="error" title={addState.error} />
          </div>
        ) : null}
        {addState.ok && addState.message ? (
          <div className="mb-4">
            <Alert tone="success" title={addState.message} />
          </div>
        ) : null}

        <form action={addAction} className="space-y-4" noValidate>
          <input type="hidden" name="episodeId" value={episodeId} />

          <Field label="Heading" name="heading" error={addState.fields?.heading}>
            <input id="heading" name="heading" required className="input" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template" name="template">
              <select id="template" name="template" className="input" defaultValue="archival_still">
                {SCENE_TEMPLATES.map((t) => (
                  <option key={t} value={t}>
                    {SCENE_TEMPLATE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estimated seconds" name="estimatedSeconds">
              <input id="estimatedSeconds" name="estimatedSeconds" type="number" step="0.5" className="input" />
            </Field>
          </div>

          <Field label="Narration" name="narrationText">
            <textarea id="narrationText" name="narrationText" rows={4} className="input" />
          </Field>

          <Field label="Visual direction" name="visualDirection">
            <textarea id="visualDirection" name="visualDirection" rows={2} className="input" />
          </Field>

          <Submit idle="Add scene" busy="Adding…" />
        </form>
      </section>
    </div>
  );
}
