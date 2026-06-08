import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { isTelehealthPlatform } from "@/lib/telehealth/config";
import { deleteConnection } from "@/lib/telehealth/connections";

export async function POST(
  _request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  if (!isTelehealthPlatform(platform)) {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }
  const ctx = await requireAuthenticatedStaff();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  const { data: conn, error: lookupErr } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("owner_user_id", ctx.userId)
    .eq("integration_type", platform)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!conn) return NextResponse.json({ success: true, alreadyDisconnected: true });

  try {
    await deleteConnection(supabase as any, conn.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Disconnect failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}
