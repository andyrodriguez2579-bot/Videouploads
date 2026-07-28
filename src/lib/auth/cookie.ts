/**
 * The session cookie name, isolated in a dependency-free module.
 *
 * `middleware.ts` runs on the edge runtime and cannot import `next/headers` or
 * anything marked `server-only`, so it must not reach into `session.ts` just to
 * learn this string.
 */
export const SESSION_COOKIE = "historia_session";
