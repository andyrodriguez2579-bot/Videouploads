import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/cookie";

/**
 * Coarse gate only: presence of a session cookie. The cookie's signature is
 * verified in `getSessionUser()` on every page and action, because middleware
 * runs on the edge runtime where the full auth stack is not available.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // /api/health must stay reachable for container and uptime checks.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
