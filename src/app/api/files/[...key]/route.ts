import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets, renders } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";

/**
 * Serves objects from local storage behind the session check.
 *
 * Only keys this application recorded are served — an uploaded asset or a
 * finished render. Without that lookup a signed-in user could read any file
 * under the storage root by guessing a path.
 *
 * When STORAGE_DRIVER=s3 this route is unused — the client gets a presigned URL.
 */

/** What a stored key resolves to, or null when the app does not know the key. */
async function describeKey(
  key: string,
): Promise<{ mimeType: string | null; filename: string } | null> {
  const [asset] = await db
    .select({ mimeType: mediaAssets.mimeType, title: mediaAssets.title })
    .from(mediaAssets)
    .where(eq(mediaAssets.objectKey, key))
    .limit(1);
  if (asset) return { mimeType: asset.mimeType, filename: asset.title };

  const [render] = await db
    .select({
      mimeType: renders.mimeType,
      kind: renders.kind,
      aspectRatio: renders.aspectRatio,
    })
    .from(renders)
    .where(eq(renders.objectKey, key))
    .limit(1);
  if (render) {
    return {
      mimeType: render.mimeType,
      filename: `${render.kind}-${render.aspectRatio.replace(":", "x")}.mp4`,
    };
  }

  return null;
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");

  const described = await describeKey(key);
  if (!described) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const body = await getStorage().get(key);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": described.mimeType ?? "application/octet-stream",
        "Content-Length": String(body.byteLength),
        // Objects are immutable once written — a new upload or render gets a
        // new key, so this can be cached for the length of a session.
        "Cache-Control": "private, max-age=3600",
        // Renders are played in a tab rather than downloaded, so `inline`
        // matters as much here as it does for stills.
        "Content-Disposition": `inline; filename="${encodeURIComponent(described.filename)}"`,
        "X-Content-Type-Options": "nosniff",
        // Lets the browser seek within a video without refetching the whole file.
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("[files] read failed", { key, error });
    return NextResponse.json({ error: "The stored file could not be read." }, { status: 404 });
  }
}
