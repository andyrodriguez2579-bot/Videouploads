import { Badge, EmptyState, MilestoneNotice } from "@/components/ui";
import {
  CAPTION_MODE_LABELS,
  NARRATION_MODE_LABELS,
  type CaptionMode,
  type NarrationMode,
} from "@/domain/types";

/**
 * Milestone 1 shows the narration and caption records that exist and the mode
 * chosen for this episode. Uploading narration/subtitle files and generating
 * them locally (Piper / faster-whisper) lands with the render pipeline in M2,
 * where the audio can be probed and loudness-normalised in the same job.
 */
export function ProductionTab({
  narrationMode,
  captionMode,
  voiceovers,
  captions,
  renderCount,
}: {
  episodeId: string;
  narrationMode: NarrationMode;
  captionMode: CaptionMode;
  voiceovers: {
    id: string;
    source: string;
    provider: string | null;
    objectKey: string | null;
    durationSeconds: string | null;
    status: string;
    isSelected: boolean;
  }[];
  captions: {
    id: string;
    format: string;
    source: string;
    cueCount: number | null;
    status: string;
    humanReviewed: boolean;
  }[];
  renderCount: number;
}) {
  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="mb-3 font-serif text-lg font-semibold">Chosen method</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-black/60">Narration</dt>
            <dd className="font-medium">{NARRATION_MODE_LABELS[narrationMode]}</dd>
          </div>
          <div>
            <dt className="text-black/60">Subtitles</dt>
            <dd className="font-medium">{CAPTION_MODE_LABELS[captionMode]}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-black/60">
          Change these on the Details tab. Free options require no external account.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-3 font-serif text-lg font-semibold">Narration tracks</h2>
        {voiceovers.length === 0 ? (
          <EmptyState
            title="No narration recorded"
            description="Narration upload and local Piper generation arrive with the render pipeline."
          />
        ) : (
          <ul className="divide-y divide-black/10 text-sm">
            {voiceovers.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2.5">
                <span>
                  {v.source}
                  {v.provider ? ` · ${v.provider}` : ""}
                  {v.durationSeconds ? ` · ${v.durationSeconds}s` : ""}
                </span>
                <span className="flex gap-1.5">
                  {v.isSelected ? <Badge tone="good">Selected</Badge> : null}
                  <Badge>{v.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-serif text-lg font-semibold">Subtitles</h2>
        {captions.length === 0 ? (
          <EmptyState
            title="No subtitle files"
            description="Import an SRT/VTT, or generate them locally with faster-whisper, in Milestone 2."
          />
        ) : (
          <ul className="divide-y divide-black/10 text-sm">
            {captions.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                <span>
                  {c.format.toUpperCase()} · {c.source}
                  {c.cueCount ? ` · ${c.cueCount} cues` : ""}
                </span>
                <span className="flex gap-1.5">
                  <Badge tone={c.humanReviewed ? "good" : "warn"}>
                    {c.humanReviewed ? "Reviewed" : "Unreviewed"}
                  </Badge>
                  <Badge>{c.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MilestoneNotice milestone="Milestone 2">
        <p>
          Rendering is not built yet. This episode has {renderCount} render record(s). The pipeline
          will use FFmpeg and Remotion locally — no paid service — driven by BullMQ jobs with
          progress and retry surfaced in the Render center.
        </p>
      </MilestoneNotice>
    </div>
  );
}
