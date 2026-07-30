/**
 * Building subtitle cues from the scene plan.
 *
 * Pure, like `workflow.ts` and `render.ts` — no database, no ffmpeg — so the
 * timing and line-breaking rules can be unit tested on their own.
 *
 * **The script is the source of truth, not a transcription.** Speech recognition
 * exists to discover what was said; here that is already known, written down and
 * approved. Running the narration through ASR would take text that is correct by
 * construction and introduce errors into it — misheard proper nouns especially,
 * which in this series means place names and people who are the entire point.
 * ASR earns its place later for *timing within* a scene, not for the words.
 */

/** Netflix and BBC both land near 42; longer lines start forcing eye movement. */
export const MAX_LINE_CHARS = 42;
/** Three lines covers too much of the frame, and is where readers start to skim. */
export const MAX_LINES_PER_CUE = 2;

/**
 * Characters per second a viewer can comfortably read. 17 is the Netflix adult
 * figure; going faster technically fits but stops being readable.
 */
export const READING_CHARS_PER_SECOND = 17;

/** A cue shorter than this flashes; longer than this outstays its welcome. */
export const MIN_CUE_SECONDS = 1;
export const MAX_CUE_SECONDS = 7;

/** Keeps consecutive cues from visually running together. */
export const CUE_GAP_SECONDS = 0.08;

export interface Cue {
  /** 1-based, in playback order. */
  index: number;
  startSeconds: number;
  endSeconds: number;
  /** Already wrapped: at most MAX_LINES_PER_CUE entries. */
  lines: string[];
}

export interface CaptionScene {
  /** Where this scene sits in the finished film. */
  startSeconds: number;
  durationSeconds: number;
  /** What is spoken over it. Scenes with none contribute no cues. */
  narrationText: string | null;
}

/**
 * Splits text into chunks that will fit a cue, preferring to break at sentence
 * ends, then at clause boundaries, and only splitting mid-clause as a last
 * resort. A subtitle broken mid-thought is harder to read than a slightly long
 * one, so the boundaries are chosen before the length is enforced.
 */
export function splitIntoCueTexts(text: string): string[] {
  const budget = MAX_LINE_CHARS * MAX_LINES_PER_CUE;
  const normalised = text.replace(/\s+/g, " ").trim();
  if (!normalised) return [];

  // Sentence first. The lookbehind keeps the punctuation with its sentence.
  const sentences = normalised.split(/(?<=[.!?…])\s+/).filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= budget) {
      chunks.push(sentence);
      continue;
    }
    // Too long for one cue: break on clause punctuation where possible.
    let remainder = sentence;
    while (remainder.length > budget) {
      const window = remainder.slice(0, budget + 1);
      const clause = Math.max(
        window.lastIndexOf(", "),
        window.lastIndexOf("; "),
        window.lastIndexOf(": "),
        window.lastIndexOf(" — "),
      );
      // +1 keeps the comma with the text before the break.
      let cut = clause > budget * 0.4 ? clause + 1 : window.lastIndexOf(" ");
      if (cut <= 0) cut = budget;
      chunks.push(remainder.slice(0, cut).trim());
      remainder = remainder.slice(cut).trim();
    }
    if (remainder) chunks.push(remainder);
  }

  return chunks;
}

/**
 * Wraps one cue's text across at most two lines, balancing their lengths.
 * A line of nine words above a line of one reads as a mistake.
 */
export function wrapCueLines(text: string): string[] {
  if (text.length <= MAX_LINE_CHARS) return [text];

  const words = text.split(" ");
  let best: [string, string] | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = 1; i < words.length; i += 1) {
    const first = words.slice(0, i).join(" ");
    const second = words.slice(i).join(" ");
    if (first.length > MAX_LINE_CHARS || second.length > MAX_LINE_CHARS) continue;
    const delta = Math.abs(first.length - second.length);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = [first, second];
    }
  }

  // Nothing fits two lines — a single unbroken word longer than the limit, or
  // text that overflows the budget. Keep it whole rather than severing a word.
  return best ?? [text];
}

/**
 * Lays cues across the scenes they belong to.
 *
 * Each scene's own time range bounds its cues, so a subtitle can never drift
 * onto the wrong picture. Within a scene, time is shared out in proportion to
 * how much there is to read.
 */
export function buildCues(scenes: CaptionScene[]): Cue[] {
  const cues: Cue[] = [];
  let index = 1;

  for (const scene of scenes) {
    const texts = splitIntoCueTexts(scene.narrationText ?? "");
    if (texts.length === 0) continue;

    const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
    let cursor = scene.startSeconds;
    const sceneEnd = scene.startSeconds + scene.durationSeconds;

    texts.forEach((text, position) => {
      const isLast = position === texts.length - 1;
      const share = totalChars === 0 ? 0 : text.length / totalChars;

      // Proportional share, but never less than the text needs to be read, and
      // never past the end of the scene it belongs to.
      const needed = text.length / READING_CHARS_PER_SECOND;
      let duration = Math.max(scene.durationSeconds * share, needed, MIN_CUE_SECONDS);
      duration = Math.min(duration, MAX_CUE_SECONDS);

      // The last cue of a scene runs to the scene's end so the text does not
      // vanish a moment before the cut — but still no longer than a subtitle
      // should ever hold. A single short line on a minute-long scene should
      // clear the frame, not hang there for the whole minute.
      let end = isLast ? Math.min(sceneEnd, cursor + MAX_CUE_SECONDS) : cursor + duration;
      end = Math.min(end, sceneEnd);
      if (end - cursor < MIN_CUE_SECONDS) end = Math.min(cursor + MIN_CUE_SECONDS, sceneEnd);

      // A scene too short for everything in it still gets readable cues; the
      // overflow is clamped rather than producing negative or zero-length ones.
      if (end <= cursor) return;

      cues.push({
        index: index++,
        startSeconds: round3(cursor),
        endSeconds: round3(end),
        lines: wrapCueLines(text),
      });

      cursor = Math.min(end + CUE_GAP_SECONDS, sceneEnd);
    });
  }

  return cues;
}

/** `HH:MM:SS,mmm` for SRT; `HH:MM:SS.mmm` for WebVTT. */
export function formatTimestamp(seconds: number, separator: "," | "."): string {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const ms = Math.round((clamped - whole) * 1000);
  const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}${separator}${String(ms).padStart(3, "0")}`;
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (cue) =>
          `${cue.index}\n` +
          `${formatTimestamp(cue.startSeconds, ",")} --> ${formatTimestamp(cue.endSeconds, ",")}\n` +
          `${cue.lines.join("\n")}\n`,
      )
      .join("\n") + (cues.length > 0 ? "" : "")
  );
}

export function toVtt(cues: Cue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${formatTimestamp(cue.startSeconds, ".")} --> ${formatTimestamp(cue.endSeconds, ".")}\n` +
        `${cue.lines.join("\n")}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/**
 * Reads SRT or WebVTT back into cues, for a file someone made elsewhere.
 *
 * Deliberately lenient about the things that differ between tools — BOM, CRLF,
 * a missing index line, `.` or `,` as the millisecond separator — because
 * rejecting a subtitle file over a line ending helps nobody.
 */
export function parseSubtitles(source: string): Cue[] {
  const text = source.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const timing =
    /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    if (lines[0]?.trim().toUpperCase().startsWith("WEBVTT")) lines.shift();

    const timingIndex = lines.findIndex((line) => timing.test(line));
    if (timingIndex === -1) continue;

    const match = timing.exec(lines[timingIndex]!);
    if (!match) continue;

    const body = lines.slice(timingIndex + 1);
    if (body.length === 0) continue;

    cues.push({
      index: cues.length + 1,
      startSeconds: toSeconds(match[1]!, match[2]!, match[3]!, match[4]!),
      endSeconds: toSeconds(match[5]!, match[6]!, match[7]!, match[8]!),
      lines: body.slice(0, MAX_LINES_PER_CUE),
    });
  }

  return cues;
}

function toSeconds(h: string, m: string, s: string, ms: string): number {
  const millis = Number.parseInt(ms.padEnd(3, "0"), 10);
  return round3(Number(h) * 3600 + Number(m) * 60 + Number(s) + millis / 1000);
}

export interface CaptionReview {
  cueCount: number;
  /** Cues a viewer cannot comfortably read in the time given. */
  tooFastCount: number;
  /** Cues with a line over the readable width. */
  overlongLineCount: number;
  warnings: string[];
}

/**
 * What a human should know before signing captions off. Nothing here blocks —
 * these are judgement calls, and a caption that is one character over is not a
 * defect worth refusing to publish.
 */
export function reviewCaptions(cues: Cue[]): CaptionReview {
  let tooFastCount = 0;
  let overlongLineCount = 0;

  for (const cue of cues) {
    const chars = cue.lines.join(" ").length;
    const seconds = cue.endSeconds - cue.startSeconds;
    if (seconds > 0 && chars / seconds > READING_CHARS_PER_SECOND * 1.15) tooFastCount += 1;
    if (cue.lines.some((line) => line.length > MAX_LINE_CHARS)) overlongLineCount += 1;
  }

  const warnings: string[] = [];
  if (tooFastCount > 0) {
    warnings.push(
      `${tooFastCount} cue(s) go by faster than ${READING_CHARS_PER_SECOND} characters per ` +
        `second. Lengthen those scenes, or shorten the narration.`,
    );
  }
  if (overlongLineCount > 0) {
    warnings.push(
      `${overlongLineCount} cue(s) have a line longer than ${MAX_LINE_CHARS} characters and ` +
        `may be clipped on narrow screens.`,
    );
  }

  return { cueCount: cues.length, tooFastCount, overlongLineCount, warnings };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
