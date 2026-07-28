"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { assetLicenses, mediaAssets } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { buildObjectKey, getStorage } from "@/lib/storage";
import { assetCreateSchema, fieldErrors, licenseSchema } from "@/lib/validation";

/** Extensions accepted per asset kind. Anything else is refused up front. */
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  image: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff"],
  map: ["jpg", "jpeg", "png", "webp", "svg"],
  video: ["mp4", "mov", "mkv", "webm"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
  music: ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
  document: ["pdf", "txt", "md", "srt", "vtt"],
  font: ["ttf", "otf", "woff", "woff2"],
  other: [],
};

function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1]! : "";
}

function formObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

export async function uploadAssetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!canEdit(user.role)) return { error: "Your role does not allow uploading assets." };

    const parsed = assetCreateSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { fields: { file: "Choose a file to upload." } };
    }

    const env = getEnv();
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      return { fields: { file: `File is larger than the ${env.MAX_UPLOAD_MB} MB limit.` } };
    }

    const data = parsed.data;
    const allowed = ALLOWED_EXTENSIONS[data.kind] ?? [];
    const ext = extensionOf(file.name);
    if (allowed.length > 0 && !allowed.includes(ext)) {
      return {
        fields: {
          file: `A "${data.kind}" asset must be one of: ${allowed.join(", ")}.`,
        },
      };
    }

    const episodeId = data.episodeId && data.episodeId !== "" ? data.episodeId : null;
    const key = buildObjectKey({
      scope: episodeId ? "episodes" : "library",
      scopeId: episodeId ?? "shared",
      category: data.kind,
      filename: file.name,
    });

    const storage = getStorage();
    const stored = await storage.put({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || undefined,
    });

    const [created] = await db
      .insert(mediaAssets)
      .values({
        episodeId,
        licenseId: data.licenseId && data.licenseId !== "" ? data.licenseId : null,
        kind: data.kind,
        title: data.title,
        description: data.description ?? null,
        storageDriver: stored.driver,
        objectKey: stored.key,
        mimeType: stored.contentType ?? file.type ?? null,
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
        creditLine: data.creditLine ?? null,
        tags: data.tags,
        createdBy: user.id,
      })
      .returning();

    await recordAudit({
      actor: user,
      action: "asset.upload",
      entityType: "media_asset",
      entityId: created?.id,
      episodeId,
      summary: `Uploaded asset "${data.title}" (${data.kind}, ${stored.byteSize} bytes)`,
      after: { objectKey: stored.key, checksum: stored.checksumSha256 },
    });

    revalidatePath("/assets");
    if (episodeId) revalidatePath(`/episodes/${episodeId}`);

    return {
      ok: true,
      message: data.licenseId
        ? "Asset uploaded."
        : "Asset uploaded. It has no licence attached, so it will block episode approval until you record one.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Upload failed." };
  }
}

export async function createLicenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!canEdit(user.role)) return { error: "Your role does not allow managing licences." };

    const raw = formObject(formData);
    // Unchecked checkboxes are absent from FormData; normalise to booleans.
    raw.isCleared = formData.get("isCleared") === "on";
    raw.requiresAttribution = formData.get("requiresAttribution") === "on";

    const parsed = licenseSchema.safeParse(raw);
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const data = parsed.data;
    const [created] = await db
      .insert(assetLicenses)
      .values({
        name: data.name,
        licenseType: data.licenseType,
        isCleared: data.isCleared,
        requiresAttribution: data.requiresAttribution,
        attributionText: data.attributionText ?? null,
        rightsHolder: data.rightsHolder ?? null,
        sourceUrl: data.sourceUrl || null,
        licenseUrl: data.licenseUrl || null,
        territory: data.territory ?? null,
        notes: data.notes ?? null,
        createdBy: user.id,
      })
      .returning();

    await recordAudit({
      actor: user,
      action: "license.create",
      entityType: "asset_license",
      entityId: created?.id,
      summary: `Recorded licence "${data.name}" (${data.licenseType}, ${data.isCleared ? "cleared" : "NOT cleared"})`,
    });

    revalidatePath("/assets");
    return { ok: true, message: "Licence recorded." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not record the licence." };
  }
}

export async function setAssetLicenseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow managing assets.");

  const assetId = String(formData.get("assetId") ?? "");
  const licenseId = String(formData.get("licenseId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  await db
    .update(mediaAssets)
    .set({ licenseId: licenseId || null, updatedAt: new Date() })
    .where(eq(mediaAssets.id, assetId));

  await recordAudit({
    actor: user,
    action: "asset.set_license",
    entityType: "media_asset",
    entityId: assetId,
    episodeId: episodeId || null,
    summary: licenseId ? "Attached a licence to an asset" : "Cleared the licence from an asset",
  });

  revalidatePath("/assets");
  if (episodeId) revalidatePath(`/episodes/${episodeId}`);
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow deleting assets.");

  const assetId = String(formData.get("assetId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  if (!asset) return;

  await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId));

  // The row is the record of truth; if the object delete fails the orphan is
  // harmless, so it must not fail the request.
  try {
    await getStorage().delete(asset.objectKey);
  } catch (error) {
    console.error("[assets] failed to delete stored object", { key: asset.objectKey, error });
  }

  await recordAudit({
    actor: user,
    action: "asset.delete",
    entityType: "media_asset",
    entityId: assetId,
    episodeId: episodeId || asset.episodeId,
    summary: `Deleted asset "${asset.title}"`,
    before: { title: asset.title, objectKey: asset.objectKey },
  });

  revalidatePath("/assets");
  if (episodeId) revalidatePath(`/episodes/${episodeId}`);
}
