import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const SUPABASE_CALLBACK =
  "https://btsbmozbggjllpcsuyyy.supabase.co/functions/v1/gmail-oauth-callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
].join(" ");

function b64url(buf: Buffer | string) {
  return (typeof buf === "string" ? Buffer.from(buf) : buf)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const stateSecret = process.env.GMAIL_OAUTH_STATE_SECRET;

  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID is not configured." },
      { status: 500 },
    );
  }
  if (!stateSecret) {
    return NextResponse.json(
      { error: "GMAIL_OAUTH_STATE_SECRET is not configured." },
      { status: 500 },
    );
  }

  const ctx = await requireAuthenticatedStaff();
  if (!ctx) {
    return NextResponse.json(
      {
        error:
          "You must be signed in as an active staff member to connect a Gmail account.",
      },
      { status: 401 },
    );
  }

  // Signed, short-lived OAuth state. Carries the authenticated user and
  // organization so the callback (which runs without a session) can attribute
  // the new connection to the correct clinician without trusting URL params.
  const payload = {
    u: ctx.userId,
    o: ctx.organizationId,
    n: b64url(randomBytes(12)),
    e: Math.floor(Date.now() / 1000) + 600, // 10 min TTL
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(
    createHmac("sha256", stateSecret).update(payloadB64).digest(),
  );
  const state = `${payloadB64}.${sig}`;

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", SUPABASE_CALLBACK);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  if (ctx.email) url.searchParams.set("login_hint", ctx.email);

  return NextResponse.redirect(url.toString(), 302);
}
