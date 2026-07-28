/**
 * Storage provider interface.
 *
 * Two drivers ship: `local` (plain filesystem, the development default, costs
 * nothing) and `s3` (any S3-compatible bucket — Amazon S3, Cloudflare R2,
 * MinIO). Callers only ever see object keys, never filesystem paths or bucket
 * URLs, so an episode's assets can be migrated between drivers later.
 */

export type StorageDriverName = "local" | "s3";

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
}

export interface StoredObject {
  key: string;
  driver: StorageDriverName;
  byteSize: number;
  checksumSha256: string;
  contentType?: string;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * A URL the browser can load. Local storage returns an app route; S3 returns
   * a presigned URL (or a public base URL when one is configured).
   */
  url(key: string, expiresInSeconds?: number): Promise<string>;
}
