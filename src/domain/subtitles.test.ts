import { describe, expect, it } from "vitest";

import {
  CUE_GAP_SECONDS,
  MAX_CUE_SECONDS,
  MAX_LINE_CHARS,
  MIN_CUE_SECONDS,
  buildCues,
  formatTimestamp,
  parseSubtitles,
  reviewCaptions,
  splitIntoCueTexts,
  toSrt,
  toVtt,
  wrapCueLines,
  type CaptionScene,
} from "./subtitles";

function sceneAt(
  startSeconds: number,
  durationSeconds: number,
  narrationText: string | null,
): CaptionScene {
  return { startSeconds, durationSeconds, narrationText };
}

describe("splitIntoCueTexts", () => {
  it("keeps a short line as a single cue", () => {
    expect(splitIntoCueTexts("Santo Domingo, 1496.")).toEqual(["Santo Domingo, 1496."]);
  });

  it("breaks at sentence ends", () => {
    expect(
      splitIntoCueTexts("Drake landed al amanecer. La ciudad cayó en horas."),
    ).toEqual(["Drake landed al amanecer.", "La ciudad cayó en horas."]);
  });

  it("collapses whitespace so a wrapped script does not leak formatting", () => {
    expect(splitIntoCueTexts("  Santo\n  Domingo  ")).toEqual(["Santo Domingo"]);
  });

  it("returns nothing for empty or absent narration", () => {
    expect(splitIntoCueTexts("")).toEqual([]);
    expect(splitIntoCueTexts("   ")).toEqual([]);
  });

  it("splits an over-long sentence at a clause boundary rather than mid-thought", () => {
    const text =
      "En la margen oriental del río Ozama, los españoles fundaron la primera ciudad europea permanente de las Américas";
    const chunks = splitIntoCueTexts(text);

    expect(chunks.length).toBeGreaterThan(1);
    // The comma stays with the text before it.
    expect(chunks[0]!.endsWith(",")).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_LINE_CHARS * 2);
    }
  });

  it("never severs a word when forced to split", () => {
    // Every token must survive intact; a fragment like "palab" would mean the
    // splitter cut inside a word rather than at a space.
    const chunks = splitIntoCueTexts("palabra ".repeat(40).trim());

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.trim()).toBe(chunk);
      for (const token of chunk.split(" ")) expect(token).toBe("palabra");
    }
    // And nothing is lost in the process.
    expect(chunks.join(" ").split(" ")).toHaveLength(40);
  });
});

describe("wrapCueLines", () => {
  it("leaves a short cue on one line", () => {
    expect(wrapCueLines("Santo Domingo")).toEqual(["Santo Domingo"]);
  });

  it("balances two lines rather than leaving an orphan", () => {
    const lines = wrapCueLines(
      "La ciudad más antigua del Nuevo Mundo cayó en cuestión de horas",
    );

    expect(lines).toHaveLength(2);
    // A nine-word line above a one-word line reads as a mistake.
    expect(Math.abs(lines[0]!.length - lines[1]!.length)).toBeLessThan(MAX_LINE_CHARS / 2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
  });

  it("keeps an unbreakable string whole rather than cutting a word in half", () => {
    const long = "x".repeat(MAX_LINE_CHARS + 10);
    expect(wrapCueLines(long)).toEqual([long]);
  });
});

describe("buildCues", () => {
  it("keeps every cue inside the scene it belongs to", () => {
    const cues = buildCues([
      sceneAt(0, 10, "Primera frase. Segunda frase. Tercera frase."),
      sceneAt(10, 6, "Cuarta frase."),
    ]);

    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      const inFirst = cue.startSeconds >= 0 && cue.endSeconds <= 10;
      const inSecond = cue.startSeconds >= 10 && cue.endSeconds <= 16;
      expect(inFirst || inSecond).toBe(true);
    }
  });

  it("skips scenes with no narration instead of emitting empty cues", () => {
    const cues = buildCues([sceneAt(0, 5, null), sceneAt(5, 5, "Solo esta.")]);

    expect(cues).toHaveLength(1);
    expect(cues[0]!.startSeconds).toBe(5);
  });

  it("numbers cues from one, in playback order", () => {
    const cues = buildCues([
      sceneAt(0, 12, "Una. Dos."),
      sceneAt(12, 12, "Tres. Cuatro."),
    ]);

    expect(cues.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]!.startSeconds).toBeGreaterThanOrEqual(cues[i - 1]!.endSeconds);
    }
  });

  it("leaves a gap so consecutive cues do not run together", () => {
    const cues = buildCues([sceneAt(0, 20, "Una frase. Otra frase.")]);
    expect(cues[1]!.startSeconds - cues[0]!.endSeconds).toBeCloseTo(CUE_GAP_SECONDS, 3);
  });

  it("never produces a cue shorter than the flash threshold", () => {
    const cues = buildCues([sceneAt(0, 30, "Sí. No. Tal vez. Quizás. Claro.")]);
    for (const cue of cues) {
      expect(cue.endSeconds - cue.startSeconds).toBeGreaterThanOrEqual(MIN_CUE_SECONDS - 0.001);
    }
  });

  it("clears the frame rather than hanging for a whole long scene", () => {
    // One short line on a minute-long scene: the subtitle should go away.
    const cues = buildCues([sceneAt(0, 60, "Corto.")]);

    expect(cues).toHaveLength(1);
    expect(cues[0]!.endSeconds - cues[0]!.startSeconds).toBeLessThanOrEqual(MAX_CUE_SECONDS);
  });

  it("holds the last cue to the cut when the scene is a sensible length", () => {
    // Ending early here would flash the text off just before the picture cuts.
    const cues = buildCues([sceneAt(0, 8, "Una frase. Otra frase.")]);
    expect(cues.at(-1)!.endSeconds).toBe(8);
  });

  it("never lets any cue exceed the maximum hold", () => {
    const cues = buildCues([sceneAt(0, 90, "Una. Dos. Tres.")]);
    for (const cue of cues) {
      expect(cue.endSeconds - cue.startSeconds).toBeLessThanOrEqual(MAX_CUE_SECONDS + 0.001);
    }
  });

  it("returns nothing for a plan with no narration at all", () => {
    expect(buildCues([sceneAt(0, 5, null), sceneAt(5, 5, null)])).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("formats SRT timestamps with a comma", () => {
    expect(formatTimestamp(0, ",")).toBe("00:00:00,000");
    expect(formatTimestamp(3661.5, ",")).toBe("01:01:01,500");
  });

  it("formats WebVTT timestamps with a period", () => {
    expect(formatTimestamp(12.34, ".")).toBe("00:00:12,340".replace(",", "."));
  });

  it("never emits a negative timestamp", () => {
    expect(formatTimestamp(-3, ",")).toBe("00:00:00,000");
  });
});

describe("serialisation", () => {
  const cues = buildCues([sceneAt(0, 10, "Primera frase. Segunda frase.")]);

  it("writes SRT with index, timing and text", () => {
    const srt = toSrt(cues);
    expect(srt).toMatch(/^1\n00:00:00,000 --> /);
    expect(srt).toContain("Primera frase.");
  });

  it("writes WebVTT with its required header", () => {
    expect(toVtt(cues).startsWith("WEBVTT\n\n")).toBe(true);
  });

  it("round-trips through the parser", () => {
    const parsed = parseSubtitles(toSrt(cues));
    expect(parsed).toHaveLength(cues.length);
    expect(parsed[0]!.lines.join(" ")).toBe(cues[0]!.lines.join(" "));
    expect(parsed[0]!.startSeconds).toBeCloseTo(cues[0]!.startSeconds, 3);
  });

  it("round-trips WebVTT too", () => {
    const parsed = parseSubtitles(toVtt(cues));
    expect(parsed).toHaveLength(cues.length);
  });
});

describe("parseSubtitles", () => {
  it("tolerates CRLF, a BOM and a missing index line", () => {
    const messy = "﻿00:00:01.000 --> 00:00:03.000\r\nHola\r\n";
    const parsed = parseSubtitles(messy);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.startSeconds).toBe(1);
    expect(parsed[0]!.lines).toEqual(["Hola"]);
  });

  it("returns nothing for text with no timing lines", () => {
    expect(parseSubtitles("just some prose\n\nmore prose")).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(parseSubtitles("")).toEqual([]);
    expect(parseSubtitles("   \n  ")).toEqual([]);
  });
});

describe("reviewCaptions", () => {
  it("reports a clean set with no warnings", () => {
    const review = reviewCaptions(buildCues([sceneAt(0, 20, "Una frase corta.")]));
    expect(review.warnings).toEqual([]);
    expect(review.cueCount).toBe(1);
  });

  it("flags cues that go by faster than a viewer can read", () => {
    const review = reviewCaptions([
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 1,
        lines: ["Una frase mucho más larga de lo que cabe leer en un segundo"],
      },
    ]);

    expect(review.tooFastCount).toBe(1);
    expect(review.warnings.join(" ")).toMatch(/characters per second/i);
  });

  it("flags a line too wide for a narrow screen", () => {
    const review = reviewCaptions([
      { index: 1, startSeconds: 0, endSeconds: 6, lines: ["x".repeat(MAX_LINE_CHARS + 5)] },
    ]);

    expect(review.overlongLineCount).toBe(1);
    expect(review.warnings.join(" ")).toMatch(/clipped on narrow screens/i);
  });

  it("never blocks — these are judgement calls, not defects", () => {
    const review = reviewCaptions([
      { index: 1, startSeconds: 0, endSeconds: 0.5, lines: ["x".repeat(60)] },
    ]);
    expect(review.warnings.length).toBeGreaterThan(0);
    expect(review.cueCount).toBe(1);
  });
});
