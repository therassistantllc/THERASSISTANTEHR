import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const CANCELLABLE = new Set(["draft", "ready_to_generate", "generated", "rejected", "failed"]);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: batch, error: lookupErr } = await supabase
      .from("claim_837p_batches")
      .select("id, batch_status")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (lookupErr) return NextResponse.json({ success: false, error: lookupErr.message }, { status: 422 });
    if (!batch) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    const currentStatus = String((batch as Record<string, unknown>).batch_status ?? "");
    if (!CANCELLABLE.has(currentStatus)) {
      return NextResponse.json(
        { success: false, error: `Batch in status "${currentStatus}" cannot be cancelled.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    const { data: linkRows } = await supabase
      .from("claim_837p_batch_claims")
      .select("professional_claim_id")
      .eq("organization_id", organizationId)
      .eq("batch_id", id)
      .is("archived_at", null);
    const claimIds = ((linkRows ?? []) as Array<{ professional_claim_id: string | null }>)
      .map((r) => String(r.professional_claim_id ?? ""))
      .filter(Boolean);

    const { error: updateErr } = await supabase
      .from("claim_837p_batches")
      .update({ batch_status: "cancelled", updated_at: now })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (updateErr) return NextResponse.json({ success: false, error: updateErr.message }, { status: 422 });

    if (claimIds.length > 0) {
      await supabase
        .from("claim_837p_batch_claims")
        .update({ archived_at: now })
        .eq("organization_id", organizationId)
        .eq("batch_id", id);

      await supabase
        .from("professional_claims")
        .update({ claim_status: "ready_for_batch", updated_at: now })
        .eq("organization_id", organizationId)
        .in("id", claimIds)
        .eq("claim_status", "batched");
    }

    return NextResponse.json({ success: true, batchId: id, status: "cancelled", releasedClaims: claimIds.length });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Cancel batch failed" },
      { status: 500 },
    );
  }
}
