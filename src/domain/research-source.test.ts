import { describe, expect, it } from "vitest";

import {
  formatCitation,
  inferSourceType,
  mapCatalogueRecord,
  parseYear,
  type CatalogueRecord,
} from "./research-source";

/**
 * The record below is recorded verbatim from the Biblioteca Nacional Pedro
 * Henríquez Ureña's DSpace API — item `cf7e97c9-980f-4691-96f7-a916a58acac0`,
 * Rodríguez Demorizi's *Relaciones históricas de Santo Domingo* (1945), which
 * collects documents on Drake's 1586 invasion.
 *
 * Recorded rather than invented: the mapping exists to cope with what this
 * catalogue actually returns, down to the trailing life dates in the author
 * field and the place being a separate term from the publisher.
 */
function metadata(entries: Record<string, string[]>): CatalogueRecord["metadata"] {
  return Object.fromEntries(
    Object.entries(entries).map(([key, list]) => [key, list.map((value) => ({ value }))]),
  );
}

const DEMORIZI: CatalogueRecord = {
  handle: "BNPHU/2970",
  metadata: metadata({
    "dc.contributor.author": ["Rodríguez Demorizi, Emilio, 1904-1986"],
    "dc.date.accessioned": ["2023-09-04T13:15:13Z"],
    "dc.date.issued": ["1945"],
    "dc.description": ["Donado por el Centro León."],
    "dc.description.abstract": [
      "En esta obra se recogen documentos relativos a dos trascendentales momentos de nuestra historia: la invasión de Drake, de 1586, y las devastaciones de 1605 y 1606.",
    ],
    "dc.format.extent": ["510 páginas"],
    "dc.identifier.citation": [
      "Rodríguez Demorizi, Emilio, 1904-1986. (1945). Relaciones históricas de Santo Domingo. Ciudad Trujillo, República Dominicana: Editora Montalvo.",
    ],
    "dc.identifier.uri": ["https://bd.bnphu.gob.do/handle/BNPHU/2970"],
    "dc.language.iso": ["es"],
    "dc.publisher": ["Editora Montalvo"],
    "dc.publisher.place": ["Ciudad Trujillo, República Dominicana"],
    "dc.relation.ispartofseries": ["Archivo General de la Nación;Volumen 4"],
    "dc.rights": ["Atribución-NoComercial-SinDerivadas 3.0 Estados Unidos de América"],
    "dc.subject": [
      "República Dominicana - Historia",
      "República Dominicana - Historia - Invasión de Drake, 1586",
    ],
    "dc.title": ["Relaciones históricas de Santo Domingo"],
    "dc.type": ["Book"],
  }),
};

describe("mapCatalogueRecord", () => {
  it("prefers the catalogue's own citation over a reassembled one", () => {
    const mapped = mapCatalogueRecord(DEMORIZI);

    expect(mapped.citation).toBe(
      "Rodríguez Demorizi, Emilio, 1904-1986. (1945). Relaciones históricas de Santo Domingo. Ciudad Trujillo, República Dominicana: Editora Montalvo.",
    );
  });

  it("falls back to a formatted citation when the librarian supplied none", () => {
    const withoutCitation: CatalogueRecord = {
      handle: DEMORIZI.handle,
      metadata: Object.fromEntries(
        Object.entries(DEMORIZI.metadata).filter(([key]) => key !== "dc.identifier.citation"),
      ),
    };

    expect(mapCatalogueRecord(withoutCitation).citation).toBe(
      "Rodríguez Demorizi, Emilio, 1904-1986 (1945). Relaciones históricas de Santo Domingo. Ciudad Trujillo, República Dominicana: Editora Montalvo.",
    );
  });

  it("pulls out the fields a research source stores", () => {
    const mapped = mapCatalogueRecord(DEMORIZI);

    expect(mapped.title).toBe("Relaciones históricas de Santo Domingo");
    expect(mapped.author).toBe("Rodríguez Demorizi, Emilio, 1904-1986");
    expect(mapped.publicationYear).toBe(1945);
    expect(mapped.publisher).toBe("Editora Montalvo, Ciudad Trujillo, República Dominicana");
    expect(mapped.url).toBe("https://bd.bnphu.gob.do/handle/BNPHU/2970");
    expect(mapped.archiveReference).toBe("BNPHU/2970");
    expect(mapped.subjects).toEqual([
      "República Dominicana - Historia",
      "República Dominicana - Historia - Invasión de Drake, 1586",
    ]);
  });

  it("keeps the series, extent and catalogued rights in the notes", () => {
    const notes = mapCatalogueRecord(DEMORIZI).notes ?? "";

    expect(notes).toContain("Serie: Archivo General de la Nación;Volumen 4");
    expect(notes).toContain("Extensión: 510 páginas");
    expect(notes).toContain("Atribución-NoComercial-SinDerivadas");
  });

  it("says in the notes that the source has not been checked", () => {
    // The whole risk of an importer is that it makes a citation look researched.
    expect(mapCatalogueRecord(DEMORIZI).notes).toContain("Sin verificar");
  });

  it("builds a handle URL when the record carries no dc.identifier.uri", () => {
    const withoutUri: CatalogueRecord = {
      handle: "BNPHU/1465",
      metadata: metadata({ "dc.title": ["Villa de Santiago"] }),
    };

    expect(mapCatalogueRecord(withoutUri).url).toBe("https://bd.bnphu.gob.do/handle/BNPHU/1465");
  });

  it("survives a record with nothing but a handle", () => {
    const bare: CatalogueRecord = { handle: null, metadata: {} };
    const mapped = mapCatalogueRecord(bare);

    expect(mapped.title).toBe("Sin título");
    expect(mapped.citation).toBe("(s.f.). Sin título.");
    expect(mapped.author).toBeNull();
    expect(mapped.publisher).toBeNull();
    expect(mapped.url).toBeNull();
    expect(mapped.archiveReference).toBeNull();
    expect(mapped.subjects).toEqual([]);
  });

  it("ignores metadata entries whose value is blank or missing", () => {
    const noisy: CatalogueRecord = {
      handle: null,
      metadata: {
        "dc.title": [{ value: "  Historia  " }],
        "dc.contributor.author": [{}, { value: "   " }, { value: "Utrera, Cipriano de" }],
      },
    };
    const mapped = mapCatalogueRecord(noisy);

    expect(mapped.title).toBe("Historia");
    expect(mapped.author).toBe("Utrera, Cipriano de");
  });
});

describe("inferSourceType", () => {
  it("treats an ordinary book as secondary", () => {
    expect(inferSourceType("Book")).toBe("secondary");
  });

  it("recognises archival material in either language", () => {
    expect(inferSourceType("Manuscript")).toBe("archive");
    expect(inferSourceType("Documento de archivo")).toBe("archive");
  });

  it("recognises maps and photographs as primary", () => {
    expect(inferSourceType("Mapa")).toBe("primary");
    expect(inferSourceType("Photograph")).toBe("primary");
  });

  it("recognises oral history and reference works", () => {
    expect(inferSourceType("Entrevista")).toBe("interview");
    expect(inferSourceType("Diccionario biográfico")).toBe("tertiary");
  });

  it("defaults to secondary rather than overstating the evidence", () => {
    // Guessing "primary" would inflate how much weight a claim appears to carry,
    // which is the one mistake this field exists to prevent.
    expect(inferSourceType(null)).toBe("secondary");
    expect(inferSourceType("")).toBe("secondary");
    expect(inferSourceType("Otro")).toBe("secondary");
  });
});

describe("parseYear", () => {
  it("reads a bare year and a full DSpace date alike", () => {
    expect(parseYear("1945")).toBe(1945);
    expect(parseYear("1945-03-01")).toBe(1945);
    expect(parseYear("2023-09-04T13:15:13Z")).toBe(2023);
  });

  it("returns null when there is no year to read", () => {
    expect(parseYear(null)).toBeNull();
    expect(parseYear("s.f.")).toBeNull();
    expect(parseYear("")).toBeNull();
  });

  it("rejects years outside the range a Dominican imprint could carry", () => {
    expect(parseYear("1066")).toBeNull();
    expect(parseYear(String(new Date().getFullYear() + 5))).toBeNull();
  });
});

describe("formatCitation", () => {
  it("writes author, year, title and imprint", () => {
    expect(
      formatCitation({
        author: "Utrera, Cipriano de",
        year: 1927,
        title: "Santo Domingo: dilucidaciones históricas",
        place: "Santo Domingo",
        publisher: "Padres Franciscanos Capuchinos",
      }),
    ).toBe(
      "Utrera, Cipriano de (1927). Santo Domingo: dilucidaciones históricas. Santo Domingo: Padres Franciscanos Capuchinos.",
    );
  });

  it("marks an undated work rather than leaving the year blank", () => {
    expect(
      formatCitation({ author: "Anónimo", year: null, title: "Relación", place: null, publisher: null }),
    ).toBe("Anónimo (s.f.). Relación.");
  });

  it("drops the imprint entirely when neither place nor publisher is known", () => {
    expect(
      formatCitation({ author: null, year: 1586, title: "Carta al Rey", place: null, publisher: null }),
    ).toBe("(1586). Carta al Rey.");
  });
});
