import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { PutObjectInput, StorageDriver, StoredObject } from "./types";

/**
 * Filesystem-backed storage. This is the zero-cost default for local
 * development and for a single-box deployment.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;

  constructor(private readonly root: string) {}

  /**
   * Resolves a key inside the storage root and refuses anything that escapes
   * it. Keys reach this from user-supplied filenames, so traversal has to be
   * blocked here rather than trusted upstream.
   */
  private resolve(key: string): string {
    const normalised = path.normalize(key).replace(/^([/\\])+/, "");
    const full = path.resolve(this.root, normalised);
    const rootResolved = path.resolve(this.root);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      throw new Error(`Refusing to access a storage key outside the storage root: ${key}`);
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const full = this.resolve(input.key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const body = Buffer.from(input.body);
    await fs.writeFile(full, body);
    return {
      key: input.key,
      driver: this.name,
      byteSize: body.byteLength,
      checksumSha256: createHash("sha256").update(body).digest("hex"),
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async url(key: string): Promise<string> {
    // Served by src/app/api/files/[...key]/route.ts, which re-checks auth.
    return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}
