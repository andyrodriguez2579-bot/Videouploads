import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";

/**
 * Serves objects from local storage behind the session check.
 *
 * Only keys that appear in `media_assets` are served: without that lookup, a
 * signed-in user could read any file under the storage root by guessing a path.
 * When STORAGE_DRIVER=s3 this route is unused — the client gets a presigned URL.
 */
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

  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.objectKey, key))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const body = await getStorage().get(key);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": asset.mimeType ?? "application/octet-stream",
        "Content-Length": String(body.byteLength),
        // Assets are immutable once uploaded — a new upload gets a new key.
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(asset.title)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[files] read failed", { key, error });
    return NextResponse.json({ error: "The stored file could not be read." }, { status: 404 });
  }
}
