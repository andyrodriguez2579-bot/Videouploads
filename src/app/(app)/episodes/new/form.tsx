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
} from "@/domain/types";

import type { ActionState } from "@/lib/action-state";

import { createEpisodeAction } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Creating…" : "Create episode"}
    </button>
  );
}

export function NewEpisodeForm({ series }: { series: { id: string; title: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createEpisodeAction, {});

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.error ? <Alert tone="error" title={state.error} /> : null}

      <fieldset className="card space-y-4">
        <legend className="px-1 font-serif text-lg font-semibold">Episode</legend>

        <Field label="Series" name="seriesId" error={state.fields?.seriesId}>
          <select id="seriesId" name="seriesId" required className="input" defaultValue={series[0]?.id ?? ""}>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" name="title" error={state.fields?.title}>
          <input id="title" name="title" required className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Episode number"
            name="episodeNumber"
            error={state.fields?.episodeNumber}
            hint="Optional. Controls ordering in the episode list."
          >
            <input id="episodeNumber" name="episodeNumber" type="number" min={0} className="input" />
          </Field>
          <Field label="Language" name="language">
            <select id="language" name="language" className="input" defaultValue="es">
              <option value="es">Spanish</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>

        <Field label="Synopsis" name="synopsis" error={state.fields?.synopsis}>
          <textarea id="synopsis" name="synopsis" rows={3} className="input" />
        </Field>
      </fieldset>

      <fieldset className="card space-y-4">
        <legend className="px-1 font-serif text-lg font-semibold">Historical period</legend>

        <Field
          label="Period label"
          name="periodLabel"
          error={state.fields?.periodLabel}
          hint="How it reads on screen, e.g. “Taíno Hispaniola, c. 600–1492”."
        >
          <input id="periodLabel" name="periodLabel" className="input" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Start year"
            name="periodStartYear"
            error={state.fields?.periodStartYear}
            hint="Negative numbers for BCE."
          >
            <input id="periodStartYear" name="periodStartYear" type="number" className="input" />
          </Field>
          <Field label="End year" name="periodEndYear" error={state.fields?.periodEndYear}>
            <input id="periodEndYear" name="periodEndYear" type="number" className="input" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="card space-y-4">
        <legend className="px-1 font-serif text-lg font-semibold">Production method</legend>
        <p className="text-sm text-black/60">
          Pick per episode. The free options need no external account and no API spend.
        </p>

        <Field label="Narration" name="narrationMode">
          <select id="narrationMode" name="narrationMode" className="input" defaultValue="upload">
            {NARRATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {NARRATION_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Subtitles" name="captionMode">
          <select id="captionMode" name="captionMode" className="input" defaultValue="upload">
            {CAPTION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {CAPTION_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Scene plan" name="scenePlanMode">
          <select id="scenePlanMode" name="scenePlanMode" className="input" defaultValue="manual">
            {SCENE_PLAN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SCENE_PLAN_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Publishing" name="publishMode">
          <select id="publishMode" name="publishMode" className="input" defaultValue="manual_upload">
            {PUBLISH_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PUBLISH_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Target duration (seconds)"
          name="targetDurationSeconds"
          error={state.fields?.targetDurationSeconds}
        >
          <input
            id="targetDurationSeconds"
            name="targetDurationSeconds"
            type="number"
            min={15}
            className="input"
          />
        </Field>
      </fieldset>

      <Submit />
    </form>
  );
}
