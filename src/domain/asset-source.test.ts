import { describe, expect, it } from "vitest";

import {
  classifySourceUrl,
  inferLicenseType,
  parseCategoryListing,
  parseLocResponse,
  parseWikimediaResponse,
  stripHtml,
  wikimediaCategoryTitle,
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

/**
 * Recorded from Commons' own API for
 * `Category:Historical_images_of_the_Dominican_Republic` — the category the
 * series is actually being sourced from. Trimmed to two members and their
 * sub-categories, but the field shapes are verbatim, hidden markup included.
 */
const CATEGORY_RESPONSE = {
  continue: { gcmcontinue: "file|…", continue: "gcmcontinue||" },
  query: {
    pages: {
      "9990": {
        title: "File:Dominican Republic baseball history.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/8/83/Dominican_Republic_baseball_history.jpg",
            thumburl:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Dominican_Republic_baseball_history.jpg/330px-Dominican_Republic_baseball_history.jpg",
            width: 1600,
            height: 2648,
            mime: "image/jpeg",
            extmetadata: {
              LicenseShortName: { value: "Public domain" },
              UsageTerms: { value: "Public domain" },
              Artist: {
                value:
                  '<bdi><a href="https://en.wikipedia.org/wiki/en:Associated_Press" class="extiw" title="w:en:Associated Press"><span title="multinational nonprofit news agency">Associated Press</span></a></bdi>',
              },
              DateTimeOriginal: { value: "1948-03-06" },
              Credit: {
                value:
                  '<a rel="nofollow" class="external autonumber" href="https://www.newspapers.com/image/1233253631">[1]</a>',
              },
              AttributionRequired: { value: "false" },
            },
          },
        ],
      },
      "1111": {
        title: "File:Baní, 1890.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/5/5d/Ban%C3%AD%2C_1890.jpg",
            thumburl:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Ban%C3%AD%2C_1890.jpg/330px-Ban%C3%AD%2C_1890.jpg",
            width: 2208,
            height: 1492,
            mime: "image/jpeg",
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              UsageTerms: { value: "Creative Commons Attribution-Share Alike 4.0" },
              Artist: {
                value:
                  '<a href="//commons.wikimedia.org/w/index.php?title=User:Ronny_Medina&amp;action=edit&amp;redlink=1" class="new">Ronny Medina</a>',
              },
              DateTimeOriginal: { value: "2018-12-01 20:26:28" },
              Credit: { value: '<span class="int-own-work" lang="en">Own work</span>' },
              AttributionRequired: { value: "true" },
            },
          },
        ],
      },
    },
    categorymembers: [
      { title: "Category:Photographs of the Dominican Republic by century" },
      { title: "Category:Historical images of Fortaleza Ozama" },
    ],
  },
};

describe("wikimediaCategoryTitle", () => {
  it("reads a category off a Commons URL", () => {
    expect(
      wikimediaCategoryTitle(
        "https://commons.wikimedia.org/wiki/Category:Historical_images_of_the_Dominican_Republic",
      ),
    ).toBe("Category:Historical images of the Dominican Republic");
  });

  it("accepts the Spanish interface's spelling and the ?title= form", () => {
    expect(
      wikimediaCategoryTitle("https://commons.wikimedia.org/wiki/Categoría:Santo_Domingo"),
    ).toBe("Category:Santo Domingo");
    expect(
      wikimediaCategoryTitle("https://commons.wikimedia.org/w/index.php?title=Category:Baní"),
    ).toBe("Category:Baní");
  });

  it("returns null for anything that is not a category", () => {
    expect(wikimediaCategoryTitle("https://commons.wikimedia.org/wiki/File:Baní,_1890.jpg")).toBeNull();
    expect(wikimediaCategoryTitle("https://www.loc.gov/item/2017801069/")).toBeNull();
    expect(wikimediaCategoryTitle("not a url")).toBeNull();
    // A bare "Category:" with no name is not a category page.
    expect(wikimediaCategoryTitle("https://commons.wikimedia.org/wiki/Category:")).toBeNull();
  });
});

describe("parseCategoryListing", () => {
  it("maps every file with its licence, size and thumbnail", () => {
    const listing = parseCategoryListing(CATEGORY_RESPONSE);

    expect(listing.files).toHaveLength(2);
    const bani = listing.files.find((f) => f.title.startsWith("Baní"))!;
    expect(bani.imageUrl).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/5/5d/Ban%C3%AD%2C_1890.jpg",
    );
    expect(bani.thumbnailUrl).toContain("330px-");
    expect(bani.licenseName).toBe("CC BY-SA 4.0");
    expect(bani.width).toBe(2208);
    expect(bani.attributionRequired).toBe(true);
  });

  it("strips the markup Commons wraps around creators and credits", () => {
    const listing = parseCategoryListing(CATEGORY_RESPONSE);
    const ap = listing.files.find((f) => f.title.includes("baseball"))!;

    expect(ap.creator).toBe("Associated Press");
    // Commons' credit here is only external links; "[1]" is not a rights
    // holder, and it would otherwise be printed as an on-screen credit.
    expect(ap.rightsHolder).toBeNull();
    expect(ap.rightsStatement).toBe("Public domain");
    expect(ap.date).toBe("1948-03-06");
  });

  it("points each file at its Commons page, not the raw upload URL", () => {
    // The licence record cites the page a person can read the rights on.
    const listing = parseCategoryListing(CATEGORY_RESPONSE);
    const bani = listing.files.find((f) => f.title.startsWith("Baní"))!;

    expect(bani.sourceUrl).toBe(
      "https://commons.wikimedia.org/wiki/File:Ban%C3%AD,_1890.jpg",
    );
    // And the importer must be able to read that title back out of it.
    expect(wikimediaFileTitle(bani.sourceUrl)).toBe("File:Baní, 1890.jpg");
  });

  it("orders files by title so the picker does not reshuffle", () => {
    expect(parseCategoryListing(CATEGORY_RESPONSE).files.map((f) => f.title)).toEqual([
      "Baní, 1890",
      "Dominican Republic baseball history",
    ]);
  });

  it("lists sub-categories without following them", () => {
    const listing = parseCategoryListing(CATEGORY_RESPONSE);

    expect(listing.subcategories).toEqual([
      {
        title: "Photographs of the Dominican Republic by century",
        url: "https://commons.wikimedia.org/wiki/Category:Photographs_of_the_Dominican_Republic_by_century",
      },
      {
        title: "Historical images of Fortaleza Ozama",
        url: "https://commons.wikimedia.org/wiki/Category:Historical_images_of_Fortaleza_Ozama",
      },
    ]);
  });

  it("reports that Commons had more files than it returned", () => {
    expect(parseCategoryListing(CATEGORY_RESPONSE).truncated).toBe(true);
    expect(parseCategoryListing({ query: { pages: {} } }).truncated).toBe(false);
  });

  it("skips a member with no image rather than failing the whole listing", () => {
    const withBadMember = {
      query: {
        pages: {
          ...CATEGORY_RESPONSE.query.pages,
          "7777": { title: "File:Deleted.jpg" },
        },
      },
    };

    expect(parseCategoryListing(withBadMember).files).toHaveLength(2);
  });

  it("returns empty lists for a category holding nothing", () => {
    const listing = parseCategoryListing({ query: {} });

    expect(listing.files).toEqual([]);
    expect(listing.subcategories).toEqual([]);
  });
});
