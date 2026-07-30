import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { researchSources } from "@/db/schema";
import { fetchCatalogueItem, searchCatalogue, type CatalogueHit } from "@/lib/sources/bnphu";

/**
 * Importing citations from the national library catalogue.
 *
 * The source is created `unverified`, which is the whole point of the field: a
 * catalogue can tell you a book exists and what it is about, never that it
 * supports the particular sentence in your script. Approval still requires a
 * person to have read it and said so.
 */

export type { CatalogueHit };

export async function searchLibrary(query: string): Promise<CatalogueHit[]> {
  return searchCatalogue(query, 10);
}

export async function importResearchSource(input: {
  episodeId: string;
  catalogueId: string;
  /** The claim this is meant to back, when the operator already knows it. */
  supportsClaim?: string | null;
}): Promise<{ sourceId: string; citation: string; alreadyPresent: boolean }> {
  const mapped = await fetchCatalogueItem(input.catalogueId);

  // The same book cited twice against one episode is noise, not rigour.
  if (mapped.archiveReference) {
    const [existing] = await db
      .select({ id: researchSources.id, citation: researchSources.citation })
      .from(researchSources)
      .where(
        and(
          eq(researchSources.episodeId, input.episodeId),
          eq(researchSources.archiveReference, mapped.archiveReference),
        ),
      )
      .limit(1);

    if (existing) {
      return { sourceId: existing.id, citation: existing.citation, alreadyPresent: true };
    }
  }

  const [row] = await db
    .insert(researchSources)
    .values({
      episodeId: input.episodeId,
      citation: mapped.citation,
      sourceType: mapped.sourceType,
      author: mapped.author,
      publisher: mapped.publisher,
      publicationYear: mapped.publicationYear,
      url: mapped.url,
      archiveReference: mapped.archiveReference,
      supportsClaim: input.supportsClaim?.trim() || null,
      // Never verified on import. A catalogue entry is not a fact-check.
      verification: "unverified",
      notes: mapped.notes,
    })
    .returning();

  if (!row) throw new Error("Could not save that source.");
  return { sourceId: row.id, citation: row.citation, alreadyPresent: false };
}
