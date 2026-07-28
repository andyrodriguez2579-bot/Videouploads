/**
 * Environment validation.
 *
 * Defaults are chosen so a fresh clone runs with a local Postgres and local
 * disk and nothing else: no Supabase project, no S3 bucket, no API keys. Every
 * paid or cloud service is opt-in, and the schema refuses half-configured
 * combinations (e.g. STORAGE_DRIVER=s3 with no bucket) rather than failing at
 * the first upload.
 */
import { z } from "zod";

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required. For local dev: postgres://historia:historia@localhost:5432/historia"),

  // --- Auth -----------------------------------------------------------------
  AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  // Signs the local session cookie. Must be >= 32 chars.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(168),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // --- Storage --------------------------------------------------------------
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_PATH: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  // Set for Cloudflare R2 or MinIO; leave unset for Amazon S3.
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default("true"),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(512),

  // --- Provider selection (interfaces land in M2/M3; config is read now) -----
  SCENE_PLAN_PROVIDER: z.enum(["manual", "mock", "openai", "anthropic"]).default("manual"),
  TTS_PROVIDER: z.enum(["none", "piper", "elevenlabs", "openai"]).default("none"),
  ASR_PROVIDER: z.enum(["none", "faster_whisper", "openai"]).default("none"),
  COPY_PROVIDER: z.enum(["manual", "mock", "openai", "anthropic"]).default("manual"),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),

  // Local binaries — resolved from PATH unless overridden.
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  PIPER_PATH: z.string().optional(),
  PIPER_VOICE_PATH: z.string().optional(),
  FASTER_WHISPER_PATH: z.string().optional(),
  WHISPER_MODEL: z.string().default("base"),

  // --- Jobs (M2) ------------------------------------------------------------
  REDIS_URL: z.string().optional(),

  // --- Publishing (M4) ------------------------------------------------------
  PUBLISHING_MODE: z.enum(["mock", "live"]).default("mock"),
  // 32-byte key, base64 encoded, for AES-256-GCM token encryption at rest.
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().url().optional(),
});

const envSchema = baseSchema
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }

    if (env.AUTH_PROVIDER === "supabase") {
      for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when AUTH_PROVIDER=supabase`,
          });
        }
      }
    }

    if (env.TTS_PROVIDER === "piper" && !env.PIPER_PATH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PIPER_PATH"],
        message: "PIPER_PATH is required when TTS_PROVIDER=piper",
      });
    }

    if (env.TTS_PROVIDER === "elevenlabs" && !env.ELEVENLABS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ELEVENLABS_API_KEY"],
        message: "ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs",
      });
    }

    const needsOpenAi =
      env.SCENE_PLAN_PROVIDER === "openai" ||
      env.COPY_PROVIDER === "openai" ||
      env.TTS_PROVIDER === "openai" ||
      env.ASR_PROVIDER === "openai";
    if (needsOpenAi && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when an OpenAI provider is selected",
      });
    }

    if (env.PUBLISHING_MODE === "live" && !env.TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TOKEN_ENCRYPTION_KEY"],
        message: "TOKEN_ENCRYPTION_KEY is required when PUBLISHING_MODE=live",
      });
    }
  });

export type Env = z.infer<typeof baseSchema>;

export interface EnvIssue {
  key: string;
  message: string;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env):
  | { ok: true; env: Env }
  | { ok: false; issues: EnvIssue[] } {
  const result = envSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      key: String(issue.path[0] ?? "(root)"),
      message: issue.message,
    })),
  };
}

let cached: Env | null = null;

/** Throws on a bad configuration. Used by every server module. */
export function getEnv(): Env {
  if (cached) return cached;
  const result = parseEnv();
  if (!result.ok) {
    const detail = result.issues.map((i) => `  - ${i.key}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`);
  }
  cached = result.env;
  return cached;
}

/**
 * Non-throwing view for the Settings screen. Never returns a secret value —
 * only whether one is present.
 */
export function describeEnv() {
  const result = parseEnv();
  const raw = process.env;
  const present = (key: string) => Boolean(raw[key] && raw[key]!.length > 0);

  return {
    valid: result.ok,
    issues: result.ok ? [] : result.issues,
    values: {
      NODE_ENV: raw.NODE_ENV ?? "development",
      APP_URL: raw.APP_URL ?? "http://localhost:3000",
      AUTH_PROVIDER: raw.AUTH_PROVIDER ?? "local",
      STORAGE_DRIVER: raw.STORAGE_DRIVER ?? "local",
      LOCAL_STORAGE_PATH: raw.LOCAL_STORAGE_PATH ?? "./storage",
      S3_BUCKET: raw.S3_BUCKET ?? "(unset)",
      S3_ENDPOINT: raw.S3_ENDPOINT ?? "(unset)",
      SCENE_PLAN_PROVIDER: raw.SCENE_PLAN_PROVIDER ?? "manual",
      COPY_PROVIDER: raw.COPY_PROVIDER ?? "manual",
      TTS_PROVIDER: raw.TTS_PROVIDER ?? "none",
      ASR_PROVIDER: raw.ASR_PROVIDER ?? "none",
      PUBLISHING_MODE: raw.PUBLISHING_MODE ?? "mock",
      FFMPEG_PATH: raw.FFMPEG_PATH ?? "ffmpeg",
      REDIS_URL: raw.REDIS_URL ? "(set)" : "(unset)",
      // What that actually means for an operator, rather than making them infer
      // it: without Redis a render dies with the process that started it.
      RENDER_JOBS: raw.REDIS_URL
        ? "queued — survives a restart, needs `npm run worker`"
        : "in-process — no worker needed, lost on restart",
    },
    secrets: {
      DATABASE_URL: present("DATABASE_URL"),
      SESSION_SECRET: present("SESSION_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
      S3_ACCESS_KEY_ID: present("S3_ACCESS_KEY_ID"),
      S3_SECRET_ACCESS_KEY: present("S3_SECRET_ACCESS_KEY"),
      OPENAI_API_KEY: present("OPENAI_API_KEY"),
      ANTHROPIC_API_KEY: present("ANTHROPIC_API_KEY"),
      ELEVENLABS_API_KEY: present("ELEVENLABS_API_KEY"),
      TOKEN_ENCRYPTION_KEY: present("TOKEN_ENCRYPTION_KEY"),
      YOUTUBE_CLIENT_SECRET: present("YOUTUBE_CLIENT_SECRET"),
    },
  };
}
