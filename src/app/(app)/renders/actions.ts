"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { renders } from "@/db/schema";
import { ASPECT_RATIOS, type AspectRatio } from "@/domain/render";
import type { RenderKind } from "@/domain/types";
import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { startRender } from "@/server/renders";

function parseAspectRatio(value: FormDataEntryValue | null): AspectRatio | null {
  const raw = String(value ?? "");
  return (ASPECT_RATIOS as readonly string[]).includes(raw) ? (raw as AspectRatio) : null;
}

export async function startRenderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!canEdit(user.role)) return { error: "Your role does not allow starting renders." };

    const episodeId = String(formData.get("episodeId") ?? "");
    if (!episodeId) return { error: "No episode was given." };

    const aspectRatio = parseAspectRatio(formData.get("aspectRatio"));
    if (!aspectRatio) return { fields: { aspectRatio: "Choose an aspect ratio." } };

    // A vertical cut is a short by definition; that is the frame it publishes in.
    const kind: RenderKind = aspectRatio === "9:16" ? "short_form" : "long_form";

    const { renderId } = await startRender({ episodeId, kind, aspectRatio });

    await recordAudit({
      actor: user,
      action: "render.start",
      entityType: "render",
      entityId: renderId,
      episodeId,
      summary: `Started a ${aspectRatio} ${kind.replace("_", " ")} render`,
    });

    revalidatePath(`/episodes/${episodeId}`);
    revalidatePath("/renders");

    return {
      ok: true,
      message: "Render started. Progress appears below and in the render centre.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start the render." };
  }
}

export async function deleteRenderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow deleting renders.");

  const renderId = String(formData.get("renderId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  const [render] = await db.select().from(renders).where(eq(renders.id, renderId)).limit(1);
  if (!render) return;

  // The row is deleted first: it is the record of truth, and an orphaned object
  // is harmless where a row pointing at a deleted file is not.
  await db.delete(renders).where(eq(renders.id, renderId));

  if (render.objectKey) {
    try {
      const { getStorage } = await import("@/lib/storage");
      await getStorage().delete(render.objectKey);
    } catch (error) {
      console.error("[renders] failed to delete stored output", {
        key: render.objectKey,
        error,
      });
    }
  }

  await recordAudit({
    actor: user,
    action: "render.delete",
    entityType: "render",
    entityId: renderId,
    episodeId: episodeId || render.episodeId,
    summary: `Deleted a ${render.aspectRatio} render`,
  });

  revalidatePath(`/episodes/${episodeId || render.episodeId}`);
  revalidatePath("/renders");
}
