/**
 * /api/billing/claims/[claimId]/void
 *
 * POST — void (soft-delete) a claim.
 *   Body: { organizationId, reason? }
 *
 * Behaviour:
 *   - Claims in status draft / on_hold / error / rejected / denied:
 *     set archived_at + claim_status = 'cancelled'
 *   - Claims in status submitted / accepted / paid:
 *     set archived_at + claim_status = 'cancelled' (keep all data, no hard delete)
 *   - Clears all hold fields so it no longer appears in the hold workqueue.
 *   - Writes a claim_status_events audit row.
 *
 * Returns { success: true, claimId, previousStatus }
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

export async function POST(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    if (!claimId) {
      return NextResponse.json({ success: false, error: "claimId is required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      organizationId?: string;
      reason?: string;
    };

    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database not available" }, { status: 500 });
    }

    // Load the claim
    const { data: claim, error: loadErr } = await (supabase as any)
      .from("professional_claims")
      .select("id, organization_id, claim_status, archived_at")
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (loadErr) throw loadErr;
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }
    if (claim.archived_at) {
      return NextResponse.json({ success: false, error: "Claim is already voided" }, { status: 409 });
    }

    const previousStatus = text(claim.claim_status);
    const nowIso = new Date().toISOString();

    // Resolve actor name for audit trail
    let actorName = "Staff";
    if (guard.staffId) {
      const { data: staff } = await (supabase as any)
        .from("staff_profiles")
        .select("first_name, last_name, email")
        .eq("id", guard.staffId)
        .maybeSingle();
      if (staff) {
        const composed = [staff.first_name, staff.last_name].map(text).filter(Boolean).join(" ");
        actorName = composed || text(staff.email) || "Staff";
      }
    }

    const reason = text(body.reason) || "Voided by biller";

    // Soft-delete: archive + cancel, clear all hold fields
    const { error: updErr } = await (supabase as any)
      .from("professional_claims")
      .update({
        claim_status: "cancelled",
        archived_at: nowIso,
        hold_category: null,
        hold_reason: null,
        held_by_user_id: null,
        held_by_display_name: null,
        hold_started_at: null,
        hold_follow_up_date: null,
        hold_assigned_to_user_id: null,
        hold_assigned_to_display_name: null,
        hold_priority: null,
        updated_at: nowIso,
      })
      .eq("id", claimId)
      .eq("organization_id", organizationId);

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 422 });
    }

    // Audit trail
    await (supabase as any).from("claim_status_events").insert({
      claim_id: claimId,
      source: "biller",
      status: "cancelled",
      status_message: `Claim voided by ${actorName}: ${reason}`,
      raw_payload: { previousStatus, reason, actorName },
      created_at: nowIso,
    });

    return NextResponse.json({ success: true, claimId, previousStatus });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to void claim" },
      { status: 500 },
    );
  }
}
