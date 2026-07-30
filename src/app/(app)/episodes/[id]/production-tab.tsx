import { MilestoneNotice } from "@/components/ui";
import {
  NarrationPanel,
  type SceneNarrationRow,
  type VoiceoverRow,
} from "./narration-panel";
import { CaptionsPanel, type CaptionRow } from "./captions-panel";
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
  captions: CaptionRow[];
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

      <CaptionsPanel episodeId={episodeId} captions={captions} />

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

      <MilestoneNotice milestone="Milestone 2 — still to come">
        <p>
          Narration can also be generated locally with Piper rather than recorded, and
          faster-whisper can time subtitles from the audio when a read departs from the script.
          Neither is built yet.
        </p>
      </MilestoneNotice>
    </div>
  );
}
