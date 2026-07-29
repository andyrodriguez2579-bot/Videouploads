"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { importAssetFromUrl } from "@/server/asset-import";

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
