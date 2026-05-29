import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicPath =
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/check-in") ||
    pathname.startsWith("/api");

  const hasSupabaseSessionCookie = request.cookies
    .getAll()
    .some((cookie) => /sb-.*-auth-token/.test(cookie.name));

  if (!hasSupabaseSessionCookie && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSupabaseSessionCookie && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/calendar";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};