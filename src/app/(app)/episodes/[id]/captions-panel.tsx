"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Badge, Field } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

import {
  deleteCaptionsAction,
  generateCaptionsAction,
  importCaptionsAction,
  reviewCaptionsAction,
} from "./caption-actions";

export interface CaptionRow {
  id: string;
  format: string;
  source: string;
  provider: string | null;
  cueCount: number | null;
  status: string;
  humanReviewed: boolean;
  isSelected: boolean;
}

function Submit({ idle, busy, secondary }: { idle: string; busy: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={secondary ? "btn-secondary" : "btn-primary"}
      disabled={pending}
    >
      {pending ? busy : idle}
    </button>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "From the script",
  upload: "Imported",
  local_asr: "faster-whisper",
  hosted_asr: "Hosted ASR",
};

export function CaptionsPanel({
  episodeId,
  captions,
}: {
  episodeId: string;
  captions: CaptionRow[];
}) {
  const [generateState, generate] = useActionState<ActionState, FormData>(
    generateCaptionsAction,
    {},
  );
  const [importState, importCaptions] = useActionState<ActionState, FormData>(
    importCaptionsAction,
    {},
  );

  const selected = captions.find((c) => c.isSelected);

  return (
    <section className="card">
      <h2 className="mb-1 font-serif text-lg font-semibold">Subtitles</h2>
      <p className="mb-4 text-xs text-black/60">
        Built from the scene plan, not transcribed: the script already says exactly what was
        recorded, so generating from it cannot mishear a place name. Timings come from the same
        plan the video is built from, so cues never drift onto the wrong picture.
      </p>

      {generateState.error ? (
        <div className="mb-4">
          <Alert tone="error" title={generateState.error} />
        </div>
      ) : null}
      {generateState.ok && generateState.message ? (
        <div className="mb-4">
          <Alert tone="success" title={generateState.message} />
        </div>
      ) : null}
      {importState.error ? (
        <div className="mb-4">
          <Alert tone="error" title={importState.error} />
        </div>
      ) : null}
      {importState.ok && importState.message ? (
        <div className="mb-4">
          <Alert tone="success" title={importState.message} />
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <form action={generate}>
          <input type="hidden" name="episodeId" value={episodeId} />
          <Submit idle="Generate from script" busy="Generating…" />
        </form>

        <form action={importCaptions} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="episodeId" value={episodeId} />
          <Field label="Or import a file" name="file" error={importState.fields?.file} hint="SRT or VTT.">
            <input
              id="caption-file"
              name="file"
              type="file"
              accept=".srt,.vtt,text/plain"
              required
              className="input max-w-xs text-xs"
            />
          </Field>
          <Submit idle="Import" busy="Importing…" secondary />
        </form>
      </div>

      {captions.length === 0 ? (
        <p className="text-sm text-black/60">
          No subtitles yet. Generating needs narration text on the scenes.
        </p>
      ) : (
        <ul className="divide-y divide-black/10">
          {captions.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              {row.isSelected ? <Badge tone="good">Selected</Badge> : <Badge>Not used</Badge>}
              <span className="text-black/70">{SOURCE_LABELS[row.source] ?? row.source}</span>
              <span className="tabular-nums text-black/70">{row.cueCount ?? 0} cues</span>
              <Badge tone={row.humanReviewed ? "good" : "warn"}>
                {row.humanReviewed ? "Checked" : "Unchecked"}
              </Badge>

              <a className="link" href={`/api/captions/${row.id}`}>
                .srt
              </a>
              <a className="link" href={`/api/captions/${row.id}?format=vtt`}>
                .vtt
              </a>

              {!row.humanReviewed ? (
                <form action={reviewCaptionsAction}>
                  <input type="hidden" name="episodeId" value={episodeId} />
                  <input type="hidden" name="captionId" value={row.id} />
                  <button type="submit" className="btn-secondary text-xs">
                    Mark checked
                  </button>
                </form>
              ) : null}

              <form action={deleteCaptionsAction}>
                <input type="hidden" name="episodeId" value={episodeId} />
                <input type="hidden" name="captionId" value={row.id} />
                <button type="submit" className="btn-secondary text-xs">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {selected && !selected.humanReviewed ? (
        <div className="mt-4">
          <Alert
            tone="warning"
            title="These subtitles have not been read by a person. Machine timing decides where lines break and how long they hold — worth checking before they go out."
          />
        </div>
      ) : null}

      <p className="mt-4 text-xs text-black/60">
        Download the <code>.srt</code> and upload it alongside the video on YouTube, so viewers
        can turn it off. For silent-autoplay feeds, tick <em>Burn subtitles in</em> when starting
        a render instead.
      </p>
    </section>
  );
}
