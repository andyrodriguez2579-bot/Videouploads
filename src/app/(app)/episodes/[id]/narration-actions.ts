"use server";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { episodes, voiceovers } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { buildObjectKey, getStorage } from "@/lib/storage";

/** Container formats ffmpeg reads reliably and browsers can preview. */
const NARRATION_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

function extensionOf(filename: string): string {
  return path.extname(filename).replace(".", "").toLowerCase();
}

/**
 * Reads a duration out of an audio file. Done at upload time rather than at
 * render time because the scene plan is fitted to it — the operator needs to
 * see the number while they are still editing, not discover it in the output.
 */
async function probeDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(getEnv().FFPROBE_PATH, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const parsed = Number.parseFloat(out.trim());
      resolve(Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : null);
    });
  });
}

export async function uploadNarrationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!canEdit(user.role)) return { error: "Your role does not allow uploading narration." };

  const episodeId = String(formData.get("episodeId") ?? "");
  if (!episodeId) return { error: "No episode was given." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { fields: { file: "Choose an audio file." } };
  }

  const extension = extensionOf(file.name);
  if (!NARRATION_EXTENSIONS.includes(extension)) {
    return {
      fields: {
        file: `Narration must be one of: ${NARRATION_EXTENSIONS.join(", ")}.`,
      },
    };
  }

  const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return { fields: { file: `That file is larger than the ${getEnv().MAX_UPLOAD_MB} MB limit.` } };
  }

  const [episode] = await db
    .select({ id: episodes.id, language: episodes.language })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!episode) return { error: "That episode no longer exists." };

  const body = Buffer.from(await file.arrayBuffer());

  // Probed from a temp copy: the storage driver may be S3, where there is no
  // local path for ffprobe to read.
  const workDir = await mkdtemp(path.join(tmpdir(), "historia-narration-"));
  let durationSeconds: number | null = null;
  try {
    const probePath = path.join(workDir, `narration.${extension}`);
    await writeFile(probePath, body);
    durationSeconds = await probeDurationSeconds(probePath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const stored = await getStorage().put({
    key: buildObjectKey({
      scope: "episodes",
      scopeId: episodeId,
      category: "narration",
      filename: file.name,
    }),
    body,
    contentType: file.type || undefined,
  });

  // One selected full-episode narration at a time: the mix takes exactly one
  // track, and leaving two selected would make which one silently arbitrary.
  await db
    .update(voiceovers)
    .set({ isSelected: false, updatedAt: new Date() })
    .where(and(eq(voiceovers.episodeId, episodeId), eq(voiceovers.isSelected, true)));

  const [row] = await db
    .insert(voiceovers)
    .values({
      episodeId,
      source: "upload",
      language: episode.language,
      storageDriver: stored.driver,
      objectKey: stored.key,
      mimeType: file.type || null,
      byteSize: stored.byteSize,
      durationSeconds: durationSeconds === null ? null : String(durationSeconds),
      status: "ready",
      isSelected: true,
      details: { checksumSha256: createHash("sha256").update(body).digest("hex") },
      createdBy: user.id,
    })
    .returning();

  await recordAudit({
    actor: user,
    action: "narration.upload",
    entityType: "voiceover",
    entityId: row?.id ?? null,
    episodeId,
    summary: `Uploaded narration "${file.name}"${
      durationSeconds === null ? "" : ` (${durationSeconds.toFixed(1)}s)`
    }`,
  });

  revalidatePath(`/episodes/${episodeId}`);

  return {
    ok: true,
    message:
      durationSeconds === null
        ? "Narration uploaded. Its duration could not be read, so the scene plan was not fitted to it."
        : `Narration uploaded (${durationSeconds.toFixed(1)}s). The next render will mix it in.`,
  };
}

export async function selectNarrationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow changing narration.");

  const episodeId = String(formData.get("episodeId") ?? "");
  const voiceoverId = String(formData.get("voiceoverId") ?? "");
  if (!episodeId || !voiceoverId) return;

  await db
    .update(voiceovers)
    .set({ isSelected: false, updatedAt: new Date() })
    .where(eq(voiceovers.episodeId, episodeId));
  await db
    .update(voiceovers)
    .set({ isSelected: true, updatedAt: new Date() })
    .where(eq(voiceovers.id, voiceoverId));

  await recordAudit({
    actor: user,
    action: "narration.select",
    entityType: "voiceover",
    entityId: voiceoverId,
    episodeId,
    summary: "Selected the narration used for rendering",
  });

  revalidatePath(`/episodes/${episodeId}`);
}
