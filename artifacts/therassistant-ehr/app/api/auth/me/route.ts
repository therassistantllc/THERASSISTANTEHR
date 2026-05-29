/**
 * GET /api/auth/me
 * Returns the current authenticated user's context
 * (staffId, organizationId, roles, permissions)
 *
 * Example: Call from client to load user context on app startup
 */

import { NextResponse } from "next/server";
import { getProviderIdForUser, requireAuthenticatedStaffFromAccessToken } from "@/lib/rbac/auth";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

const SERVER_AUTH_COOKIE = "sb-therassistant-auth-token";

function parseBooleanFlag(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const contextOrError = await requireAuthenticatedStaffFromAccessToken(token);
  if (!contextOrError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { staffId, organizationId, email, firstName, lastName, roles, permissions } = contextOrError;
  const url = new URL(request.url);
  const includeProvider = parseBooleanFlag(url.searchParams.get("includeProvider"));
  const includeOrganization = parseBooleanFlag(url.searchParams.get("includeOrganization"));

  let providerId: string | null = null;
  if (includeProvider) {
    providerId = contextOrError.userId
      ? await getProviderIdForUser(contextOrError.userId, organizationId)
      : null;
  }

  let organizationName: string | null = null;
  let organizationLogoUrl: string | null = null;
  const supabase = createServerSupabaseAdminClient();
  if (includeOrganization && supabase && organizationId) {
    const { data } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    organizationName = (data as { name?: string | null } | null)?.name ?? null;

    const { data: settingsRow } = await supabase
      .from("system_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", "organization.billing_profile")
      .maybeSingle();
    const profile =
      settingsRow?.setting_value &&
      typeof settingsRow.setting_value === "object" &&
      !Array.isArray(settingsRow.setting_value)
        ? (settingsRow.setting_value as Record<string, unknown>)
        : null;
    const bucket = profile && typeof profile.letterhead_logo_bucket === "string"
      ? (profile.letterhead_logo_bucket as string) : null;
    const path = profile && typeof profile.letterhead_logo_path === "string"
      ? (profile.letterhead_logo_path as string) : null;
    if (bucket && path) {
      const updatedAt = typeof profile?.letterhead_logo_updated_at === "string"
        ? (profile!.letterhead_logo_updated_at as string)
        : path;
      organizationLogoUrl =
        `/api/settings/organization/logo/preview?organizationId=${encodeURIComponent(organizationId)}&v=${encodeURIComponent(updatedAt)}`;
    }
  }

  const response = NextResponse.json({
    staffId,
    organizationId,
    organizationName,
    organizationLogoUrl,
    email,
    firstName,
    lastName,
    roles,
    permissions,
    providerId,
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
