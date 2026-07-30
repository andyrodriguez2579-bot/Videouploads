import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { captions, episodes } from "@/db/schema";
import { parseSubtitles, toSrt, toVtt } from "@/domain/subtitles";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Downloads a caption set as SRT or WebVTT.
 *
 * A sidecar file is what YouTube wants — viewers can turn it off, and the
 * platform indexes the text. Burned-in captions are for silent-autoplay feeds
 * and are a render option instead.
 *
 *   /api/captions/<id>          → SRT
 *   /api/captions/<id>?format=vtt → WebVTT
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db
    .select({
      content: captions.content,
      language: captions.language,
      episodeTitle: episodes.title,
      episodeNumber: episodes.episodeNumber,
    })
    .from(captions)
    .innerJoin(episodes, eq(episodes.id, captions.episodeId))
    .where(eq(captions.id, id))
    .limit(1);

  if (!row?.content) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const wantsVtt = new URL(request.url).searchParams.get("format") === "vtt";
  // Stored as SRT; converted on the way out rather than kept in two formats
  // that could drift apart.
  const body = wantsVtt ? toVtt(parseSubtitles(row.content)) : toSrt(parseSubtitles(row.content));

  const safeTitle =
    row.episodeTitle
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 80) || "episode";
  const filename = `${safeTitle}.${row.language}.${wantsVtt ? "vtt" : "srt"}`;

  return new NextResponse(body, {
    headers: {
      // WebVTT has its own type; SRT has no registered one, so text/plain with
      // an explicit charset is the interoperable choice.
      "Content-Type": wantsVtt ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
