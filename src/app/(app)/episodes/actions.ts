"use server";

import { createHash } from "node:crypto";

import { and, eq, sql as raw } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import {
  episodes,
  episodeVersions,
  mediaAssets,
  researchSources,
  sceneAssets,
  sceneSources,
  scenes,
} from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canApprove, canEdit, requireUser } from "@/lib/auth/session";
import {
  episodeCreateSchema,
  episodeUpdateSchema,
  fieldErrors,
  researchSourceSchema,
  sceneSchema,
  scriptSaveSchema,
  slugify,
  transitionSchema,
} from "@/lib/validation";
import { evaluateTransition } from "@/domain/workflow";
import { getReadiness } from "@/server/episodes";

function formObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

async function assertEditor() {
  const user = await requireUser();
  if (!canEdit(user.role)) {
    throw new Error("Your role does not allow editing. Ask the owner for editor access.");
  }
  return user;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hashScript(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export async function createEpisodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let episodeId: string;

  try {
    const user = await assertEditor();
    const parsed = episodeCreateSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const data = parsed.data;
    const slug = data.slug ?? slugify(data.title);
    if (!slug) return { fields: { title: "Could not derive a URL slug from this title." } };

    const [created] = await db
      .insert(episodes)
      .values({
        seriesId: data.seriesId,
        title: data.title,
        slug,
        episodeNumber: data.episodeNumber ?? null,
        synopsis: data.synopsis ?? null,
        language: data.language,
        primaryFormat: data.primaryFormat,
        periodLabel: data.periodLabel ?? null,
        periodStartYear: data.periodStartYear ?? null,
        periodEndYear: data.periodEndYear ?? null,
        narrationMode: data.narrationMode,
        captionMode: data.captionMode,
        scenePlanMode: data.scenePlanMode,
        publishMode: data.publishMode,
        targetDurationSeconds: data.targetDurationSeconds ?? null,
        createdBy: user.id,
      })
      .returning();

    if (!created) return { error: "Could not create the episode." };

    await recordAudit({
      actor: user,
      action: "episode.create",
      entityType: "episode",
      entityId: created.id,
      episodeId: created.id,
      summary: `Created episode "${created.title}"`,
      after: { title: created.title, status: created.status },
    });

    episodeId = created.id;
  } catch (error) {
    return { error: toMessage(error, "Could not create the episode.") };
  }

  // redirect() throws by design; keep it out of the try/catch above.
  redirect(`/episodes/${episodeId}`);
}

export async function updateEpisodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await assertEditor();
    const parsed = episodeUpdateSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const { id, ...rest } = parsed.data;
    const [before] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!before) return { error: "Episode not found." };

    const [after] = await db
      .update(episodes)
      .set({
        ...(rest.title !== undefined ? { title: rest.title } : {}),
        ...(rest.synopsis !== undefined ? { synopsis: rest.synopsis } : {}),
        ...(rest.episodeNumber !== undefined ? { episodeNumber: rest.episodeNumber } : {}),
        ...(rest.periodLabel !== undefined ? { periodLabel: rest.periodLabel } : {}),
        ...(rest.periodStartYear !== undefined ? { periodStartYear: rest.periodStartYear } : {}),
        ...(rest.periodEndYear !== undefined ? { periodEndYear: rest.periodEndYear } : {}),
        ...(rest.narrationMode !== undefined ? { narrationMode: rest.narrationMode } : {}),
        ...(rest.captionMode !== undefined ? { captionMode: rest.captionMode } : {}),
        ...(rest.scenePlanMode !== undefined ? { scenePlanMode: rest.scenePlanMode } : {}),
        ...(rest.publishMode !== undefined ? { publishMode: rest.publishMode } : {}),
        ...(rest.targetDurationSeconds !== undefined
          ? { targetDurationSeconds: rest.targetDurationSeconds }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, id))
      .returning();

    await recordAudit({
      actor: user,
      action: "episode.update",
      entityType: "episode",
      entityId: id,
      episodeId: id,
      summary: `Updated episode details for "${before.title}"`,
      before: { title: before.title, narrationMode: before.narrationMode },
      after: { title: after?.title, narrationMode: after?.narrationMode },
    });

    revalidatePath(`/episodes/${id}`);
    return { ok: true, message: "Episode details saved." };
  } catch (error) {
    return { error: toMessage(error, "Could not save the episode.") };
  }
}

/**
 * Creates the other-language version of an episode.
 *
 * A translation is its own episode row with its own approval — a translation
 * can be wrong in ways the original is not, so it must be signed off separately.
 * The scene plan and research sources are COPIED (so the translator has the
 * structure and the citations to work from), while media assets stay shared:
 * the same archival still is the same file in both languages, and duplicating
 * it would duplicate the licence obligation too.
 *
 * The script itself is deliberately NOT copied. It starts empty so nobody can
 * mistake an untranslated Spanish script for an approved English one.
 */
export async function createTranslationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newEpisodeId: string;

  try {
    const user = await assertEditor();
    const sourceId = String(formData.get("episodeId") ?? "");
    const language = String(formData.get("language") ?? "");

    if (language !== "es" && language !== "en") {
      return { error: "Choose either Spanish or English." };
    }

    const [source] = await db.select().from(episodes).where(eq(episodes.id, sourceId)).limit(1);
    if (!source) return { error: "Episode not found." };

    if (source.translationOfId) {
      return {
        error:
          "This episode is already a translation. Create further languages from the original episode.",
      };
    }
    if (source.language === language) {
      return { error: `This episode is already in ${language === "es" ? "Spanish" : "English"}.` };
    }

    const created = await db.transaction(async (tx) => {
      const [episode] = await tx
        .insert(episodes)
        .values({
          seriesId: source.seriesId,
          episodeNumber: source.episodeNumber,
          slug: `${source.slug}-${language}`,
          title: source.title,
          synopsis: source.synopsis,
          language,
          translationOfId: source.id,
          primaryFormat: source.primaryFormat,
          periodLabel: source.periodLabel,
          periodStartYear: source.periodStartYear,
          periodEndYear: source.periodEndYear,
          narrationMode: source.narrationMode,
          captionMode: source.captionMode,
          scenePlanMode: source.scenePlanMode,
          publishMode: source.publishMode,
          targetDurationSeconds: source.targetDurationSeconds,
          // Always starts as a draft, whatever state the original is in.
          status: "draft",
          createdBy: user.id,
        })
        .returning();

      if (!episode) throw new Error("Could not create the translation.");

      // Copy sources, keeping their fact-check state: the underlying research
      // is the same regardless of the language it is narrated in.
      await tx.execute(raw`
        insert into research_sources (
          episode_id, citation, source_type, author, publisher, publication_year,
          url, archive_reference, supports_claim, page_reference, verification,
          verified_by, verified_at, notes
        )
        select ${episode.id}, citation, source_type, author, publisher, publication_year,
               url, archive_reference, supports_claim, page_reference, verification,
               verified_by, verified_at, notes
        from research_sources where episode_id = ${source.id}
      `);

      // Copy the scene skeleton — headings, templates, timings and visual
      // direction carry over; the narration text does not, since that is the
      // part that must actually be translated.
      await tx.execute(raw`
        insert into scenes (
          episode_id, position, heading, on_screen_text, visual_direction,
          template, estimated_seconds, is_ai_suggested, human_reviewed, notes
        )
        select ${episode.id}, position, heading, on_screen_text, visual_direction,
               template, estimated_seconds, false, true, notes
        from scenes where episode_id = ${source.id}
      `);

      return episode;
    });

    await recordAudit({
      actor: user,
      action: "episode.create_translation",
      entityType: "episode",
      entityId: created.id,
      episodeId: created.id,
      summary: `Created the ${language === "es" ? "Spanish" : "English"} version of "${source.title}"`,
      after: { translationOfId: source.id, language },
    });

    newEpisodeId = created.id;
  } catch (error) {
    return { error: toMessage(error, "Could not create the translation.") };
  }

  redirect(`/episodes/${newEpisodeId}?tab=script`);
}

// ---------------------------------------------------------------------------
// Script versions
// ---------------------------------------------------------------------------

/**
 * Saving a script always writes a NEW immutable version row. Existing versions
 * are never mutated — that is what makes "this is the script the owner
 * approved" provable later. If the body is unchanged, nothing is written.
 */
export async function saveScriptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await assertEditor();
    const parsed = scriptSaveSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const { episodeId, title, scriptBody, scriptFormat, changeNote } = parsed.data;

    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
    if (!episode) return { error: "Episode not found." };
    if (episode.status === "published") {
      return { error: "A published episode's script is locked. Reopen it as a draft first." };
    }

    const hash = hashScript(scriptBody);

    const result = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select()
        .from(episodeVersions)
        .where(eq(episodeVersions.episodeId, episodeId))
        .orderBy(raw`${episodeVersions.versionNumber} desc`)
        .limit(1);

      if (latest && latest.contentHash === hash && latest.title === title) {
        return { unchanged: true as const, version: latest };
      }

      const [version] = await tx
        .insert(episodeVersions)
        .values({
          episodeId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          title,
          scriptBody,
          scriptFormat,
          wordCount: wordCount(scriptBody),
          contentHash: hash,
          authorship: "human",
          changeNote: changeNote ?? null,
          createdBy: user.id,
        })
        .returning();

      // Editing the script after approval invalidates that approval: the
      // approved text no longer matches what is on screen.
      if (episode.status === "approved" || episode.status === "scheduled") {
        await tx
          .update(episodes)
          .set({
            status: "draft",
            approvedVersionId: null,
            approvedBy: null,
            approvedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(episodes.id, episodeId));
      } else {
        await tx.update(episodes).set({ updatedAt: new Date() }).where(eq(episodes.id, episodeId));
      }

      return { unchanged: false as const, version, revoked: episode.status === "approved" || episode.status === "scheduled" };
    });

    if (result.unchanged) {
      return { ok: true, message: "No changes to save — the script is identical to the latest version." };
    }

    await recordAudit({
      actor: user,
      action: "script.save_version",
      entityType: "episode_version",
      entityId: result.version?.id,
      episodeId,
      summary: `Saved script version ${result.version?.versionNumber}${changeNote ? ` — ${changeNote}` : ""}`,
      after: { versionNumber: result.version?.versionNumber, contentHash: hash },
    });

    revalidatePath(`/episodes/${episodeId}`);
    return {
      ok: true,
      message: `Saved as version ${result.version?.versionNumber}.`,
      warnings: result.revoked
        ? ["The previous approval was withdrawn because the script changed. Resubmit for review."]
        : undefined,
    };
  } catch (error) {
    return { error: toMessage(error, "Could not save the script.") };
  }
}

/** Restores an old version by copying it forward as a new version. */
export async function restoreVersionAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const versionId = String(formData.get("versionId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  const [source] = await db
    .select()
    .from(episodeVersions)
    .where(and(eq(episodeVersions.id, versionId), eq(episodeVersions.episodeId, episodeId)))
    .limit(1);
  if (!source) throw new Error("Version not found.");

  await db.transaction(async (tx) => {
    const [latest] = await tx
      .select()
      .from(episodeVersions)
      .where(eq(episodeVersions.episodeId, episodeId))
      .orderBy(raw`${episodeVersions.versionNumber} desc`)
      .limit(1);

    await tx.insert(episodeVersions).values({
      episodeId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      title: source.title,
      scriptBody: source.scriptBody,
      scriptFormat: source.scriptFormat,
      wordCount: source.wordCount,
      contentHash: source.contentHash,
      authorship: source.authorship,
      changeNote: `Restored from version ${source.versionNumber}`,
      createdBy: user.id,
    });
  });

  await recordAudit({
    actor: user,
    action: "script.restore_version",
    entityType: "episode_version",
    entityId: versionId,
    episodeId,
    summary: `Restored script version ${source.versionNumber}`,
  });

  revalidatePath(`/episodes/${episodeId}`);
}

// ---------------------------------------------------------------------------
// Research sources
// ---------------------------------------------------------------------------

export async function addSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await assertEditor();
    const parsed = researchSourceSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const data = parsed.data;
    const [created] = await db
      .insert(researchSources)
      .values({
        episodeId: data.episodeId,
        citation: data.citation,
        sourceType: data.sourceType,
        author: data.author ?? null,
        publisher: data.publisher ?? null,
        publicationYear: data.publicationYear ?? null,
        url: data.url || null,
        archiveReference: data.archiveReference ?? null,
        supportsClaim: data.supportsClaim ?? null,
        pageReference: data.pageReference ?? null,
        // Verification is always recorded by an explicit action, never on create.
        verification: "unverified",
        notes: data.notes ?? null,
      })
      .returning();

    await recordAudit({
      actor: user,
      action: "source.add",
      entityType: "research_source",
      entityId: created?.id,
      episodeId: data.episodeId,
      summary: `Added source: ${data.citation.slice(0, 120)}`,
    });

    revalidatePath(`/episodes/${data.episodeId}`);
    return { ok: true, message: "Source added. Mark it verified once you have checked it." };
  } catch (error) {
    return { error: toMessage(error, "Could not add the source.") };
  }
}

export async function setSourceVerificationAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sourceId = String(formData.get("sourceId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");
  const verification = String(formData.get("verification") ?? "unverified") as
    | "unverified"
    | "verified"
    | "disputed"
    | "rejected";

  await db
    .update(researchSources)
    .set({
      verification,
      verifiedBy: verification === "verified" ? user.id : null,
      verifiedAt: verification === "verified" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(researchSources.id, sourceId), eq(researchSources.episodeId, episodeId)));

  await recordAudit({
    actor: user,
    action: "source.set_verification",
    entityType: "research_source",
    entityId: sourceId,
    episodeId,
    summary: `Marked source as ${verification}`,
    after: { verification },
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function deleteSourceAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sourceId = String(formData.get("sourceId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  const [removed] = await db
    .delete(researchSources)
    .where(and(eq(researchSources.id, sourceId), eq(researchSources.episodeId, episodeId)))
    .returning();

  await recordAudit({
    actor: user,
    action: "source.delete",
    entityType: "research_source",
    entityId: sourceId,
    episodeId,
    summary: `Removed source: ${removed?.citation.slice(0, 120) ?? sourceId}`,
    before: removed ?? undefined,
  });

  revalidatePath(`/episodes/${episodeId}`);
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export async function addSceneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await assertEditor();
    const parsed = sceneSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const data = parsed.data;
    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ next: raw<number>`coalesce(max(${scenes.position}), 0) + 1` })
        .from(scenes)
        .where(eq(scenes.episodeId, data.episodeId));

      return tx
        .insert(scenes)
        .values({
          episodeId: data.episodeId,
          position: Number(row?.next ?? 1),
          heading: data.heading,
          narrationText: data.narrationText ?? null,
          onScreenText: data.onScreenText ?? null,
          visualDirection: data.visualDirection ?? null,
          template: data.template,
          estimatedSeconds: data.estimatedSeconds != null ? String(data.estimatedSeconds) : null,
          notes: data.notes ?? null,
          // Manually authored, so it needs no separate AI review.
          isAiSuggested: false,
          humanReviewed: true,
        })
        .returning();
    });

    await recordAudit({
      actor: user,
      action: "scene.add",
      entityType: "scene",
      entityId: created?.id,
      episodeId: data.episodeId,
      summary: `Added scene "${data.heading}"`,
    });

    revalidatePath(`/episodes/${data.episodeId}`);
    return { ok: true, message: "Scene added." };
  } catch (error) {
    return { error: toMessage(error, "Could not add the scene.") };
  }
}

export async function updateSceneAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await assertEditor();
    const sceneId = String(formData.get("sceneId") ?? "");
    const parsed = sceneSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const data = parsed.data;
    await db
      .update(scenes)
      .set({
        heading: data.heading,
        narrationText: data.narrationText ?? null,
        onScreenText: data.onScreenText ?? null,
        visualDirection: data.visualDirection ?? null,
        template: data.template,
        estimatedSeconds: data.estimatedSeconds != null ? String(data.estimatedSeconds) : null,
        notes: data.notes ?? null,
        // A human just edited it, so any AI-suggestion flag is now cleared.
        humanReviewed: true,
        updatedAt: new Date(),
      })
      .where(and(eq(scenes.id, sceneId), eq(scenes.episodeId, data.episodeId)));

    await recordAudit({
      actor: user,
      action: "scene.update",
      entityType: "scene",
      entityId: sceneId,
      episodeId: data.episodeId,
      summary: `Edited scene "${data.heading}"`,
    });

    revalidatePath(`/episodes/${data.episodeId}`);
    return { ok: true, message: "Scene saved." };
  } catch (error) {
    return { error: toMessage(error, "Could not save the scene.") };
  }
}

/**
 * Swaps a scene with its neighbour. Both writes happen in one transaction; the
 * (episode_id, position) unique constraint is DEFERRABLE so the intermediate
 * duplicate is tolerated until commit.
 */
export async function moveSceneAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sceneId = String(formData.get("sceneId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");
  const direction = String(formData.get("direction") ?? "up") === "down" ? "down" : "up";

  await db.transaction(async (tx) => {
    await tx.execute(raw`set constraints all deferred`);

    const ordered = await tx
      .select()
      .from(scenes)
      .where(eq(scenes.episodeId, episodeId))
      .orderBy(scenes.position);

    const index = ordered.findIndex((s) => s.id === sceneId);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return;

    const current = ordered[index]!;
    const neighbour = ordered[swapIndex]!;

    await tx.update(scenes).set({ position: neighbour.position }).where(eq(scenes.id, current.id));
    await tx.update(scenes).set({ position: current.position }).where(eq(scenes.id, neighbour.id));
  });

  await recordAudit({
    actor: user,
    action: "scene.reorder",
    entityType: "scene",
    entityId: sceneId,
    episodeId,
    summary: `Moved scene ${direction}`,
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function deleteSceneAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sceneId = String(formData.get("sceneId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.episodeId, episodeId)))
      .returning();
    if (!removed) return;

    // Close the gap so positions stay 1..n.
    await tx.execute(raw`
      with ordered as (
        select id, row_number() over (order by position) as rn
        from scenes where episode_id = ${episodeId}
      )
      update scenes s set position = ordered.rn
      from ordered where ordered.id = s.id
    `);
  });

  await recordAudit({
    actor: user,
    action: "scene.delete",
    entityType: "scene",
    entityId: sceneId,
    episodeId,
    summary: "Deleted a scene",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function markSceneReviewedAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sceneId = String(formData.get("sceneId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  await db
    .update(scenes)
    .set({ humanReviewed: true, updatedAt: new Date() })
    .where(and(eq(scenes.id, sceneId), eq(scenes.episodeId, episodeId)));

  await recordAudit({
    actor: user,
    action: "scene.mark_reviewed",
    entityType: "scene",
    entityId: sceneId,
    episodeId,
    summary: "Cleared an AI-suggested scene after human review",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

// ---------------------------------------------------------------------------
// Scene ↔ asset / source links
// ---------------------------------------------------------------------------

export async function linkSceneAssetAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sceneId = String(formData.get("sceneId") ?? "");
  const assetId = String(formData.get("assetId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");
  if (!assetId) return;

  await db.insert(sceneAssets).values({ sceneId, assetId }).onConflictDoNothing();

  await recordAudit({
    actor: user,
    action: "scene.link_asset",
    entityType: "scene",
    entityId: sceneId,
    episodeId,
    summary: "Attached an asset to a scene",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function unlinkSceneAssetAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const linkId = String(formData.get("linkId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");

  await db.delete(sceneAssets).where(eq(sceneAssets.id, linkId));
  await recordAudit({
    actor: user,
    action: "scene.unlink_asset",
    entityType: "scene_asset",
    entityId: linkId,
    episodeId,
    summary: "Detached an asset from a scene",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function linkSceneSourceAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const sceneId = String(formData.get("sceneId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");
  if (!sourceId) return;

  await db.insert(sceneSources).values({ sceneId, sourceId }).onConflictDoNothing();

  await recordAudit({
    actor: user,
    action: "scene.link_source",
    entityType: "scene",
    entityId: sceneId,
    episodeId,
    summary: "Cited a source on a scene",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

export async function attachAssetToEpisodeAction(formData: FormData): Promise<void> {
  const user = await assertEditor();
  const assetId = String(formData.get("assetId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "");
  if (!assetId) return;

  await db.update(mediaAssets).set({ episodeId, updatedAt: new Date() }).where(eq(mediaAssets.id, assetId));

  await recordAudit({
    actor: user,
    action: "asset.attach_episode",
    entityType: "media_asset",
    entityId: assetId,
    episodeId,
    summary: "Attached a library asset to this episode",
  });

  revalidatePath(`/episodes/${episodeId}`);
}

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

/**
 * The single entry point for status changes. Reads current state, asks the pure
 * workflow rules, and only then writes. Approval additionally pins the exact
 * script version being approved.
 */
export async function transitionEpisodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const parsed = transitionSchema.safeParse(formObject(formData));
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const { episodeId, action, reason } = parsed.data;

    const approvalActions = ["approve", "reject", "schedule", "mark_published"];
    if (approvalActions.includes(action) && !canApprove(user.role)) {
      return {
        error: `Your role (${user.role}) cannot ${action.replace("_", " ")}. Only an owner or reviewer can sign content off.`,
      };
    }
    if (!approvalActions.includes(action) && !canEdit(user.role)) {
      return { error: "Your role does not allow editing." };
    }

    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
    if (!episode) return { error: "Episode not found." };

    const readiness = await getReadiness(episodeId);
    const verdict = evaluateTransition(episode.status, action, readiness);

    if (!verdict.allowed || !verdict.to) {
      return {
        error: "This step is blocked until the items below are resolved.",
        blocked: verdict.errors,
        warnings: verdict.warnings,
      };
    }

    if (action === "reject" && !reason) {
      return { fields: { reason: "Give a reason so the editor knows what to change." } };
    }

    const [latestVersion] = await db
      .select()
      .from(episodeVersions)
      .where(eq(episodeVersions.episodeId, episodeId))
      .orderBy(raw`${episodeVersions.versionNumber} desc`)
      .limit(1);

    await db
      .update(episodes)
      .set({
        status: verdict.to,
        ...(action === "approve"
          ? {
              approvedVersionId: latestVersion?.id ?? null,
              approvedBy: user.id,
              approvedAt: new Date(),
              rejectionReason: null,
            }
          : {}),
        ...(action === "reject" ? { rejectionReason: reason ?? null } : {}),
        // Any move back to draft withdraws the approval record.
        ...(verdict.to === "draft"
          ? { approvedVersionId: null, approvedBy: null, approvedAt: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));

    await recordAudit({
      actor: user,
      action: `episode.${action}`,
      entityType: "episode",
      entityId: episodeId,
      episodeId,
      summary:
        action === "approve"
          ? `Approved "${episode.title}" (script version ${latestVersion?.versionNumber ?? "?"})`
          : `"${episode.title}": ${episode.status} → ${verdict.to}${reason ? ` — ${reason}` : ""}`,
      before: { status: episode.status },
      after: { status: verdict.to, approvedVersionId: action === "approve" ? latestVersion?.id : undefined },
    });

    revalidatePath(`/episodes/${episodeId}`);
    revalidatePath("/review");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: `Episode moved to ${verdict.to.replace("_", " ")}.`,
      warnings: verdict.warnings,
    };
  } catch (error) {
    return { error: toMessage(error, "Could not change the episode status.") };
  }
}

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
