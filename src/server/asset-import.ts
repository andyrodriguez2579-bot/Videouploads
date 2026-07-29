import "server-only";

import { createHash } from "node:crypto";

import { db } from "@/db/client";
import { assetLicenses, mediaAssets } from "@/db/schema";
import { inferLicenseType, type RemoteAsset } from "@/domain/asset-source";
import { downloadImage, resolveAssetUrl } from "@/lib/sources";
import { buildObjectKey, getStorage } from "@/lib/storage";

/**
 * Importing an archival image by URL.
 *
 * The point is the licence record, not the file. Downloading an image is easy;
 * what makes forty images an episode sustainable is that the archive's own
 * metadata — creator, date, rights wording, catalogue reference — lands in the
 * record instead of being retyped, and lands there *verbatim*.
 *
 * The licence is always created uncleared. The archive told us what it believes
 * about the item; it did not tell us the rights are cleared for this use, and
 * public-domain status varies by jurisdiction. Approval stays blocked until a
 * person ticks the box, which is exactly the gate this app exists to enforce.
 */

export interface ImportedAsset {
  assetId: string;
  licenseId: string;
  title: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  /** Things the operator should know before using it. */
  warnings: string[];
}

/** Below this, a still cannot fill a 1080p frame without visible softening. */
const MIN_USABLE_EDGE = 1280;
/** Comfortable for a Ken Burns push without going soft. */
const COMFORTABLE_EDGE = 2400;

export async function previewAssetUrl(rawUrl: string): Promise<RemoteAsset> {
  return resolveAssetUrl(rawUrl.trim());
}

export async function importAssetFromUrl(input: {
  url: string;
  userId: string;
  episodeId?: string | null;
}): Promise<ImportedAsset> {
  const asset = await resolveAssetUrl(input.url.trim());
  const image = await downloadImage(asset);

  const warnings: string[] = [];
  const shortEdge = Math.min(asset.width ?? Number.POSITIVE_INFINITY, asset.height ?? Number.POSITIVE_INFINITY);
  if (Number.isFinite(shortEdge)) {
    if (shortEdge < MIN_USABLE_EDGE) {
      warnings.push(
        `This image is ${asset.width}×${asset.height}. It will look soft filling a 1080p frame — ` +
          `look for a larger rendition if the archive offers one.`,
      );
    } else if (shortEdge < COMFORTABLE_EDGE) {
      warnings.push(
        `At ${asset.width}×${asset.height} this is fine held static, but will soften if a ` +
          `Ken Burns move pushes into it.`,
      );
    }
  }

  if (!asset.rightsStatement) {
    warnings.push(
      "The archive gave no rights statement, so the licence has been left as unknown. " +
        "Fill it in from the source page before this asset can clear approval.",
    );
  }

  const stored = await getStorage().put({
    key: buildObjectKey({
      scope: input.episodeId ? "episodes" : "library",
      scopeId: input.episodeId ?? "shared",
      category: "image",
      filename: image.filename,
    }),
    body: image.body,
    contentType: image.mimeType,
  });

  // Attribution text is assembled now, while the metadata is in hand — it is
  // what goes on screen or in the description, and reconstructing it later from
  // a URL is exactly the chore this import exists to remove.
  const attribution = [asset.creator, asset.date, asset.rightsHolder]
    .filter(Boolean)
    .join(", ");

  const [license] = await db
    .insert(assetLicenses)
    .values({
      name: asset.title.slice(0, 200),
      licenseType: inferLicenseType(asset.licenseName),
      // Never cleared on import. A person decides that, having looked.
      isCleared: false,
      requiresAttribution: asset.attributionRequired,
      attributionText: attribution || null,
      rightsHolder: asset.rightsHolder,
      sourceUrl: asset.sourceUrl,
      notes: [
        asset.rightsStatement ? `Archive rights statement: ${asset.rightsStatement}` : null,
        asset.archiveReference ? `Reference: ${asset.archiveReference}` : null,
        `Imported from ${asset.provider} on ${new Date().toISOString().slice(0, 10)}.`,
        "Rights NOT verified — confirm on the source page before clearing.",
      ]
        .filter(Boolean)
        .join("\n"),
      createdBy: input.userId,
    })
    .returning();

  if (!license) throw new Error("Could not create the licence record.");

  const [row] = await db
    .insert(mediaAssets)
    .values({
      episodeId: input.episodeId ?? null,
      licenseId: license.id,
      kind: "image",
      title: asset.title.slice(0, 200),
      description: asset.date ? `${asset.date}` : null,
      creditLine: attribution || null,
      storageDriver: stored.driver,
      objectKey: stored.key,
      mimeType: image.mimeType,
      byteSize: stored.byteSize,
      width: asset.width,
      height: asset.height,
      checksumSha256: createHash("sha256").update(image.body).digest("hex"),
      createdBy: input.userId,
    })
    .returning();

  if (!row) throw new Error("Could not create the asset record.");

  return {
    assetId: row.id,
    licenseId: license.id,
    title: asset.title,
    width: asset.width,
    height: asset.height,
    byteSize: stored.byteSize,
    warnings,
  };
}
