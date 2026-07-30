/**
 * Turning a library catalogue record into a research source.
 *
 * Pure, so the mapping can be tested against recorded catalogue responses.
 *
 * **Nothing imported here is ever verified.** `research_sources.verification`
 * defaults to `unverified` for a reason: finding a book that mentions a subject
 * is not the same as checking that it supports the specific claim in the script.
 * An import saves transcription, not judgement — and the approval gate still
 * refuses an episode with no verified source.
 */

/** Dublin Core keys, as DSpace returns them. */
export interface CatalogueRecord {
  handle: string | null;
  metadata: Record<string, { value?: string }[]>;
}

export type SourceType = "primary" | "secondary" | "tertiary" | "archive" | "interview" | "other";

export interface MappedSource {
  citation: string;
  sourceType: SourceType;
  author: string | null;
  publisher: string | null;
  publicationYear: number | null;
  url: string | null;
  archiveReference: string | null;
  notes: string | null;
  /** Subject headings, useful for judging relevance before adding. */
  subjects: string[];
  title: string;
  abstract: string | null;
}

function values(record: CatalogueRecord, key: string): string[] {
  return (record.metadata[key] ?? [])
    .map((entry) => (entry.value ?? "").trim())
    .filter((value) => value.length > 0);
}

function first(record: CatalogueRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = values(record, key)[0];
    if (value) return value;
  }
  return null;
}

/**
 * A catalogue's `dc.type` is a rough guide at best.
 *
 * Deliberately conservative: anything not obviously archival maps to
 * `secondary`. Calling a secondary work `primary` would overstate the evidence
 * behind a claim, which is the one error this field exists to prevent.
 */
export function inferSourceType(dcType: string | null): SourceType {
  const text = (dcType ?? "").toLowerCase();
  if (!text) return "secondary";
  if (/manuscript|archiv|expediente|documento de archivo|fond/.test(text)) return "archive";
  if (/map|mapa|photograph|fotograf|plano/.test(text)) return "primary";
  if (/interview|entrevista|oral/.test(text)) return "interview";
  if (/encyclop|enciclopedia|diccionario|dictionary/.test(text)) return "tertiary";
  return "secondary";
}

/** Four digits anywhere in a DSpace date, which may be `1945` or `1945-03-01`. */
export function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const match = /(1[0-9]{3}|20[0-9]{2})/.exec(raw);
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  return year >= 1400 && year <= new Date().getFullYear() + 1 ? year : null;
}

/**
 * Builds a citation when the catalogue does not supply one.
 *
 * Author (Year). *Title*. Place: Publisher.
 */
export function formatCitation(parts: {
  author: string | null;
  year: number | null;
  title: string;
  place: string | null;
  publisher: string | null;
}): string {
  const segments: string[] = [];
  if (parts.author) segments.push(parts.author);
  segments.push(parts.year ? `(${parts.year}).` : "(s.f.).");
  segments.push(`${parts.title}.`);

  const imprint = [parts.place, parts.publisher].filter(Boolean).join(": ");
  if (imprint) segments.push(`${imprint}.`);

  return segments.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Maps a catalogue record onto the fields a research source needs.
 *
 * The catalogue's own `dc.identifier.citation` wins when present — a librarian
 * formatted it, and it will be more correct than anything reassembled from
 * parts.
 */
export function mapCatalogueRecord(record: CatalogueRecord): MappedSource {
  const title = first(record, "dc.title") ?? "Sin título";
  const author = first(record, "dc.contributor.author", "dc.creator");
  const publisher = first(record, "dc.publisher");
  const place = first(record, "dc.publisher.place");
  const year = parseYear(first(record, "dc.date.issued"));
  const abstract = first(record, "dc.description.abstract");
  const rights = first(record, "dc.rights");
  const series = first(record, "dc.relation.ispartofseries");
  const extent = first(record, "dc.format.extent");

  const catalogued = first(record, "dc.identifier.citation");
  const citation =
    catalogued ?? formatCitation({ author, year, title, place, publisher });

  const url =
    first(record, "dc.identifier.uri") ??
    (record.handle ? `https://bd.bnphu.gob.do/handle/${record.handle}` : null);

  return {
    citation,
    sourceType: inferSourceType(first(record, "dc.type")),
    author,
    publisher: [publisher, place].filter(Boolean).join(", ") || null,
    publicationYear: year,
    url,
    archiveReference: record.handle,
    subjects: values(record, "dc.subject"),
    title,
    abstract,
    notes:
      [
        series ? `Serie: ${series}` : null,
        extent ? `Extensión: ${extent}` : null,
        rights ? `Derechos según el catálogo: ${rights}` : null,
        "Importado del catálogo de la Biblioteca Nacional Pedro Henríquez Ureña. " +
          "Sin verificar: confirme que la fuente respalda la afirmación concreta.",
      ]
        .filter(Boolean)
        .join("\n") || null,
  };
}
