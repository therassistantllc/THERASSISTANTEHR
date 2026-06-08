/**
 * GET /api/billing/recoupments/notes?recoupmentId=…
 *
 * Returns the audit_logs trail for a single payment_recoupments row —
 * dispute / accept / refund / offset / note actions in chronological order.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

export async function GET(request: Request) {
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

    const recoupmentId = (searchParams.get("recoupmentId") ?? "").trim();
    if (!recoupmentId) {
      return NextResponse.json(
        { success: false, error: "Missing recoupmentId" },
        { status: 400 },
      );
    }

    const { data, error } = await (supabase as any)
      .from("audit_logs")
      .select("event_type, event_summary, event_metadata, created_at")
      .eq("organization_id", organizationId)
      .eq("object_id", recoupmentId)
      .ilike("event_type", "recoupment_%")
      .order("created_at", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      success: true,
      organizationId,
      rows: data ?? [],
    });
  } catch (error) {
    console.error("Recoupment notes API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load notes",
      },
      { status: 500 },
    );
  }
}
