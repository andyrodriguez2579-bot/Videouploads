"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { importAssetFromUrl } from "@/server/asset-import";
import { listWikimediaCategory } from "@/lib/sources";
import type { CategoryListing } from "@/domain/asset-source";

export interface CategoryBrowseState extends ActionState {
  listing?: CategoryListing;
  categoryUrl?: string;
  episodeId?: string;
}

/**
 * Lists a Commons category so images can be picked from it.
 *
 * Nothing is downloaded here — this is the look-before-importing step, and each
 * file still goes through the ordinary import, licence record and all.
 */
export async function browseCategoryAction(
  _prev: CategoryBrowseState,
  formData: FormData,
): Promise<CategoryBrowseState> {
  const user = await requireUser();
  if (!canEdit(user.role)) return { error: "Your role does not allow importing assets." };

  const categoryUrl = String(formData.get("categoryUrl") ?? "").trim();
  const episodeId = String(formData.get("episodeId") ?? "");
  if (!categoryUrl) return { fields: { categoryUrl: "Paste a Commons category URL." } };

  try {
    const listing = await listWikimediaCategory(categoryUrl);
    return {
      listing,
      categoryUrl,
      episodeId,
      ok: true,
      message:
        listing.files.length === 0
          ? "That category holds no files directly. Try one of its sub-categories."
          : `${listing.files.length} file(s)${listing.truncated ? " (first page)" : ""}.`,
    };
  } catch (error) {
    return {
      categoryUrl,
      episodeId,
      error: error instanceof Error ? error.message : "Could not read that category.",
    };
  }
}

/**
 * Imports several Commons files in one go.
 *
 * Sequential on purpose: these are multi-megabyte archive masters, and firing
 * a dozen downloads at once would both spike memory and hammer an API whose
 * policy asks callers not to. One failure does not abandon the rest — the
 * summary says which ones did not make it.
 */
export async function importSelectedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!canEdit(user.role)) return { error: "Your role does not allow importing assets." };

  const urls = formData.getAll("url").map(String).filter(Boolean);
  if (urls.length === 0) return { error: "Tick at least one image to import." };

  const episodeId = String(formData.get("episodeId") ?? "") || null;

  const imported: string[] = [];
  const failed: string[] = [];

  for (const url of urls) {
    try {
      const result = await importAssetFromUrl({ url, userId: user.id, episodeId });
      imported.push(result.title);
      await recordAudit({
        actor: user,
        action: "asset.import",
        entityType: "media_asset",
        entityId: result.assetId,
        episodeId,
        summary: `Imported "${result.title}" from ${url}`,
      });
    } catch (error) {
      failed.push(`${url.split("/").pop() ?? url} (${error instanceof Error ? error.message : "failed"})`);
    }
  }

  revalidatePath("/assets");
  if (episodeId) revalidatePath(`/episodes/${episodeId}`);

  if (imported.length === 0) {
    return { error: `Nothing imported. ${failed.join("; ")}` };
  }

  return {
    ok: true,
    message:
      `Imported ${imported.length} image(s). Every licence is NOT cleared — check the ` +
      `rights on each source page and tick them before these can pass approval.` +
      (failed.length > 0 ? ` Skipped: ${failed.join("; ")}` : ""),
  };
}

export async function importAssetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!canEdit(user.role)) return { error: "Your role does not allow importing assets." };

    const url = String(formData.get("url") ?? "").trim();
    if (!url) return { fields: { url: "Paste a URL." } };

    const episodeId = String(formData.get("episodeId") ?? "") || null;

    const result = await importAssetFromUrl({ url, userId: user.id, episodeId });

    await recordAudit({
      actor: user,
      action: "asset.import",
      entityType: "media_asset",
      entityId: result.assetId,
      episodeId,
      summary: `Imported "${result.title}" from ${url}`,
    });

    revalidatePath("/assets");
    if (episodeId) revalidatePath(`/episodes/${episodeId}`);

    const size =
      result.width && result.height ? ` (${result.width}×${result.height})` : "";

    return {
      ok: true,
      message:
        `Imported "${result.title}"${size} with a licence record from the archive. ` +
        `The licence is NOT cleared — check the rights on the source page and tick it ` +
        `before this asset can pass approval.` +
        (result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not import that URL." };
  }
}
