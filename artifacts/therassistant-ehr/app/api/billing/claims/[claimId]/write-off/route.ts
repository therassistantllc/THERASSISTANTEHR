import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const ALLOWED_REASONS = new Set([
  "small_balance",
  "bad_debt",
  "contractual",
  "timely_filing",
  "no_authorization",
  "patient_deceased",
  "charity_care",
  "other",
]);

export async function PATCH(request: Request, ctx: { params: Promise<{ claimId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { claimId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const requestedOrganizationId = body?.organizationId ?? null;

    const guard = await requireBillingAccess({ requestedOrganizationId });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const amount = Number(body?.amount);
    const reason = String(body?.reason ?? "").trim();
    const comment = body?.comment ? String(body.comment) : null;

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "amount must be greater than zero" }, { status: 400 });
    }
    if (!ALLOWED_REASONS.has(reason)) {
      return NextResponse.json({ success: false, error: "Invalid write-off reason" }, { status: 400 });
    }

    const { data: claim, error: claimErr } = await (supabase as any)
      .from("professional_claims")
      .select("id, organization_id")
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (claimErr) throw claimErr;
    if (!claim) return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });

    const { error: updateErr } = await (supabase as any)
      .from("professional_claims")
      .update({
        write_off_amount: Math.round(amount * 100) / 100,
        write_off_reason: reason,
        write_off_comment: comment,
        write_off_at: new Date().toISOString(),
        write_off_by_user_id: guard.userId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimId)
      .eq("organization_id", organizationId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, claimId });
  } catch (error) {
    console.error("Claim write-off API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Write-off failed" },
      { status: 500 },
    );
  }
}
