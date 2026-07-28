import "server-only";

import path from "node:path";

import { getEnv } from "@/lib/env";

import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import type { StorageDriver } from "./types";

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const env = getEnv();

  if (env.STORAGE_DRIVER === "s3") {
    cached = new S3StorageDriver({
      // env validation guarantees these are set when the driver is s3.
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    });
  } else {
    cached = new LocalStorageDriver(path.resolve(process.cwd(), env.LOCAL_STORAGE_PATH));
  }

  return cached;
}

/**
 * Builds a collision-free, traversal-free object key. The original filename is
 * kept as a readable suffix so the asset library is browsable on disk, but it
 * is sanitised — uploads are user input.
 */
export function buildObjectKey(parts: {
  scope: string;
  scopeId: string;
  category: string;
  filename: string;
}): string {
  const safeName =
    parts.filename
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[._]+/, "")
      .slice(-120) || "file";
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${parts.scope}/${parts.scopeId}/${parts.category}/${stamp}-${rand}-${safeName}`;
}

export type { StorageDriver, StoredObject } from "./types";
