import { Badge, EmptyState, MilestoneNotice } from "@/components/ui";
import {
  NarrationPanel,
  type SceneNarrationRow,
  type VoiceoverRow,
} from "./narration-panel";
import { RenderPanel, type RenderRow } from "./render-panel";
import {
  CAPTION_MODE_LABELS,
  NARRATION_MODE_LABELS,
  type CaptionMode,
  type NarrationMode,
} from "@/domain/types";

/**
 * Where an episode becomes a film: narration in, render out.
 *
 * Narration upload and rendering are live. Subtitles and locally generated
 * narration (faster-whisper, Piper) are still to come, and say so rather than
 * pretending to work.
 */
export function ProductionTab({
  episodeId,
  narrationMode,
  captionMode,
  voiceovers,
  captions,
  sceneNarration,
  renders,
  renderPlan,
}: {
  episodeId: string;
  narrationMode: NarrationMode;
  captionMode: CaptionMode;
  voiceovers: VoiceoverRow[];
  sceneNarration: SceneNarrationRow[];
  captions: {
    id: string;
    format: string;
    source: string;
    cueCount: number | null;
    status: string;
    humanReviewed: boolean;
  }[];
  renders: RenderRow[];
  renderPlan: {
    plannedSeconds: number;
    sceneCount: number;
    canRender: boolean;
    blockers: string[];
    warnings: string[];
  };
}) {
  return (
    <div className="space-y-6">
      <NarrationPanel
        episodeId={episodeId}
        voiceovers={voiceovers}
        scenes={sceneNarration}
      />

      <RenderPanel
        episodeId={episodeId}
        renders={renders}
        plannedSeconds={renderPlan.plannedSeconds}
        sceneCount={renderPlan.sceneCount}
        canRender={renderPlan.canRender}
        blockers={renderPlan.blockers}
        warnings={renderPlan.warnings}
      />
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

      <MilestoneNotice milestone="Milestone 2 — still to come">
        <p>
          Subtitles: import an SRT/VTT, or generate timings locally with faster-whisper. Narration
          can also be generated locally with Piper rather than uploaded. Neither is built yet.
        </p>
      </MilestoneNotice>
    </div>
  );
}
