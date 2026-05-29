import { NextResponse } from "next/server";

function isAuthCookieName(name: string): boolean {
  return /^sb-.*-auth-token(?:\.\d+)?$/.test(name);
}

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true });

  const cookieHeader = request.headers.get("cookie") || "";
  const cookieNames = cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean);

  for (const cookieName of cookieNames) {
    if (isAuthCookieName(cookieName)) {
      response.cookies.set(cookieName, "", {
        path: "/",
        expires: new Date(0),
        maxAge: 0,
      });
    }
  }

  return response;
}
