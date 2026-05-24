import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const REBUILDABLE = new Set(["draft", "ready_to_generate", "generated", "rejected", "failed"]);

/**
 * Resets a batch back to "ready_to_generate" so the spec-compliant 837P
 * generator can rebuild its content. Clears any stale generated file,
 * submission error, and submission attempt counters. Does NOT detach claims.
 */
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
    if (!REBUILDABLE.has(currentStatus)) {
      return NextResponse.json(
        { success: false, error: `Batch in status "${currentStatus}" cannot be rebuilt.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("claim_837p_batches")
      .update({
        batch_status: "ready_to_generate",
        generated_file_content: null,
        generated_file_name: null,
        submission_error: null,
        submission_attempt_count: 0,
        submission_idempotency_key: null,
        last_submission_endpoint: null,
        last_submission_http_status: null,
        last_submission_attempted_at: null,
        submitted_at: null,
        updated_at: now,
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateErr) return NextResponse.json({ success: false, error: updateErr.message }, { status: 422 });
    return NextResponse.json({ success: true, batchId: id, status: "ready_to_generate" });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Rebuild batch failed" },
      { status: 500 },
    );
  }
}
