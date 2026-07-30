import "server-only";

import {
  classifySourceUrl,
  parseCategoryListing,
  parseLocResponse,
  parseWikimediaResponse,
  wikimediaCategoryTitle,
  wikimediaFileTitle,
  type CategoryListing,
  type RemoteAsset,
} from "@/domain/asset-source";
import { getEnv } from "@/lib/env";

/**
 * Fetching an image and its metadata from an archive.
 *
 * The parsing lives in `src/domain/asset-source.ts`; this module only does the
 * network. Everything here is fetching a URL a person typed, which means it is
 * fetching a URL that could point anywhere: the limits below are the point of
 * the module, not incidental to it.
 */

/** A person is waiting on this, so it fails rather than hanging. */
const METADATA_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Wikimedia's API policy asks for a descriptive User-Agent identifying the tool
 * and a contact route; anonymous scrapers get rate-limited or blocked.
 */
const USER_AGENT =
  "HistoriaDominicanaStudio/0.1 (documentary production tool; +https://github.com/andyrodriguez2579-bot/Videouploads)";

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`The archive returned ${response.status} for that URL.`);
  }
  return response.json();
}

/**
 * Resolves a page URL to a described asset, without downloading the image.
 * Used to show what would be imported before committing to it.
 */
export async function resolveAssetUrl(rawUrl: string): Promise<RemoteAsset> {
  const kind = classifySourceUrl(rawUrl);
  if (!kind) {
    throw new Error(
      "That URL is not recognised. Paste a Wikimedia Commons file page, a " +
        "loc.gov item, or a direct link to an image file.",
    );
  }

  if (kind === "wikimedia") {
    const title = wikimediaFileTitle(rawUrl);
    if (!title) {
      // A category is a reasonable thing to paste, so say where it goes rather
      // than only that this is the wrong box for it.
      if (wikimediaCategoryTitle(rawUrl)) {
        throw new Error(
          "That is a Commons category, not a single file. Paste it into " +
            "“Browse a Commons category” to pick images from it.",
        );
      }
      throw new Error("That Wikimedia URL does not point at a File: page.");
    }
    const api =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
      "&iiprop=url%7Csize%7Cmime%7Cextmetadata&titles=" +
      encodeURIComponent(title);
    return parseWikimediaResponse(await fetchJson(api), rawUrl);
  }

  if (kind === "loc") {
    // loc.gov returns JSON for any item URL given fo=json.
    const url = new URL(rawUrl);
    url.searchParams.set("fo", "json");
    return parseLocResponse(await fetchJson(url.toString()), rawUrl);
  }

  // A bare image URL. There is no metadata to read, so everything the licence
  // record needs has to be filled in by hand — which the UI says plainly.
  const url = new URL(rawUrl);
  return {
    imageUrl: rawUrl,
    title: decodeURIComponent(url.pathname.split("/").pop() ?? "image").replace(/\.[a-z0-9]+$/i, ""),
    creator: null,
    date: null,
    rightsStatement: null,
    licenseName: null,
    sourceUrl: rawUrl,
    archiveReference: null,
    provider: "direct",
    rightsHolder: url.hostname,
    width: null,
    height: null,
    mimeType: null,
    attributionRequired: true,
  };
}

/** How many files one category request returns. Commons pages beyond this. */
const CATEGORY_PAGE_SIZE = 50;

/**
 * Lists the files in a Commons category, with metadata and thumbnails.
 *
 * One request: a `categorymembers` generator feeds `imageinfo`, and a parallel
 * `list=categorymembers` picks up the sub-categories. Doing it as separate
 * lookups per file would be dozens of round trips against an API whose policy
 * asks callers not to hammer it.
 */
export async function listWikimediaCategory(rawUrl: string): Promise<CategoryListing> {
  const title = wikimediaCategoryTitle(rawUrl);
  if (!title) throw new Error("That Wikimedia URL does not point at a Category: page.");

  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("format", "json");
  // Files in the category, expanded to full image metadata.
  api.searchParams.set("generator", "categorymembers");
  api.searchParams.set("gcmtitle", title);
  api.searchParams.set("gcmtype", "file");
  api.searchParams.set("gcmlimit", String(CATEGORY_PAGE_SIZE));
  api.searchParams.set("prop", "imageinfo");
  api.searchParams.set("iiprop", "url|size|mime|extmetadata");
  api.searchParams.set("iiurlwidth", "320");
  // Sub-categories, listed but not followed.
  api.searchParams.set("list", "categorymembers");
  api.searchParams.set("cmtitle", title);
  api.searchParams.set("cmtype", "subcat");
  api.searchParams.set("cmlimit", "50");

  return parseCategoryListing(await fetchJson(api.toString()));
}

export interface DownloadedImage {
  body: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Downloads the image itself.
 *
 * Checks `Content-Length` before reading, and again while reading: a server can
 * understate or omit the header, and an archive master can be hundreds of
 * megabytes. Without the second check a single URL could exhaust memory.
 */
export async function downloadImage(asset: RemoteAsset): Promise<DownloadedImage> {
  const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;

  const response = await fetch(asset.imageUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Downloading the image failed with ${response.status}.`);
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new Error(
      `That file is ${(declared / 1024 / 1024).toFixed(0)} MB, over the ` +
        `${getEnv().MAX_UPLOAD_MB} MB limit. Download it and choose a smaller rendition.`,
    );
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`That URL returned ${contentType}, not an image.`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The image response had no body.");

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(
        `That file exceeds the ${getEnv().MAX_UPLOAD_MB} MB limit. Choose a smaller rendition.`,
      );
    }
    chunks.push(Buffer.from(value));
  }

  const mimeType = contentType || asset.mimeType || "image/jpeg";
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const safeTitle =
    asset.title
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 80) || "image";

  return { body: Buffer.concat(chunks), mimeType, filename: `${safeTitle}.${extension}` };
}

export type { RemoteAsset };
