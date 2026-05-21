import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });

    const { data, error } = await supabase
      .from("providers")
      .select("id, first_name, last_name, display_name, credential, npi, provider_type, is_active")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    const providers = (data ?? []).map((row: Record<string, unknown>) => {
      const first = String(row.first_name ?? "").trim();
      const last = String(row.last_name ?? "").trim();
      const display = String(row.display_name ?? "").trim() || [first, last].filter(Boolean).join(" ");
      return {
        id: String(row.id),
        provider_name: display || "Unnamed provider",
        credential_display: row.credential ? String(row.credential) : null,
        npi: row.npi ? String(row.npi) : null,
        is_active: row.is_active !== false,
      };
    });

    return NextResponse.json({ success: true, organizationId, providers });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
