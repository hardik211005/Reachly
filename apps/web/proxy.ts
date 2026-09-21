import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Edge gate for page routes: unauthenticated visitors to app pages are redirected to
 * /login (cheap cookie presence check). Real session validation happens server-side in
 * requireWorkspace()/route handlers — this only avoids rendering protected shells.
 * (Signed-in users visiting /login are redirected by the page itself after validating
 * the session, so a stale cookie can never cause a redirect loop.)
 */
const PROTECTED_PREFIXES = ["/app", "/onboarding"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  response.headers.set("x-request-id", crypto.randomUUID());
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
