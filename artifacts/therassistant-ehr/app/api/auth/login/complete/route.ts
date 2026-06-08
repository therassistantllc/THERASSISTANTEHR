import { NextResponse } from "next/server";
import { requireAuthenticatedStaffFromAccessToken } from "@/lib/rbac/auth";

const SERVER_AUTH_COOKIE = "sb-therassistant-auth-token";

function normalizeNext(next: string | null): string {
  if (!next) return "/calendar";
  if (!next.startsWith("/")) return "/calendar";
  if (next.startsWith("//")) return "/calendar";
  return next;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const context = await requireAuthenticatedStaffFromAccessToken(token);
  if (!context) {
    return NextResponse.json({ success: false, error: "Unable to sign in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const next = normalizeNext(url.searchParams.get("next"));

  const response = NextResponse.json({
    success: true,
    next,
    staffId: context.staffId,
    organizationId: context.organizationId,
    roles: context.roles,
  });

  if (token) {
    response.cookies.set({
      name: SERVER_AUTH_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });
  }

  return response;
}
