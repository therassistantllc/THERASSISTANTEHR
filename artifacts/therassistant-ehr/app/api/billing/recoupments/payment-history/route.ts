/**
 * GET /api/billing/recoupments/payment-history?claimId=…
 *
 * Returns prior ERA payments posted against a single professional claim, so
 * the recoupments detail panel can show contract/payment history.
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

    const claimId = (searchParams.get("claimId") ?? "").trim();
    if (!claimId) {
      return NextResponse.json(
        { success: false, error: "Missing claimId" },
        { status: 400 },
      );
    }

    const { data, error } = await (supabase as any)
      .from("era_claim_payments")
      .select(
        "id, clp04_payment_amount, check_eft_number, check_issue_date, posting_status, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("professional_claim_id", claimId)
      .is("archived_at", null)
      .order("check_issue_date", { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) throw error;

    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      payment_amount: Number(r.clp04_payment_amount ?? 0),
      check_eft_number: r.check_eft_number ? String(r.check_eft_number) : null,
      check_issue_date: r.check_issue_date ? String(r.check_issue_date) : null,
      posting_status: String(r.posting_status ?? ""),
      created_at: String(r.created_at ?? ""),
    }));

    return NextResponse.json({
      success: true,
      organizationId,
      rows,
    });
  } catch (error) {
    console.error("Recoupment history API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load history",
      },
      { status: 500 },
    );
  }
}
