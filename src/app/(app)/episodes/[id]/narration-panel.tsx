"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, Field } from "@/components/ui";
import { formatSeconds } from "@/domain/render";
import type { ActionState } from "@/lib/action-state";

import {
  deleteNarrationAction,
  selectNarrationAction,
  uploadNarrationAction,
} from "./narration-actions";

export interface SceneNarrationRow {
  sceneId: string;
  position: number;
  heading: string;
  /** Planned length, so an over-long line is visible before rendering. */
  estimatedSeconds: string | null;
  voiceover: VoiceoverRow | null;
}

export interface VoiceoverRow {
  id: string;
  sceneId: string | null;
  source: string;
  provider: string | null;
  objectKey: string | null;
  durationSeconds: string | null;
  loudnessLufs: string | null;
  status: string;
  isSelected: boolean;
}

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}

export function NarrationPanel({
  episodeId,
  voiceovers,
  scenes,
}: {
  episodeId: string;
  voiceovers: VoiceoverRow[];
  scenes: SceneNarrationRow[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(uploadNarrationAction, {});
  const episodeTakes = voiceovers.filter((v) => v.sceneId === null);
  const selected = episodeTakes.find((v) => v.isSelected);

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Narration</h2>
      <p className="mb-4 text-xs text-black/60">
        Upload a recording and the next render lays it under the picture, normalised to −14 LUFS
        so YouTube leaves the mix alone. If the narration outlasts the scene plan the last scene
        is held rather than cutting a word off.
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

      <form action={action} className="mb-6 space-y-3">
        <input type="hidden" name="episodeId" value={episodeId} />
        <Field
          label="Audio file"
          name="file"
          error={state.fields?.file}
          hint="mp3, m4a, aac, wav, flac, ogg or opus."
        >
          <input id="file" name="file" type="file" accept="audio/*" required className="input" />
        </Field>
        <Submit idle="Upload narration" busy="Uploading…" />
      </form>

      {episodeTakes.length === 0 ? (
        <p className="text-sm text-black/60">
          No narration yet. Renders will be silent until one is uploaded.
        </p>
      ) : (
        <ul className="divide-y divide-black/10">
          {episodeTakes.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              {row.isSelected ? <Badge tone="good">Selected</Badge> : <Badge>Not used</Badge>}
              <span className="text-black/70">{row.source.replace("_", " ")}</span>
              <span className="tabular-nums text-black/70">
                {row.durationSeconds ? formatSeconds(Number(row.durationSeconds)) : "—"}
              </span>
              {row.loudnessLufs ? (
                <span className="tabular-nums text-black/60">{row.loudnessLufs} LUFS</span>
              ) : null}

              {row.objectKey ? (
                <a
                  className="link"
                  href={`/api/files/${row.objectKey}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Listen
                </a>
              ) : null}

              {!row.isSelected ? (
                <form action={selectNarrationAction}>
                  <input type="hidden" name="episodeId" value={episodeId} />
                  <input type="hidden" name="voiceoverId" value={row.id} />
                  <button type="submit" className="btn-secondary text-xs">
                    Use this one
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-1 mt-8 font-serif text-base font-semibold">Per scene</h3>
      <p className="mb-3 text-xs text-black/60">
        Record scene by scene and a fluffed line means re-recording that scene, not the
        episode. Any scene with its own narration takes precedence: the whole-episode
        recording above is then ignored, and each scene is timed to its own line.
      </p>

      {scenes.length === 0 ? (
        <p className="text-sm text-black/60">Add scenes first, on the Scene plan tab.</p>
      ) : (
        <ul className="divide-y divide-black/10">
          {scenes.map((scene) => (
            <li key={scene.sceneId} className="py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="tabular-nums text-black/50">{scene.position}</span>
                <span className="font-medium">{scene.heading}</span>
                {scene.voiceover ? (
                  <>
                    <Badge tone="good">Recorded</Badge>
                    <span className="tabular-nums text-black/70">
                      {scene.voiceover.durationSeconds
                        ? formatSeconds(Number(scene.voiceover.durationSeconds))
                        : "—"}
                    </span>
                    {scene.voiceover.objectKey ? (
                      <a
                        className="link"
                        href={`/api/files/${scene.voiceover.objectKey}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Listen
                      </a>
                    ) : null}
                    <form action={deleteNarrationAction}>
                      <input type="hidden" name="episodeId" value={episodeId} />
                      <input type="hidden" name="voiceoverId" value={scene.voiceover.id} />
                      <button type="submit" className="btn-secondary text-xs">
                        Remove
                      </button>
                    </form>
                  </>
                ) : (
                  <Badge>Silent</Badge>
                )}
              </div>

              <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="episodeId" value={episodeId} />
                <input type="hidden" name="sceneId" value={scene.sceneId} />
                <input
                  id={`scene-file-${scene.sceneId}`}
                  name="file"
                  type="file"
                  accept="audio/*"
                  required
                  className="input max-w-xs text-xs"
                  aria-label={`Narration for scene ${scene.position}: ${scene.heading}`}
                />
                <Submit
                  idle={scene.voiceover ? "Replace" : "Upload"}
                  busy="Uploading…"
                />
              </form>
            </li>
          ))}
        </ul>
      )}

      {selected && !selected.durationSeconds ? (
        <div className="mt-4">
          <Alert
            tone="warning"
            title="This file's duration could not be read, so the scene plan was not fitted to it. The render may end before the narration does."
          />
        </div>
      ) : null}
    </section>
  );
}
