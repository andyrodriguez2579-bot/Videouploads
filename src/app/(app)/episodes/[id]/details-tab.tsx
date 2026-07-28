"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Field } from "@/components/ui";
import {
  CAPTION_MODES,
  CAPTION_MODE_LABELS,
  NARRATION_MODES,
  NARRATION_MODE_LABELS,
  PUBLISH_MODES,
  PUBLISH_MODE_LABELS,
  SCENE_PLAN_MODES,
  SCENE_PLAN_MODE_LABELS,
  type CaptionMode,
  type NarrationMode,
  type PublishMode,
  type ScenePlanMode,
} from "@/domain/types";
import type { ActionState } from "@/lib/action-state";

import { updateEpisodeAction } from "../actions";

interface EpisodeDetails {
  id: string;
  title: string;
  synopsis: string | null;
  episodeNumber: number | null;
  periodLabel: string | null;
  periodStartYear: number | null;
  periodEndYear: number | null;
  narrationMode: NarrationMode;
  captionMode: CaptionMode;
  scenePlanMode: ScenePlanMode;
  publishMode: PublishMode;
  targetDurationSeconds: number | null;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save details"}
    </button>
  );
}

export function DetailsTab({ episode }: { episode: EpisodeDetails }) {
  const [state, action] = useActionState<ActionState, FormData>(updateEpisodeAction, {});

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="id" value={episode.id} />

      {state.error ? <Alert tone="error" title={state.error} /> : null}
      {state.ok && state.message ? <Alert tone="success" title={state.message} /> : null}

      <fieldset className="card space-y-4">
        <legend className="px-1 font-serif text-lg font-semibold">Episode</legend>

        <Field label="Title" name="title" error={state.fields?.title}>
          <input id="title" name="title" defaultValue={episode.title} className="input" />
        </Field>

        <Field label="Episode number" name="episodeNumber" error={state.fields?.episodeNumber}>
          <input
            id="episodeNumber"
            name="episodeNumber"
            type="number"
            min={0}
            defaultValue={episode.episodeNumber ?? ""}
            className="input"
          />
        </Field>

        <Field label="Synopsis" name="synopsis">
          <textarea
            id="synopsis"
            name="synopsis"
            rows={3}
            defaultValue={episode.synopsis ?? ""}
            className="input"
          />
        </Field>

        <Field label="Period label" name="periodLabel">
          <input
            id="periodLabel"
            name="periodLabel"
            defaultValue={episode.periodLabel ?? ""}
            className="input"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start year" name="periodStartYear">
            <input
              id="periodStartYear"
              name="periodStartYear"
              type="number"
              defaultValue={episode.periodStartYear ?? ""}
              className="input"
            />
          </Field>
          <Field label="End year" name="periodEndYear">
            <input
              id="periodEndYear"
              name="periodEndYear"
              type="number"
              defaultValue={episode.periodEndYear ?? ""}
              className="input"
            />
          </Field>
          <Field label="Target duration (s)" name="targetDurationSeconds">
            <input
              id="targetDurationSeconds"
              name="targetDurationSeconds"
              type="number"
              min={15}
              defaultValue={episode.targetDurationSeconds ?? ""}
              className="input"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="card space-y-4">
        <legend className="px-1 font-serif text-lg font-semibold">Production method</legend>
        <p className="text-sm text-black/60">
          Change per episode at any time. Free options never call a paid API.
        </p>

        <Field label="Narration" name="narrationMode">
          <select
            id="narrationMode"
            name="narrationMode"
            className="input"
            defaultValue={episode.narrationMode}
          >
            {NARRATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {NARRATION_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Subtitles" name="captionMode">
          <select
            id="captionMode"
            name="captionMode"
            className="input"
            defaultValue={episode.captionMode}
          >
            {CAPTION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {CAPTION_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Scene plan" name="scenePlanMode">
          <select
            id="scenePlanMode"
            name="scenePlanMode"
            className="input"
            defaultValue={episode.scenePlanMode}
          >
            {SCENE_PLAN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SCENE_PLAN_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Publishing" name="publishMode">
          <select
            id="publishMode"
            name="publishMode"
            className="input"
            defaultValue={episode.publishMode}
          >
            {PUBLISH_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PUBLISH_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <Submit />
    </form>
  );
}
