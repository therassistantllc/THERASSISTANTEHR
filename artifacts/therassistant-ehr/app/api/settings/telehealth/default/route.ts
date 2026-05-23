import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { isTelehealthPlatform } from "@/lib/telehealth/config";

export async function PATCH(request: Request) {
  const ctx = await requireAuthenticatedStaff();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { providerId?: string; platform?: string | null }
    | null;
  if (!body?.providerId) {
    return NextResponse.json({ error: "providerId is required" }, { status: 400 });
  }
  const platform = body.platform;
  if (platform !== null && platform !== undefined && !isTelehealthPlatform(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  const { error } = await supabase
    .from("provider_credentialing_profiles")
    .update({ default_telehealth_platform: platform ?? null } as any)
    .eq("organization_id", ctx.organizationId)
    .eq("id", body.providerId);

  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "42703" && /default_telehealth_platform/i.test(error.message ?? "")) {
      return NextResponse.json(
        {
          error:
            "default_telehealth_platform column not yet provisioned. Apply migration 20260527000000_telehealth_oauth.sql to your Supabase project.",
          degraded: true,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, providerId: body.providerId, platform: platform ?? null });
}
