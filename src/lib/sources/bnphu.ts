import "server-only";

import { mapCatalogueRecord, type CatalogueRecord, type MappedSource } from "@/domain/research-source";

/**
 * The Biblioteca Nacional Pedro Henríquez Ureña's digital library, which runs
 * DSpace 7.
 *
 * Search and metadata are public; downloading the scanned files is not — a
 * bitstream request returns 401. That shapes what this can be: a **citation**
 * source, not an image source. It fills `research_sources`, and the PDFs stay
 * where they are.
 */

const BASE = "https://bd.bnphu.gob.do";
const SEARCH_TIMEOUT_MS = 20_000;

const USER_AGENT =
  "HistoriaDominicanaStudio/0.1 (documentary production tool; +https://github.com/andyrodriguez2579-bot/Videouploads)";

export interface CatalogueHit extends MappedSource {
  /** DSpace's own id, used to fetch the full record. */
  id: string;
}

interface DSpaceObject {
  uuid?: string;
  handle?: string;
  type?: string;
  metadata?: Record<string, { value?: string }[]>;
}

/**
 * Searches the catalogue.
 *
 * Only `item` results are kept: DSpace also indexes collections and communities,
 * which are shelves rather than things you can cite.
 */
export async function searchCatalogue(query: string, limit = 10): Promise<CatalogueHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL(`${BASE}/server/api/discover/search/objects`);
  url.searchParams.set("query", trimmed);
  url.searchParams.set("size", String(Math.min(Math.max(limit, 1), 25)));
  url.searchParams.set("dsoType", "item");

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`The library catalogue returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    _embedded?: {
      searchResult?: {
        _embedded?: { objects?: { _embedded?: { indexableObject?: DSpaceObject } }[] };
      };
    };
  };

  const objects = payload._embedded?.searchResult?._embedded?.objects ?? [];
  const hits: CatalogueHit[] = [];

  for (const wrapper of objects) {
    const object = wrapper._embedded?.indexableObject;
    if (!object || object.type !== "item" || !object.uuid) continue;

    const record: CatalogueRecord = {
      handle: object.handle ?? null,
      metadata: object.metadata ?? {},
    };
    hits.push({ id: object.uuid, ...mapCatalogueRecord(record) });
  }

  return hits;
}

/**
 * Re-reads one record straight from the catalogue.
 *
 * Search results are already complete, but importing re-fetches so the citation
 * stored is the catalogue's current one rather than whatever was rendered into
 * a page the operator may have had open for a while.
 */
export async function fetchCatalogueItem(id: string): Promise<MappedSource> {
  const response = await fetch(`${BASE}/server/api/core/items/${encodeURIComponent(id)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`The library catalogue returned ${response.status} for that record.`);
  }

  const object = (await response.json()) as DSpaceObject;
  return mapCatalogueRecord({
    handle: object.handle ?? null,
    metadata: object.metadata ?? {},
  });
}
