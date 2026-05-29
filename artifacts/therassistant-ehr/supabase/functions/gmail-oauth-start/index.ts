// @ts-expect-error - Deno edge runtime URL import is valid at runtime but not resolvable by this TS config.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const STATE_SECRET = Deno.env.get("GMAIL_OAUTH_STATE_SECRET")!;

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlEncodeBytes(input: Uint8Array): string {
  let bin = "";
  for (const b of input) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function signState(payload: { u: string; o: string; e: number }) {
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(STATE_SECRET, payloadB64);
  return `${payloadB64}.${b64urlEncodeBytes(signature)}`;
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organization_id");
  const userId = url.searchParams.get("user_id");

  if (!organizationId || !userId) {
    return new Response("Missing organization_id or user_id", { status: 400 });
  }
  if (!STATE_SECRET) {
    return new Response("Missing OAuth state secret", { status: 503 });
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/gmail-oauth-callback`;
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const state = await signState({ u: userId, o: organizationId, e: expiresAt });

  const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  oauthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("access_type", "offline");
  oauthUrl.searchParams.set("prompt", "consent");
  oauthUrl.searchParams.set("include_granted_scopes", "true");
  oauthUrl.searchParams.set("scope", [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "openid",
    "email",
    "profile",
  ].join(" "));
  oauthUrl.searchParams.set("state", state);

  return Response.redirect(oauthUrl.toString(), 302);
});