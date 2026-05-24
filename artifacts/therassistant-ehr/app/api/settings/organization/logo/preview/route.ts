/**
 * GET /api/settings/organization/logo/preview
 *
 * Streams the currently-saved letterhead logo bytes back as `image/jpeg` so
 * the Organization Settings UI can show a live thumbnail without leaking a
 * raw, publicly-accessible storage URL. Caller must have org access.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

const BILLING_PROFILE_KEY = "organization.billing_profile";

export async function GET(req: NextRequest) {
  const guard = await requireOrgAccess({
    requestedOrganizationId: req.nextUrl.searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  const { data: row } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("organization_id", organizationId)
    .eq("setting_key", BILLING_PROFILE_KEY)
    .maybeSingle();
  const profile =
    row?.setting_value && typeof row.setting_value === "object" && !Array.isArray(row.setting_value)
      ? (row.setting_value as Record<string, unknown>)
      : {};
  const bucket = typeof profile.letterhead_logo_bucket === "string"
    ? (profile.letterhead_logo_bucket as string) : null;
  const path = typeof profile.letterhead_logo_path === "string"
    ? (profile.letterhead_logo_path as string) : null;
  if (!bucket || !path) {
    return NextResponse.json({ error: "No logo configured" }, { status: 404 });
  }

  // Defense in depth: even though the PATCH /organization route strips
  // client-supplied logo location keys, refuse to dereference anything that
  // isn't in the canonical letterhead scope before handing the path to the
  // admin storage client. Bucket must be the dedicated letterhead bucket and
  // the object must live under this org's letterhead/ prefix.
  const ALLOWED_BUCKET = "organization-assets";
  const requiredPrefix = `${organizationId}/letterhead/`;
  if (
    bucket !== ALLOWED_BUCKET ||
    !path.startsWith(requiredPrefix) ||
    path.includes("..")
  ) {
    return NextResponse.json({ error: "No logo configured" }, { status: 404 });
  }

  const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
  if (dlErr || !blob) {
    return NextResponse.json(
      { error: dlErr?.message || "Logo not found in storage" },
      { status: 404 },
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
