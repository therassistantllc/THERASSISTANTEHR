import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { assertClaimReadyForSubmission } from "@/lib/validation/claimSubmissionGate";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const organizationId = String(body.organizationId ?? "").trim();
    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });

    // Confirm the batch is in this org before doing anything else.
    const { data: batch, error: batchErr } = await supabase
      .from("claim_837p_batches")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (batchErr) return NextResponse.json({ success: false, error: batchErr.message }, { status: 422 });
    if (!batch) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    const { data: links, error: linkErr } = await supabase
      .from("claim_837p_batch_claims")
      .select("professional_claim_id")
      .eq("batch_id", id)
      .eq("organization_id", organizationId)
      .is("archived_at", null);
    if (linkErr) return NextResponse.json({ success: false, error: linkErr.message }, { status: 422 });

    const claimIds = ((links ?? []) as Array<{ professional_claim_id: string }>).map((r) => String(r.professional_claim_id));
    let passed = 0;
    const failed: Array<{ claimId: string; reason: string }> = [];
    for (const cid of claimIds) {
      const gate = await assertClaimReadyForSubmission({ organizationId, claimId: cid });
      if (gate.ok) {
        passed++;
        await supabase
          .from("professional_claims")
          .update({ claim_status: "ready", updated_at: new Date().toISOString() })
          .eq("id", cid)
          .eq("organization_id", organizationId)
          .eq("claim_status", "validation_failed");
      } else {
        failed.push({ claimId: cid, reason: gate.reason ?? "blocked" });
      }
    }

    return NextResponse.json({ success: true, total: claimIds.length, passed, failed });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
