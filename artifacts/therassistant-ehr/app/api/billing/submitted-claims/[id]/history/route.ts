import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { id: claimId } = await ctx.params;

    // Tenant check: claim must belong to the requesting org.
    const { data: claim, error: claimErr } = await supabase
      .from("professional_claims")
      .select("id")
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (claimErr) {
      return NextResponse.json({ success: false, error: claimErr.message }, { status: 422 });
    }
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("claim_status_events")
      .select("id, status, status_message, source, created_at, raw_payload")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({ success: true, events: data ?? [] });
  } catch (error) {
    console.error("submitted-claims history error", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load history",
      },
      { status: 500 },
    );
  }
}
