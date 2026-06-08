/**
 * GET /api/billing/documentation-pending/treatment-plan?clientId=…
 *
 * Returns the most recent active treatment plan for the client, used
 * by the Documentation Pending right-side panel.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();

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

    const clientId = searchParams.get("clientId");
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Missing clientId" },
        { status: 400 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await (supabase as any)
      .from("treatment_plans")
      .select("id, plan_status, start_date, end_date, next_review_date")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("plan_status", "active")
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) throw error;

    const row = ((data ?? []) as DbRow[])[0];
    return NextResponse.json({
      success: true,
      organizationId,
      plan: row
        ? {
            id: text(row.id),
            plan_status: text(row.plan_status) || "—",
            start_date: (row.start_date as string | null) ?? null,
            end_date: (row.end_date as string | null) ?? null,
            next_review_date: (row.next_review_date as string | null) ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("Documentation Pending treatment-plan error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load treatment plan",
      },
      { status: 500 },
    );
  }
}
