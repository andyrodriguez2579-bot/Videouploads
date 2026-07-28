import type { RenderPlan } from "@/domain/render";

export interface RenderProgress {
  /** Segments finished so far. */
  completed: number;
  total: number;
  /** Short human-readable phase, stored on `render_jobs.stage`. */
  stage: string;
}

export interface RenderRequest {
  plan: RenderPlan;
  /** Absolute path the finished file must be written to. */
  outputPath: string;
  /**
   * Resolves a storage key to a readable local path, or null when the object is
   * missing. Injected so the renderer stays independent of the storage driver —
   * an S3 driver can stage the object to a temp file and hand back that path.
   */
  resolveAsset: (key: string) => Promise<string | null>;
  /**
   * Local path to the narration to lay under the whole film, if one is
   * selected. Mixed and loudness-normalised in a single final pass.
   */
  narrationPath?: string | null;
  onProgress?: (progress: RenderProgress) => void | Promise<void>;
  /** Aborts a run that is no longer wanted; the process is killed. */
  signal?: AbortSignal;
}

export interface RenderResult {
  outputPath: string;
  byteSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  mimeType: string;
  /**
   * Integrated loudness of the finished programme in LUFS, when narration was
   * mixed. Null for a silent render, where the measurement is meaningless.
   */
  loudnessLufs: number | null;
  /** Encoder command log, trimmed. Stored on `render_jobs.log` for debugging. */
  log: string;
}

export interface RenderProvider {
  readonly name: string;
  /** Throws with a readable message when the toolchain is unusable. */
  preflight(): Promise<void>;
  render(request: RenderRequest): Promise<RenderResult>;
}
