import "server-only";

import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { PutObjectInput, StorageDriver, StoredObject } from "./types";

export interface S3DriverConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
}

/** Works against Amazon S3, Cloudflare R2, and MinIO via the endpoint option. */
export class S3StorageDriver implements StorageDriver {
  readonly name = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3DriverConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const body = Buffer.from(input.body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
      }),
    );
    return {
      key: input.key,
      driver: this.name,
      byteSize: body.byteLength,
      checksumSha256: createHash("sha256").update(body).digest("hex"),
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object not found in bucket: ${key}`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async url(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
