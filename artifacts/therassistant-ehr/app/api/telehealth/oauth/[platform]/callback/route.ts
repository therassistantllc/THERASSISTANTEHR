import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  deriveAppOrigin,
  getPlatformConfig,
  isTelehealthPlatform,
  redirectUriFor,
  type TelehealthPlatform,
} from "@/lib/telehealth/config";
import { verifyOAuthState } from "@/lib/telehealth/oauthState";
import { upsertConnection } from "@/lib/telehealth/connections";

function settingsRedirect(origin: string, success: boolean, message?: string): NextResponse {
  const url = new URL(`${origin}/settings/providers`);
  url.searchParams.set(success ? "telehealth_connected" : "telehealth_error", message ?? (success ? "1" : "failed"));
  return NextResponse.redirect(url.toString(), 302);
}

async function exchangeCode(
  platform: TelehealthPlatform,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope: string | null } | null> {
  const cfg = getPlatformConfig(platform);
  if (!cfg) return null;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (platform === "zoom") {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) {
    console.error(`[telehealth/${platform}] token exchange failed`, res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    scope: json.scope ?? null,
  };
}

async function fetchAccountEmail(platform: TelehealthPlatform, accessToken: string): Promise<string | null> {
  try {
    if (platform === "zoom") {
      const res = await fetch("https://api.zoom.us/v2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { email?: string };
      return json.email ?? null;
    }
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const origin = deriveAppOrigin(request);
  const { platform } = await context.params;
  if (!isTelehealthPlatform(platform)) {
    return settingsRedirect(origin, false, "unsupported_platform");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return settingsRedirect(origin, false, error);
  if (!code || !state) return settingsRedirect(origin, false, "missing_params");

  const payload = verifyOAuthState(state);
  if (!payload || payload.p !== platform) return settingsRedirect(origin, false, "invalid_state");

  const redirectUri = redirectUriFor(platform, origin);
  const tokens = await exchangeCode(platform, code, redirectUri);
  if (!tokens) return settingsRedirect(origin, false, "token_exchange_failed");

  const accountEmail = await fetchAccountEmail(platform, tokens.accessToken);

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return settingsRedirect(origin, false, "db_unavailable");

  try {
    await upsertConnection(supabase as any, {
      organizationId: payload.o,
      ownerUserId: payload.u,
      platform,
      accountEmail,
      tokens: { ...tokens, accountEmail },
    });
  } catch (e) {
    console.error(`[telehealth/${platform}] upsertConnection failed`, e);
    return settingsRedirect(origin, false, "persist_failed");
  }

  return settingsRedirect(origin, true, platform);
}
