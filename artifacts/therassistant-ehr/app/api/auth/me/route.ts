/**
 * GET /api/auth/me
 * Returns the current authenticated user's context
 * (staffId, organizationId, roles, permissions)
 *
 * Example: Call from client to load user context on app startup
 */

import { NextResponse } from "next/server";
import { requireAuthentication } from "@/lib/rbac/middleware";
import { getAuthenticatedUser, getProviderIdForUser } from "@/lib/rbac/auth";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const contextOrError = await requireAuthentication();

  if (contextOrError instanceof NextResponse) {
    return contextOrError;
  }

  const { staffId, organizationId, email, firstName, lastName, roles, permissions } = contextOrError;

  const authUser = await getAuthenticatedUser();
  const providerId = authUser
    ? await getProviderIdForUser(authUser.userId, organizationId)
    : null;

  let organizationName: string | null = null;
  let organizationLogoUrl: string | null = null;
  const supabase = createServerSupabaseAdminClient();
  if (supabase && organizationId) {
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

  return NextResponse.json({
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
}
