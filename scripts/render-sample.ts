/**
 * Renders a sample video from a hand-built scene plan, with no database and no
 * queue involved. This is the fastest way to check that the local ffmpeg
 * toolchain, fonts and filter graph actually work on a given machine.
 *
 *   npm run render:sample -- ./sample.mp4 [16:9|9:16] [background.jpg]
 *
 * Passing a background image also exercises the archival-still path: cover,
 * crop and text legibility over a real photograph rather than a plain card.
 */
import "dotenv/config";
import path from "node:path";

import { buildRenderPlan, type PlannedScene } from "../src/domain/render";
import { FfmpegRenderProvider } from "../src/lib/render/ffmpeg";

const SCENES: PlannedScene[] = [
  {
    id: "s1",
    position: 1,
    heading: "Historia of Dominicana",
    onScreenText: "A documentary series",
    narrationText: null,
    template: "title_card",
    estimatedSeconds: 3,
    backgroundKey: null,
  },
  {
    id: "s2",
    position: 2,
    heading: "Santo Domingo, 1586",
    onScreenText: null,
    narrationText:
      "Francis Drake landed at dawn. The oldest European city in the Americas fell within hours.",
    template: "archival_still",
    estimatedSeconds: 4,
    backgroundKey: null,
  },
  {
    id: "s3",
    position: 3,
    heading: "Sources",
    onScreenText: "Every claim in this film is cited on screen.",
    narrationText: null,
    template: "source_credits",
    estimatedSeconds: 3,
    backgroundKey: null,
  },
];

async function main() {
  const outputPath = path.resolve(process.argv[2] ?? "sample-render.mp4");
  const aspect = process.argv[3] === "9:16" ? "9:16" : "16:9";
  const backgroundPath = process.argv[4] ? path.resolve(process.argv[4]) : null;

  const scenes = backgroundPath
    ? SCENES.map((scene) =>
        scene.template === "archival_still" ? { ...scene, backgroundKey: "sample" } : scene,
      )
    : SCENES;

  const plan = buildRenderPlan(scenes, { aspectRatio: aspect });
  console.log(
    `Rendering ${plan.segments.length} scenes, ${plan.totalSeconds}s, ` +
      `${plan.width}x${plan.height} → ${outputPath}`,
  );

  const provider = new FfmpegRenderProvider();
  const result = await provider.render({
    plan,
    outputPath,
    resolveAsset: async () => backgroundPath,
    onProgress: (p) => console.log(`  [${p.completed}/${p.total}] ${p.stage}`),
  });

  console.log(
    `Done: ${(result.byteSize / 1024).toFixed(0)} KB, ${result.durationSeconds}s, ` +
      `${result.width}x${result.height}`,
  );
}

main().catch((error) => {
  console.error("Sample render failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
