import { describe, expect, it } from "vitest";

import { SERVER_ACTION_BODY_LIMIT_MB, parseEnv } from "./env";

/**
 * The environment schema is the app's first line of defence against a
 * half-configured install. These cover the paired requirements — the ones where
 * a single setting is valid alone but wrong in combination.
 */

/** Minimum viable environment: local Postgres, local disk, nothing paid. */
function base(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://historia:historia@localhost:5432/historia",
    SESSION_SECRET: "x".repeat(32),
    ...overrides,
  };
}

describe("upload ceiling", () => {
  it("accepts a limit at the server-action body limit", () => {
    const result = parseEnv(base({ MAX_UPLOAD_MB: String(SERVER_ACTION_BODY_LIMIT_MB) }));
    expect(result.ok).toBe(true);
  });

  it("refuses a limit the server action could never accept", () => {
    // The failure this prevents is silent: the request dies with an opaque
    // error at the moment someone uploads a take they just recorded.
    const result = parseEnv(base({ MAX_UPLOAD_MB: String(SERVER_ACTION_BODY_LIMIT_MB + 1) }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.key === "MAX_UPLOAD_MB")).toBe(true);
    expect(result.issues.find((i) => i.key === "MAX_UPLOAD_MB")?.message).toMatch(
      /server-action body limit/i,
    );
  });

  it("defaults to the server-action body limit rather than a larger promise", () => {
    const result = parseEnv(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.MAX_UPLOAD_MB).toBe(SERVER_ACTION_BODY_LIMIT_MB);
  });
});

describe("paired requirements", () => {
  it("refuses s3 storage with no bucket or credentials", () => {
    const result = parseEnv(base({ STORAGE_DRIVER: "s3" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const keys = result.issues.map((i) => i.key);
    expect(keys).toContain("S3_BUCKET");
    expect(keys).toContain("S3_ACCESS_KEY_ID");
    expect(keys).toContain("S3_SECRET_ACCESS_KEY");
  });

  it("accepts s3 storage once it is fully configured", () => {
    const result = parseEnv(
      base({
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "historia-media",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses live publishing without a token encryption key", () => {
    const result = parseEnv(base({ PUBLISHING_MODE: "live" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.key === "TOKEN_ENCRYPTION_KEY")).toBe(true);
  });

  it("refuses a paid narration provider with no API key", () => {
    const result = parseEnv(base({ TTS_PROVIDER: "elevenlabs" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.key === "ELEVENLABS_API_KEY")).toBe(true);
  });

  it("refuses a session secret too short to sign a cookie safely", () => {
    const result = parseEnv(base({ SESSION_SECRET: "too-short" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.key === "SESSION_SECRET")).toBe(true);
  });
});
