"use server";

import path from "node:path";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { captions } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { generateCaptions, importCaptions } from "@/server/captions";

const SUBTITLE_EXTENSIONS = ["srt", "vtt"];

export async function generateCaptionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!canEdit(user.role)) return { error: "Your role does not allow generating subtitles." };

    const episodeId = String(formData.get("episodeId") ?? "");
    if (!episodeId) return { error: "No episode was given." };

    const { captionId, review } = await generateCaptions({ episodeId, userId: user.id });

    await recordAudit({
      actor: user,
      action: "captions.generate",
      entityType: "caption",
      entityId: captionId,
      episodeId,
      summary: `Generated ${review.cueCount} subtitle cue(s) from the scene plan`,
    });

    revalidatePath(`/episodes/${episodeId}`);

    return {
      ok: true,
      message:
        `Generated ${review.cueCount} cue(s) from the script.` +
        (review.warnings.length > 0 ? ` ${review.warnings.join(" ")}` : "") +
        " Read them through before publishing — nothing marks them reviewed but you.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not generate subtitles." };
  }
}

export async function importCaptionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!canEdit(user.role)) return { error: "Your role does not allow importing subtitles." };

    const episodeId = String(formData.get("episodeId") ?? "");
    if (!episodeId) return { error: "No episode was given." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { fields: { file: "Choose an SRT or VTT file." } };
    }

    const extension = path.extname(file.name).replace(".", "").toLowerCase();
    if (!SUBTITLE_EXTENSIONS.includes(extension)) {
      return { fields: { file: `Subtitles must be one of: ${SUBTITLE_EXTENSIONS.join(", ")}.` } };
    }
    if (file.size > getEnv().MAX_UPLOAD_MB * 1024 * 1024) {
      return { fields: { file: "That file is too large." } };
    }

    const { captionId, review } = await importCaptions({
      episodeId,
      userId: user.id,
      filename: file.name,
      source: await file.text(),
    });

    await recordAudit({
      actor: user,
      action: "captions.import",
      entityType: "caption",
      entityId: captionId,
      episodeId,
      summary: `Imported ${review.cueCount} subtitle cue(s) from "${file.name}"`,
    });

    revalidatePath(`/episodes/${episodeId}`);

    return { ok: true, message: `Imported ${review.cueCount} cue(s) from ${file.name}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not import subtitles." };
  }
}

/**
 * Marks a caption set as checked by a person.
 *
 * Generated cues are machine-timed from the script: the words are right by
 * construction, but where they break and how long they hold are not judgements
 * a machine should be trusted to sign off.
 */
export async function reviewCaptionsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow reviewing subtitles.");

  const episodeId = String(formData.get("episodeId") ?? "");
  const captionId = String(formData.get("captionId") ?? "");
  if (!episodeId || !captionId) return;

  await db
    .update(captions)
    .set({ humanReviewed: true, updatedAt: new Date() })
    .where(eq(captions.id, captionId));

  await recordAudit({
    actor: user,
    action: "captions.review",
    entityType: "caption",
    entityId: captionId,
    episodeId,
    summary: "Marked subtitles as checked by a human",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function deleteCaptionsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow deleting subtitles.");

  const episodeId = String(formData.get("episodeId") ?? "");
  const captionId = String(formData.get("captionId") ?? "");
  if (!episodeId || !captionId) return;

  await db.delete(captions).where(eq(captions.id, captionId));

  await recordAudit({
    actor: user,
    action: "captions.delete",
    entityType: "caption",
    entityId: captionId,
    episodeId,
    summary: "Deleted a subtitle set",
  });

  revalidatePath(`/episodes/${episodeId}`);
}
