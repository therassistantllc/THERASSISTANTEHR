import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "./crypto";
import { getPlatformConfig, type TelehealthPlatform } from "./config";
import type { AdapterAuth } from "./adapters/types";

type DbAny = SupabaseClient<any, any, any>;

export type StoredTelehealthConnection = {
  connectionId: string;
  organizationId: string;
  ownerUserId: string | null;
  platform: TelehealthPlatform;
  accountEmail: string | null;
  status: string;
  scope: string | null;
  expiresAt: Date | null;
  lastRefreshedAt: Date | null;
  lastError: string | null;
};

export type TokenRecord = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  accountEmail: string | null;
};

export async function listConnectionsForUser(
  supabase: DbAny,
  organizationId: string,
  ownerUserId: string,
): Promise<StoredTelehealthConnection[]> {
  const { data: conns, error: connErr } = await supabase
    .from("integration_connections")
    .select(
      "id, organization_id, owner_user_id, integration_type, connection_status, external_account_email",
    )
    .eq("organization_id", organizationId)
    .eq("owner_user_id", ownerUserId)
    .in("integration_type", ["zoom", "google_meet"]);
  if (connErr) throw connErr;
  if (!conns || conns.length === 0) return [];

  const ids = conns.map((c) => c.id);
  const { data: tokens, error: tokErr } = await supabase
    .from("telehealth_oauth_tokens")
    .select("integration_connection_id, scope, account_email, expires_at, last_refreshed_at, last_error")
    .in("integration_connection_id", ids);
  if (tokErr) throw tokErr;

  const byId = new Map<string, any>();
  (tokens ?? []).forEach((t) => byId.set(t.integration_connection_id, t));

  return conns.map((c) => {
    const t = byId.get(c.id);
    return {
      connectionId: c.id,
      organizationId: c.organization_id,
      ownerUserId: c.owner_user_id,
      platform: c.integration_type as TelehealthPlatform,
      accountEmail: c.external_account_email ?? t?.account_email ?? null,
      status: c.connection_status ?? "unknown",
      scope: t?.scope ?? null,
      expiresAt: t?.expires_at ? new Date(t.expires_at) : null,
      lastRefreshedAt: t?.last_refreshed_at ? new Date(t.last_refreshed_at) : null,
      lastError: t?.last_error ?? null,
    };
  });
}

export async function upsertConnection(
  supabase: DbAny,
  params: {
    organizationId: string;
    ownerUserId: string;
    platform: TelehealthPlatform;
    accountEmail: string | null;
    tokens: TokenRecord;
  },
): Promise<string> {
  const { data: existing, error: existingErr } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("owner_user_id", params.ownerUserId)
    .eq("integration_type", params.platform)
    .maybeSingle();
  if (existingErr) throw existingErr;

  let connectionId: string;
  if (existing) {
    connectionId = existing.id;
    const { error: updErr } = await supabase
      .from("integration_connections")
      .update({
        connection_status: "active",
        external_account_email: params.accountEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);
    if (updErr) throw updErr;
  } else {
    const { data: ins, error: insErr } = await supabase
      .from("integration_connections")
      .insert({
        organization_id: params.organizationId,
        owner_user_id: params.ownerUserId,
        integration_type: params.platform,
        connection_status: "active",
        external_account_email: params.accountEmail,
      } as any)
      .select("id")
      .single();
    if (insErr) throw insErr;
    connectionId = ins.id;
  }

  const tokenRow = {
    integration_connection_id: connectionId,
    organization_id: params.organizationId,
    owner_user_id: params.ownerUserId,
    platform: params.platform,
    access_token_enc: encryptToken(params.tokens.accessToken),
    refresh_token_enc: params.tokens.refreshToken ? encryptToken(params.tokens.refreshToken) : null,
    scope: params.tokens.scope,
    account_email: params.accountEmail,
    expires_at: params.tokens.expiresAt ? params.tokens.expiresAt.toISOString() : null,
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const { error: tokErr } = await supabase
    .from("telehealth_oauth_tokens")
    .upsert(tokenRow as any, { onConflict: "integration_connection_id" });
  if (tokErr) throw tokErr;

  return connectionId;
}

export async function deleteConnection(
  supabase: DbAny,
  connectionId: string,
): Promise<void> {
  await supabase.from("telehealth_oauth_tokens").delete().eq("integration_connection_id", connectionId);
  await supabase.from("integration_connections").delete().eq("id", connectionId);
}

export async function loadAuthForProvider(
  supabase: DbAny,
  params: { organizationId: string; ownerUserId: string; platform: TelehealthPlatform },
): Promise<AdapterAuth | null> {
  const { data: conn } = await supabase
    .from("integration_connections")
    .select("id, external_account_email")
    .eq("organization_id", params.organizationId)
    .eq("owner_user_id", params.ownerUserId)
    .eq("integration_type", params.platform)
    .eq("connection_status", "active")
    .maybeSingle();
  if (!conn) return null;
  const { data: tok } = await supabase
    .from("telehealth_oauth_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at, account_email")
    .eq("integration_connection_id", conn.id)
    .maybeSingle();
  if (!tok) return null;

  let accessToken = decryptToken(tok.access_token_enc);
  const refreshToken = tok.refresh_token_enc ? decryptToken(tok.refresh_token_enc) : null;
  let expiresAt = tok.expires_at ? new Date(tok.expires_at) : null;

  if (refreshToken && expiresAt && expiresAt.getTime() < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(params.platform, refreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      expiresAt = refreshed.expiresAt;
      await supabase
        .from("telehealth_oauth_tokens")
        .update({
          access_token_enc: encryptToken(refreshed.accessToken),
          expires_at: refreshed.expiresAt ? refreshed.expiresAt.toISOString() : null,
          last_refreshed_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("integration_connection_id", conn.id);
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    accountEmail: (conn as any).external_account_email ?? tok.account_email ?? null,
  };
}

async function refreshAccessToken(
  platform: TelehealthPlatform,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null } | null> {
  const cfg = getPlatformConfig(platform);
  if (!cfg) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (platform === "zoom") {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
  };
}
