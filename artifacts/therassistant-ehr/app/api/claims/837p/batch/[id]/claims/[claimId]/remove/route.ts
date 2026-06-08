import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const REMOVABLE_BATCH_STATUS = new Set(["draft", "ready_to_generate", "generated", "rejected", "failed"]);

/**
 * Removes a single professional_claim from an unsubmitted batch and releases
 * the claim back to ready_for_batch so it can be re-batched. Also flips the
 * batch status to "ready_to_generate" if it was "generated" so the next
 * generation pass picks up the new claim set.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; claimId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }
    const { id, claimId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: batch, error: lookupErr } = await supabase
      .from("claim_837p_batches")
      .select("id, batch_status, claim_count, total_charge_amount")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (lookupErr) return NextResponse.json({ success: false, error: lookupErr.message }, { status: 422 });
    if (!batch) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    const currentStatus = String((batch as Record<string, unknown>).batch_status ?? "");
    if (!REMOVABLE_BATCH_STATUS.has(currentStatus)) {
      return NextResponse.json(
        { success: false, error: `Claims cannot be removed from a batch in status "${currentStatus}".` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    const { data: linkRow, error: linkErr } = await supabase
      .from("claim_837p_batch_claims")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("batch_id", id)
      .eq("professional_claim_id", claimId)
      .is("archived_at", null)
      .maybeSingle();
    if (linkErr) return NextResponse.json({ success: false, error: linkErr.message }, { status: 422 });
    if (!linkRow) return NextResponse.json({ success: false, error: "Claim is not part of this batch" }, { status: 404 });

    const { error: archiveErr } = await supabase
      .from("claim_837p_batch_claims")
      .update({ archived_at: now })
      .eq("id", (linkRow as { id: string }).id);
    if (archiveErr) return NextResponse.json({ success: false, error: archiveErr.message }, { status: 422 });

    await supabase
      .from("professional_claims")
      .update({ claim_status: "ready_for_batch", updated_at: now })
      .eq("organization_id", organizationId)
      .eq("id", claimId);

    // Recompute claim_count + total from remaining links.
    const { data: remainingLinks } = await supabase
      .from("claim_837p_batch_claims")
      .select("professional_claim_id")
      .eq("organization_id", organizationId)
      .eq("batch_id", id)
      .is("archived_at", null);

    const remainingIds = ((remainingLinks ?? []) as Array<{ professional_claim_id: string | null }>)
      .map((r) => String(r.professional_claim_id ?? ""))
      .filter(Boolean);
    let total = 0;
    if (remainingIds.length > 0) {
      const { data: claimRows } = await supabase
        .from("professional_claims")
        .select("total_charge")
        .eq("organization_id", organizationId)
        .in("id", remainingIds);
      total = ((claimRows ?? []) as Array<{ total_charge: number | null }>)
        .reduce((sum, c) => sum + Number(c.total_charge ?? 0), 0);
    }

    const nextStatus = currentStatus === "generated" ? "ready_to_generate" : currentStatus;
    await supabase
      .from("claim_837p_batches")
      .update({
        batch_status: nextStatus,
        claim_count: remainingIds.length,
        total_charge_amount: Math.round(total * 100) / 100,
        generated_file_content: currentStatus === "generated" ? null : undefined,
        generated_file_name: currentStatus === "generated" ? null : undefined,
        updated_at: now,
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    return NextResponse.json({
      success: true,
      batchId: id,
      removedClaimId: claimId,
      remainingClaims: remainingIds.length,
      remainingTotalCharge: total,
      status: nextStatus,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Remove claim failed" },
      { status: 500 },
    );
  }
}
