/**
 * FFmpeg render driver.
 *
 * Each scene becomes a self-contained segment — a still (or a plain card when
 * no still is linked) with the heading and caption drawn over it — and the
 * segments are concatenated without re-encoding.
 *
 * Encoding segment-by-segment rather than as one enormous filter graph is the
 * whole reason progress reporting and retries are possible: a 40-scene episode
 * reports 40 steps, and a failure names the scene that caused it instead of
 * dumping an unreadable graph. It also keeps peak memory flat regardless of
 * episode length.
 *
 * Every segment is encoded with identical parameters, which is what lets the
 * concat demuxer stitch them with `-c copy`.
 */
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RenderSegment } from "@/domain/render";
import { getEnv } from "@/lib/env";

import type { RenderProvider, RenderRequest, RenderResult } from "./types";

/** Ink-dark background, matching the app's palette rather than pure black. */
const CARD_COLOUR = "0x14181d";
const AUDIO_SAMPLE_RATE = 48000;

/**
 * Fonts are probed rather than configured: drawtext needs a real file, and a
 * missing one fails the render at the last step. Serif first — it matches the
 * documentary styling the app uses for headings.
 */
const HEADING_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
  "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
];
const CAPTION_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

/**
 * Escapes a path for use *inside* a filter argument. ffmpeg parses `:` as an
 * option separator and `'` as quoting even after shell argv splitting, so a
 * path containing either would silently corrupt the filter graph.
 */
function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

interface RunResult {
  stderr: string;
}

function run(
  bin: string,
  args: string[],
  signal: AbortSignal | undefined,
  label: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // ffmpeg is famously chatty; keep only the tail so a long render cannot
      // grow this string without bound.
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });

    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`${label}: could not start ${bin} (${error.message})`));
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error(`${label}: cancelled`));
        return;
      }
      if (code === 0) {
        resolve({ stderr: stdout || stderr });
        return;
      }
      const tail = stderr.trim().split("\n").slice(-6).join("\n");
      reject(new Error(`${label}: ffmpeg exited ${code}\n${tail}`));
    });
  });
}

export class FfmpegRenderProvider implements RenderProvider {
  readonly name = "ffmpeg";

  private get ffmpeg(): string {
    return getEnv().FFMPEG_PATH;
  }

  private get ffprobe(): string {
    return getEnv().FFPROBE_PATH;
  }

  async preflight(): Promise<void> {
    try {
      await run(this.ffmpeg, ["-hide_banner", "-version"], undefined, "preflight");
    } catch {
      throw new Error(
        `FFmpeg is not available at "${this.ffmpeg}". Install it, or set FFMPEG_PATH ` +
          `to its location. On Debian/Ubuntu: apt-get install ffmpeg.`,
      );
    }
    if (!(await firstExisting(HEADING_FONT_CANDIDATES))) {
      throw new Error(
        "No usable font was found for on-screen text. Install a font package " +
          "(Debian/Ubuntu: apt-get install fonts-dejavu-core).",
      );
    }
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    await this.preflight();

    const { plan, outputPath, resolveAsset, onProgress, signal } = request;
    if (plan.segments.length === 0) {
      throw new Error("Nothing to render: the plan has no segments.");
    }

    const headingFont = (await firstExisting(HEADING_FONT_CANDIDATES))!;
    const captionFont = (await firstExisting(CAPTION_FONT_CANDIDATES)) ?? headingFont;

    const workDir = await mkdtemp(path.join(tmpdir(), "historia-render-"));
    const logs: string[] = [];

    try {
      const segmentPaths: string[] = [];

      for (const [index, segment] of plan.segments.entries()) {
        if (signal?.aborted) throw new Error("Render cancelled.");

        await onProgress?.({
          completed: index,
          total: plan.segments.length + 1,
          stage: `Rendering scene ${index + 1} of ${plan.segments.length}`,
        });

        const segmentPath = path.join(workDir, `segment-${String(index).padStart(4, "0")}.mp4`);
        const background = segment.backgroundKey ? await resolveAsset(segment.backgroundKey) : null;

        const args = await this.segmentArgs({
          segment,
          plan,
          workDir,
          index,
          background,
          headingFont,
          captionFont,
          outputPath: segmentPath,
        });

        const { stderr } = await run(
          this.ffmpeg,
          args,
          signal,
          `Scene ${index + 1} ("${segment.heading}")`,
        );
        logs.push(stderr.trim().split("\n").slice(-3).join("\n"));
        segmentPaths.push(segmentPath);
      }

      await onProgress?.({
        completed: plan.segments.length,
        total: plan.segments.length + 1,
        stage: "Joining scenes",
      });

      await mkdir(path.dirname(outputPath), { recursive: true });
      await this.concat(segmentPaths, outputPath, workDir, signal);

      const [{ size }, durationSeconds] = await Promise.all([
        stat(outputPath),
        this.probeDuration(outputPath, signal),
      ]);

      await onProgress?.({
        completed: plan.segments.length + 1,
        total: plan.segments.length + 1,
        stage: "Complete",
      });

      return {
        outputPath,
        byteSize: size,
        durationSeconds,
        width: plan.width,
        height: plan.height,
        mimeType: "video/mp4",
        log: logs.join("\n").slice(-4000),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {
        // A leftover temp directory is not worth failing a good render over.
      });
    }
  }

  /**
   * Builds the argv for one segment. Text is passed via `textfile=` rather than
   * inline: headings legitimately contain colons, apostrophes and commas, all
   * of which are filter-graph metacharacters that would otherwise need brittle
   * multi-level escaping.
   */
  private async segmentArgs(input: {
    segment: RenderSegment;
    plan: RenderRequest["plan"];
    workDir: string;
    index: number;
    background: string | null;
    headingFont: string;
    captionFont: string;
    outputPath: string;
  }): Promise<string[]> {
    const { segment, plan, workDir, index, background, headingFont, captionFont } = input;
    const { width, height, fps } = plan;
    const duration = segment.durationSeconds.toFixed(3);

    const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];

    if (background) {
      // A still: hold one frame for the scene's duration.
      args.push("-loop", "1", "-t", duration, "-i", background);
    } else {
      args.push("-f", "lavfi", "-i", `color=c=${CARD_COLOUR}:s=${width}x${height}:r=${fps}`);
    }

    // A silent track keeps every segment's stream layout identical, which the
    // concat demuxer requires. Narration mixing arrives with the audio stage.
    args.push(
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE}`,
    );

    const filters: string[] = [];
    if (background) {
      // Cover the frame without distorting: upscale to fill, then crop the
      // overflow. Letterboxing a documentary still looks like a mistake.
      filters.push(
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        // Darken so drawn text stays legible over a bright archival scan.
        "eq=brightness=-0.06",
      );
    }
    filters.push(`format=yuv420p`);

    const headingSize = Math.round(height / 16);
    const captionSize = Math.round(height / 30);
    const hasCaption = Boolean(segment.caption?.trim());

    const headingFile = path.join(workDir, `heading-${index}.txt`);
    await writeFile(headingFile, segment.heading, "utf8");

    // Heading sits on the lower third; caption below it when present.
    const headingY = hasCaption ? `h*0.70-text_h` : `h*0.76-text_h/2`;
    filters.push(
      [
        `drawtext=fontfile='${escapeFilterPath(headingFont)}'`,
        `textfile='${escapeFilterPath(headingFile)}'`,
        `fontcolor=white`,
        `fontsize=${headingSize}`,
        `x=(w-text_w)/2`,
        `y=${headingY}`,
        `box=1`,
        `boxcolor=black@0.45`,
        `boxborderw=${Math.round(headingSize * 0.4)}`,
        `line_spacing=${Math.round(headingSize * 0.2)}`,
      ].join(":"),
    );

    if (hasCaption) {
      const captionFile = path.join(workDir, `caption-${index}.txt`);
      await writeFile(captionFile, wrapText(segment.caption!.trim(), 52), "utf8");
      filters.push(
        [
          `drawtext=fontfile='${escapeFilterPath(captionFont)}'`,
          `textfile='${escapeFilterPath(captionFile)}'`,
          `fontcolor=white@0.92`,
          `fontsize=${captionSize}`,
          `x=(w-text_w)/2`,
          `y=h*0.74`,
          `box=1`,
          `boxcolor=black@0.45`,
          `boxborderw=${Math.round(captionSize * 0.5)}`,
          `line_spacing=${Math.round(captionSize * 0.25)}`,
        ].join(":"),
      );
    }

    args.push(
      "-vf",
      filters.join(","),
      "-t",
      duration,
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-ac",
      "2",
      "-shortest",
      "-movflags",
      "+faststart",
      input.outputPath,
    );

    return args;
  }

  private async concat(
    segmentPaths: string[],
    outputPath: string,
    workDir: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const listPath = path.join(workDir, "segments.txt");
    // The concat demuxer's own quoting: single quotes are escaped as '\''.
    const list = segmentPaths
      .map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, `${list}\n`, "utf8");

    await run(
      this.ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      signal,
      "Joining scenes",
    );
  }

  private async probeDuration(filePath: string, signal: AbortSignal | undefined): Promise<number> {
    try {
      const { stderr } = await run(
        this.ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          filePath,
        ],
        signal,
        "Probing output",
      );
      const parsed = Number.parseFloat(stderr.trim());
      return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : 0;
    } catch {
      // A duration we cannot read is not worth failing a finished render over;
      // the planned total is already stored alongside it.
      return 0;
    }
  }
}

/**
 * Greedy word wrap. drawtext renders newlines but will not wrap, so a long
 * caption would otherwise run off both edges of the frame.
 */
export function wrapText(text: string, maxChars: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= maxChars) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
