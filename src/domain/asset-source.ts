/**
 * Reading an archive's own metadata off a URL.
 *
 * Pure: these functions take a parsed API response and return a description of
 * the asset. Fetching lives in `src/lib/sources`, so the mapping can be tested
 * against recorded responses without a network.
 *
 * **Nothing here ever clears a licence.** An archive's rights statement is
 * evidence about an item, not a decision about your use of it — "no known
 * restrictions" is a curator's assessment, and public-domain status varies by
 * jurisdiction. The app blocks approval on uncleared assets precisely so a
 * person has to look. Importing metadata is there to save typing, not to
 * shortcut that.
 */
import type { LicenseType } from "./types";

export interface RemoteAsset {
  /** Direct link to the largest rendition the archive offers. */
  imageUrl: string;
  title: string;
  creator: string | null;
  /** As the archive states it — "1588", "c. 1900", "1852-01-01". */
  date: string | null;
  /** The archive's rights wording, kept verbatim for the licence record. */
  rightsStatement: string | null;
  /** Short licence name where the archive gives one, e.g. "CC BY-SA 4.0". */
  licenseName: string | null;
  /** The human-facing page, for the citation. */
  sourceUrl: string;
  /** Catalogue or shelf reference, where there is one. */
  archiveReference: string | null;
  /** Which archive this came from. */
  provider: string;
  /** Institution to credit, which is often not the same as the creator. */
  rightsHolder: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  attributionRequired: boolean;
}

/**
 * Archive metadata arrives as HTML fragments more often than not — Wikimedia
 * wraps creators in `<div class="fn value">`, descriptions carry links and
 * hidden machine-readable spans. Rendering that raw would put markup on screen
 * and into citations.
 */
export function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    // Hidden spans hold machine-readable duplicates; drop content and all.
    .replace(/<span style="display:\s*none;?"[^>]*>.*?<\/span>/gis, "")
    .replace(/<div style="display:\s*none;?"[^>]*>.*?<\/div>/gis, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    // Numeric entities are common in archive metadata — "Biblioth&#232;que".
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/**
 * Best guess at the licence type from an archive's wording, for pre-selecting
 * the dropdown. Anything unrecognised stays `unknown` rather than guessing —
 * a wrong guess here is worse than no guess, because it looks decided.
 */
export function inferLicenseType(licenseName: string | null): LicenseType {
  const text = (licenseName ?? "").toLowerCase();
  if (!text) return "unknown";
  if (text === "cc0" || text.includes("cc0 ") || text.includes("creative commons zero")) {
    return "cc0";
  }
  if (text.includes("public domain") || text.includes("pd-")) return "public_domain";
  if (text.includes("cc by-sa") || text.includes("cc-by-sa")) return "cc_by_sa";
  if (text.includes("cc by") || text.includes("cc-by")) return "cc_by";
  if (text.includes("no known restrictions")) return "public_domain";
  return "unknown";
}

interface WikimediaExtField {
  value?: string;
}

interface WikimediaImageInfo {
  url?: string;
  /** Present only when the query asked for a scaled rendition. */
  thumburl?: string;
  width?: number;
  height?: number;
  mime?: string;
  extmetadata?: Record<string, WikimediaExtField>;
}

/**
 * Maps a Wikimedia Commons `imageinfo` response.
 *
 * Commons is a mixed bag by design — public domain sits beside CC-BY-SA and
 * fair-use claims — so the licence fields matter more here than anywhere else.
 */
export function parseWikimediaResponse(payload: unknown, sourceUrl: string): RemoteAsset {
  const pages = (payload as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  const page = pages ? Object.values(pages)[0] : undefined;
  if (!page || typeof page !== "object") {
    throw new Error("Wikimedia returned no page for that file.");
  }

  const asset = mapWikimediaPage(page, sourceUrl);
  if (!asset) {
    throw new Error(
      "That Commons page has no image file. Check the URL points at a File: page.",
    );
  }
  return asset;
}

/**
 * Drops a credit that carries no name.
 *
 * Commons' `Credit` field is often nothing but external links, which strip down
 * to `[1] , [2]`. That is not a rights holder, and it would end up printed as
 * an on-screen credit. The verbatim wording is still kept in the rights
 * statement; this only guards the field meant to hold somebody's name.
 */
function nameOrNull(credit: string | null): string | null {
  if (!credit) return null;
  return /\p{L}/u.test(credit) ? credit : null;
}

/**
 * Maps one page object from an `imageinfo` query.
 *
 * Returns null rather than throwing: a category listing should skip a member it
 * cannot read instead of failing the whole page of results.
 */
function mapWikimediaPage(page: unknown, sourceUrl: string): RemoteAsset | null {
  if (!page || typeof page !== "object") return null;

  const info = (page as { imageinfo?: WikimediaImageInfo[] }).imageinfo?.[0];
  if (!info?.url) return null;

  const meta = info.extmetadata ?? {};
  const field = (key: string) => stripHtml(meta[key]?.value);
  const rawTitle = (page as { title?: string }).title ?? "Untitled";

  return {
    imageUrl: info.url,
    title: rawTitle.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
    creator: field("Artist"),
    date: field("DateTimeOriginal"),
    rightsStatement: field("UsageTerms") ?? field("LicenseShortName"),
    licenseName: field("LicenseShortName"),
    sourceUrl,
    archiveReference: null,
    provider: "wikimedia",
    // Commons credits the holding institution here; the artist is separate.
    rightsHolder: nameOrNull(field("Credit")),
    width: info.width ?? null,
    height: info.height ?? null,
    mimeType: info.mime ?? null,
    attributionRequired: (meta.AttributionRequired?.value ?? "").toLowerCase() === "true",
  };
}

interface LocFile {
  url?: string;
  width?: number;
  height?: number;
  mimetype?: string;
}

/**
 * Maps a Library of Congress `?fo=json` response.
 *
 * LoC offers each item at several sizes; the largest JPEG is chosen. JP2 masters
 * are skipped deliberately — they are often bigger but ffmpeg and browsers
 * cannot read them, so an unusable file is worse than a smaller usable one.
 */
export function parseLocResponse(payload: unknown, sourceUrl: string): RemoteAsset {
  const root = payload as {
    item?: Record<string, unknown>;
    resources?: { files?: LocFile[][]; image?: string }[];
  };
  const item = root?.item;
  if (!item) throw new Error("The Library of Congress returned no item for that URL.");

  const candidates: LocFile[] = [];
  for (const resource of root.resources ?? []) {
    for (const group of resource.files ?? []) {
      for (const file of group) {
        if (file?.url && (file.mimetype ?? "").startsWith("image/") && file.mimetype !== "image/jp2") {
          candidates.push(file);
        }
      }
    }
  }

  const largest = candidates.sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0)).at(-1);
  const imageUrl = largest?.url ?? (root.resources?.[0]?.image ?? null);
  if (!imageUrl) {
    throw new Error("No downloadable image was found on that Library of Congress item.");
  }

  const first = (value: unknown): string | null => {
    if (Array.isArray(value)) return stripHtml(String(value[0] ?? "")) || null;
    if (typeof value === "string") return stripHtml(value);
    return null;
  };

  const rights = first(item.rights) ?? first(item.rights_advisory);

  return {
    imageUrl: imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl,
    title: first(item.title) ?? "Untitled",
    creator: first(item.contributor_names),
    date: first(item.date) ?? first(item.created_published),
    rightsStatement: rights,
    licenseName: rights,
    sourceUrl,
    archiveReference: first(item.control_number) ?? first(item.digital_id),
    provider: "loc",
    rightsHolder: first(item.source_collection) ?? "Library of Congress",
    width: largest?.width ?? null,
    height: largest?.height ?? null,
    mimeType: largest?.mimetype ?? null,
    // LoC's "no known restrictions" carries a credit expectation in practice.
    attributionRequired: true,
  };
}

/** One file in a Commons category, as offered for review before importing. */
export interface CategoryMember extends RemoteAsset {
  /** A scaled rendition for the picker; the import still fetches the full size. */
  thumbnailUrl: string | null;
}

export interface CategoryListing {
  files: CategoryMember[];
  /** Sub-categories, so the browser can drill down rather than dead-end. */
  subcategories: { title: string; url: string }[];
  /** True when Commons has more files than were returned. */
  truncated: boolean;
}

interface CategoryMemberEntry {
  title?: string;
}

/**
 * Reads a category listing: the files, plus the sub-categories under it.
 *
 * Sub-categories are listed but never followed. Commons categories nest deeply
 * and drift off-subject as they go, so recursing would quietly pull in images
 * nobody chose. Showing them lets the person decide where to look next.
 */
export function parseCategoryListing(payload: unknown): CategoryListing {
  const query = (payload as {
    query?: {
      pages?: Record<string, unknown>;
      categorymembers?: CategoryMemberEntry[];
    };
    continue?: unknown;
  })?.query;

  const files: CategoryMember[] = [];

  for (const page of Object.values(query?.pages ?? {})) {
    const title = (page as { title?: string }).title;
    if (!title) continue;

    const sourceUrl = commonsPageUrl(title);
    const asset = mapWikimediaPage(page, sourceUrl);
    if (!asset) continue;

    const info = (page as { imageinfo?: WikimediaImageInfo[] }).imageinfo?.[0];
    files.push({ ...asset, thumbnailUrl: info?.thumburl ?? null });
  }

  // Commons returns members in an arbitrary order; a stable one makes the
  // picker predictable across reloads.
  files.sort((a, b) => a.title.localeCompare(b.title));

  const subcategories = (query?.categorymembers ?? [])
    .map((entry) => entry.title)
    .filter((title): title is string => Boolean(title))
    .map((title) => ({ title: title.replace(/^Category:/, ""), url: commonsPageUrl(title) }));

  return {
    files,
    subcategories,
    truncated: Boolean((payload as { continue?: unknown })?.continue),
  };
}

/**
 * The human-facing Commons page for a title such as `File:Baní, 1890.jpg`.
 *
 * `:` and `,` are left as they are. Both forms resolve, but this is the
 * canonical one Commons itself emits, and these URLs end up in citations a
 * person reads.
 */
export function commonsPageUrl(title: string): string {
  const encoded = encodeURIComponent(title.replace(/ /g, "_"))
    .replace(/%3A/gi, ":")
    .replace(/%2C/gi, ",");
  return `https://commons.wikimedia.org/wiki/${encoded}`;
}

/**
 * Which archive a URL belongs to, or null when nothing recognises it.
 * Exported separately from fetching so routing can be tested on its own.
 */
export type AssetSourceKind = "wikimedia" | "loc" | "direct";

export function classifySourceUrl(rawUrl: string): AssetSourceKind | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (host.endsWith("wikimedia.org") || host.endsWith("wikipedia.org")) return "wikimedia";
  if (host === "loc.gov" || host.endsWith(".loc.gov")) return "loc";
  if (/\.(jpe?g|png|webp|tiff?|gif)(\?|$)/i.test(url.pathname + url.search)) return "direct";
  return null;
}

/** The `File:Name.jpg` title a Commons URL refers to. */
export function wikimediaFileTitle(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  // /wiki/File:Name.jpg
  const wikiMatch = /\/wiki\/(.+)$/.exec(url.pathname);
  if (wikiMatch?.[1]) {
    const decoded = decodeURIComponent(wikiMatch[1]).replace(/_/g, " ");
    if (/^(file|image|archivo|imagen):/i.test(decoded)) {
      return decoded.replace(/^(image|archivo|imagen):/i, "File:");
    }
  }

  // ?title=File:Name.jpg
  const titleParam = url.searchParams.get("title");
  if (titleParam && /^file:/i.test(titleParam)) return titleParam.replace(/_/g, " ");

  // A direct upload.wikimedia.org link — recover the filename.
  if (url.hostname.endsWith("upload.wikimedia.org")) {
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/_/g, " ");
    return name ? `File:${name}` : null;
  }

  return null;
}

/**
 * The `Category:Name` a Commons URL refers to, or null if it is not one.
 *
 * Category pages are how Commons is actually browsed — a researcher lands on
 * "Historical images of the Dominican Republic", not on forty separate file
 * pages. Treating that URL as an error would push the tedious part of the work
 * back onto the person.
 */
export function wikimediaCategoryTitle(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const candidates = [
    /\/wiki\/(.+)$/.exec(url.pathname)?.[1],
    url.searchParams.get("title") ?? undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const decoded = decodeURIComponent(candidate).replace(/_/g, " ").trim();
    // `Categoría`/`Categoria` appear on the Spanish-language interface.
    const match = /^(category|categor[ií]a):(.+)$/i.exec(decoded);
    if (match?.[2]?.trim()) return `Category:${match[2].trim()}`;
  }

  return null;
}
