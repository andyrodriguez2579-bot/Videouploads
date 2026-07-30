"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { canEdit, requireUser } from "@/lib/auth/session";
import { importResearchSource, searchLibrary, type CatalogueHit } from "@/server/research-import";

export interface LibrarySearchState extends ActionState {
  hits?: CatalogueHit[];
  query?: string;
}

export async function searchLibraryAction(
  _prev: LibrarySearchState,
  formData: FormData,
): Promise<LibrarySearchState> {
  const user = await requireUser();
  if (!canEdit(user.role)) return { error: "Your role does not allow adding sources." };

  const query = String(formData.get("query") ?? "").trim();
  if (!query) return { fields: { query: "Type something to search for." } };

  try {
    const hits = await searchLibrary(query);
    return {
      hits,
      query,
      ok: true,
      message:
        hits.length === 0
          ? `Nothing found for "${query}" in the national library catalogue.`
          : `${hits.length} result(s) for "${query}".`,
    };
  } catch (error) {
    return {
      query,
      error:
        error instanceof Error
          ? `Could not reach the library catalogue: ${error.message}`
          : "Could not reach the library catalogue.",
    };
  }
}

export async function addLibrarySourceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEdit(user.role)) throw new Error("Your role does not allow adding sources.");

  const episodeId = String(formData.get("episodeId") ?? "");
  const catalogueId = String(formData.get("catalogueId") ?? "");
  if (!episodeId || !catalogueId) return;

  const result = await importResearchSource({
    episodeId,
    catalogueId,
    supportsClaim: String(formData.get("supportsClaim") ?? "") || null,
  });

  if (!result.alreadyPresent) {
    await recordAudit({
      actor: user,
      action: "source.import",
      entityType: "research_source",
      entityId: result.sourceId,
      episodeId,
      summary: `Imported source from the national library: ${result.citation.slice(0, 120)}`,
    });
  }

  revalidatePath(`/episodes/${episodeId}`);
}
