/**
 * Render provider selection.
 *
 * Only ffmpeg exists today. The interface is here because Milestone 2's plan
 * names Remotion for richer templates, and Remotion is a large dependency that
 * needs a headless browser — it should be droppable in behind this seam without
 * the queue, the database wiring or the UI knowing about it. `renders.template`
 * already carries the per-render template id for that day.
 */
import "server-only";

import { FfmpegRenderProvider } from "./ffmpeg";
import type { RenderProvider } from "./types";

let cached: RenderProvider | null = null;

export function getRenderProvider(): RenderProvider {
  cached ??= new FfmpegRenderProvider();
  return cached;
}

export type { RenderProvider, RenderRequest, RenderResult, RenderProgress } from "./types";
