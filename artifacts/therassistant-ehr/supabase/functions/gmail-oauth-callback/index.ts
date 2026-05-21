// @ts-expect-error - Deno edge runtime URL import is valid at runtime but not resolvable by this TS config.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-expect-error - Deno npm: specifier is valid at runtime but not resolvable by this TS config.
import { createClient } from "npm:@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL")!;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const STATE_SECRET = Deno.env.get("GMAIL_OAUTH_STATE_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const REDIRECT_URI =
  "https://btsbmozbggjllpcsuyyy.supabase.co/functions/v1/gmail-oauth-callback";

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlDecodeToString(s: string): string {
  return new TextDecoder().decode(b64urlDecode(s));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(sig);
}

async function verifyState(state: string): Promise<{
  userId: string;
  organizationId: string;
}> {
  const dot = state.lastIndexOf(".");
  if (dot < 0) throw new Error("Malformed state");
  const payloadB64 = state.slice(0, dot);
  const sigB64 = state.slice(dot + 1);

  const expected = await hmacSha256(STATE_SECRET, payloadB64);
  const got = b64urlDecode(sigB64);
  if (!timingSafeEqual(expected, got)) {
    throw new Error("Invalid OAuth state signature");
  }

  const payload = JSON.parse(b64urlDecodeToString(payloadB64));
  if (
    typeof payload.u !== "string" ||
    typeof payload.o !== "string" ||
    typeof payload.e !== "number"
  ) {
    throw new Error("Invalid OAuth state payload");
  }
  if (Math.floor(Date.now() / 1000) > payload.e) {
    throw new Error("OAuth state expired");
  }
  return { userId: payload.u, organizationId: payload.o };
}

async function googleGet(path: string, accessToken: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google API error ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");

    if (!code || !stateRaw) {
      return new Response("Missing code/state", { status: 400 });
    }

    const { userId, organizationId } = await verifyState(stateRaw);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(await tokenRes.text());
    }

    const token = await tokenRes.json();
    if (!token.refresh_token) {
      throw new Error(
        "Google did not return a refresh_token. Disconnect and reconnect to grant offline access.",
      );
    }

    const profile = await googleGet("/users/me/profile", token.access_token);
    const email = profile.emailAddress;

    // Upsert the per-user connection. Conflict target matches the partial
    // unique index ic_org_type_user_uniq (organization_id, integration_type,
    // owner_user_id) WHERE owner_user_id IS NOT NULL.
    const { data: connection, error: connError } = await supabase
      .from("integration_connections")
      .upsert(
        {
          organization_id: organizationId,
          integration_type: "gmail",
          owner_user_id: userId,
          scope_kind: "user",
          connection_status: "connected",
          display_name: `Gmail - ${email}`,
          external_account_email: email,
          metadata: {},
          sync_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,integration_type,owner_user_id" },
      )
      .select("id, organization_id")
      .single();

    if (connError) throw connError;

    const expiresAt = new Date(
      Date.now() + token.expires_in * 1000,
    ).toISOString();

    const { error: tokenError } = await supabase
      .from("gmail_oauth_tokens")
      .upsert(
        {
          organization_id: organizationId,
          integration_connection_id: connection.id,
          email,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_type: token.token_type,
          scope: token.scope,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "integration_connection_id" },
      );

    if (tokenError) throw tokenError;

    const { error: updateError } = await supabase
      .from("integration_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    if (updateError) throw updateError;

    return Response.redirect(
      `${APP_BASE_URL}/email?connected=1`,
      302,
    );
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 500 });
  }
});
