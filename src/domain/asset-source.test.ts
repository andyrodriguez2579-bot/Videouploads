import { describe, expect, it } from "vitest";

import {
  classifySourceUrl,
  inferLicenseType,
  parseLocResponse,
  parseWikimediaResponse,
  stripHtml,
  wikimediaFileTitle,
} from "./asset-source";

/**
 * Shapes here are trimmed from real responses — a Wikimedia Commons file page
 * for Boazio's 1588 map of Drake's siege of Santo Domingo, and a Library of
 * Congress item. Recorded rather than invented, because the parsers exist to
 * cope with what these APIs actually return, HTML fragments and all.
 */

const WIKIMEDIA_RESPONSE = {
  query: {
    pages: {
      "12345": {
        title: "File:S. Domingo - btv1b55002968v.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/2/23/S._Domingo_-_btv1b55002968v.jpg",
            width: 7174,
            height: 6588,
            mime: "image/jpeg",
            extmetadata: {
              LicenseShortName: { value: "Public domain" },
              UsageTerms: { value: "Public domain" },
              Artist: { value: '<div class="fn value"> Boazio, Giovanni Battista. Cartographe</div>' },
              DateTimeOriginal: {
                value:
                  '1588<div style="display: none;">date QS:P571,+1588-00-00T00:00:00Z/9</div>',
              },
              Credit: { value: "Biblioth&#0232;que nationale de France" },
              AttributionRequired: { value: "false" },
            },
          },
        ],
      },
    },
  },
};

const LOC_RESPONSE = {
  item: {
    title: "Santa Rosa de Osos, Province of Antioquia.",
    date: "1852-01-01",
    contributor_names: ["Colombia. Comisión Corográfica Sponsor.", "Price, Henry, 1819-1863 Artist."],
    rights: ["<p>The Library of Congress is unaware of any copyright restrictions.</p>"],
    source_collection: ["Colección Comisión Corográfica"],
    control_number: ["2021670003"],
  },
  resources: [
    {
      files: [
        [
          { url: "https://tile.loc.gov/small.jpg", width: 1659, height: 1108, mimetype: "image/jpeg" },
          { url: "https://tile.loc.gov/large.jpg", width: 3319, height: 2216, mimetype: "image/jpeg" },
          { url: "https://tile.loc.gov/master.jp2", width: 3319, height: 2216, mimetype: "image/jp2" },
        ],
      ],
    },
  ],
};

describe("stripHtml", () => {
  it("unwraps the div Commons puts round a creator", () => {
    expect(stripHtml('<div class="fn value"> Boazio, Giovanni Battista</div>')).toBe(
      "Boazio, Giovanni Battista",
    );
  });

  it("drops hidden machine-readable spans entirely, content included", () => {
    // Keeping the content would put "date QS:P571..." into the citation.
    expect(
      stripHtml('1588<div style="display: none;">date QS:P571,+1588-00-00T00:00:00Z/9</div>'),
    ).toBe("1588");
  });

  it("decodes the entities archives actually emit", () => {
    // Accented names arrive as numeric entities more often than as UTF-8.
    expect(stripHtml("Biblioth&#232;que nationale")).toBe("Bibliothèque nationale");
    expect(stripHtml("Biblioth&#x00e8;que")).toBe("Bibliothèque");
    expect(stripHtml("Smith &amp; Sons")).toBe("Smith & Sons");
    expect(stripHtml("a&nbsp;b")).toBe("a b");
  });

  it("returns null rather than an empty string for nothing", () => {
    expect(stripHtml("")).toBeNull();
    expect(stripHtml(null)).toBeNull();
    expect(stripHtml("<div></div>")).toBeNull();
  });
});

describe("inferLicenseType", () => {
  it("recognises the common archive wordings", () => {
    expect(inferLicenseType("Public domain")).toBe("public_domain");
    expect(inferLicenseType("CC BY-SA 4.0")).toBe("cc_by_sa");
    expect(inferLicenseType("CC BY 4.0")).toBe("cc_by");
    expect(inferLicenseType("CC0")).toBe("cc0");
  });

  it("treats no known restrictions as public domain", () => {
    expect(inferLicenseType("No known restrictions on publication")).toBe("public_domain");
  });

  it("stays unknown rather than guessing", () => {
    // A wrong guess is worse than none: it looks like a decision was made.
    expect(inferLicenseType(null)).toBe("unknown");
    expect(inferLicenseType("")).toBe("unknown");
    expect(inferLicenseType("Rights reserved, contact the archive")).toBe("unknown");
  });
});

describe("classifySourceUrl", () => {
  it("routes archive URLs to their provider", () => {
    expect(classifySourceUrl("https://commons.wikimedia.org/wiki/File:X.jpg")).toBe("wikimedia");
    expect(classifySourceUrl("https://www.loc.gov/item/2021670003/")).toBe("loc");
    expect(classifySourceUrl("https://example.org/photo.jpg")).toBe("direct");
  });

  it("refuses anything that is not a usable http(s) URL", () => {
    expect(classifySourceUrl("not a url")).toBeNull();
    expect(classifySourceUrl("ftp://example.org/x.jpg")).toBeNull();
    // A page with no recognisable image and no known archive.
    expect(classifySourceUrl("https://example.org/some/article")).toBeNull();
  });
});

describe("wikimediaFileTitle", () => {
  it("reads the title from a file page", () => {
    expect(wikimediaFileTitle("https://commons.wikimedia.org/wiki/File:Santo_Domingo.jpg")).toBe(
      "File:Santo Domingo.jpg",
    );
  });

  it("recovers a title from a direct upload link", () => {
    expect(
      wikimediaFileTitle("https://upload.wikimedia.org/wikipedia/commons/2/23/S._Domingo.jpg"),
    ).toBe("File:S. Domingo.jpg");
  });

  it("accepts the localised namespaces Commons also serves", () => {
    expect(wikimediaFileTitle("https://commons.wikimedia.org/wiki/Imagen:Mapa.jpg")).toBe(
      "File:Mapa.jpg",
    );
  });

  it("returns null for a page that is not a file", () => {
    expect(wikimediaFileTitle("https://en.wikipedia.org/wiki/Santo_Domingo")).toBeNull();
  });
});

describe("parseWikimediaResponse", () => {
  const asset = parseWikimediaResponse(WIKIMEDIA_RESPONSE, "https://commons.wikimedia.org/x");

  it("takes the full-resolution file, not a thumbnail", () => {
    expect(asset.imageUrl).toContain("upload.wikimedia.org");
    expect(asset.width).toBe(7174);
    expect(asset.height).toBe(6588);
  });

  it("cleans the title of its namespace and extension", () => {
    expect(asset.title).toBe("S. Domingo - btv1b55002968v");
  });

  it("pulls creator and date out of their HTML wrappers", () => {
    expect(asset.creator).toBe("Boazio, Giovanni Battista. Cartographe");
    expect(asset.date).toBe("1588");
  });

  it("separates the holding institution from the creator", () => {
    // Commons puts the archive in Credit; crediting Boazio alone would be wrong.
    expect(asset.rightsHolder).toBe("Bibliothèque nationale de France");
    expect(asset.creator).not.toBe(asset.rightsHolder);
  });

  it("keeps the rights wording for the licence record", () => {
    expect(asset.rightsStatement).toBe("Public domain");
    expect(asset.attributionRequired).toBe(false);
  });

  it("explains itself when the page holds no file", () => {
    expect(() =>
      parseWikimediaResponse({ query: { pages: { "-1": { title: "File:Nope.jpg" } } } }, "u"),
    ).toThrow(/no image file/i);
  });
});

describe("parseLocResponse", () => {
  const asset = parseLocResponse(LOC_RESPONSE, "https://www.loc.gov/item/2021670003/");

  it("chooses the largest usable rendition", () => {
    expect(asset.imageUrl).toBe("https://tile.loc.gov/large.jpg");
    expect(asset.width).toBe(3319);
  });

  it("skips the JP2 master, which nothing downstream can read", () => {
    // Bigger, but ffmpeg and browsers cannot open it — unusable beats large.
    expect(asset.imageUrl).not.toContain(".jp2");
  });

  it("keeps the rights statement verbatim, stripped of markup", () => {
    expect(asset.rightsStatement).toBe(
      "The Library of Congress is unaware of any copyright restrictions.",
    );
  });

  it("records the catalogue reference for the citation", () => {
    expect(asset.archiveReference).toBe("2021670003");
  });

  it("assumes attribution is expected", () => {
    expect(asset.attributionRequired).toBe(true);
  });

  it("explains itself when there is no item", () => {
    expect(() => parseLocResponse({}, "u")).toThrow(/no item/i);
  });

  it("explains itself when an item has no downloadable image", () => {
    expect(() => parseLocResponse({ item: { title: "X" } }, "u")).toThrow(/no downloadable image/i);
  });
});
