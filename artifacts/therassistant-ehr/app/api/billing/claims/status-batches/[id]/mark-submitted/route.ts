import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string };
    const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }
    const sb = supabase as any;

    const { id } = await ctx.params;
    const { data: row, error: loadErr } = await sb
      .from("claim_276_batches")
      .select("id, batch_number, batch_status")
      .eq("organization_id", guard.organizationId)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!row) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    const now = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("claim_276_batches")
      .update({ batch_status: "submitted", submitted_at: now, updated_at: now })
      .eq("id", id)
      .eq("organization_id", guard.organizationId);
    if (updateErr) throw updateErr;

    const { data: links } = await sb
      .from("claim_276_batch_claims")
      .select("professional_claim_id")
      .eq("organization_id", guard.organizationId)
      .eq("batch_id", id)
      .is("archived_at", null);
    const claimIds = ((links ?? []) as Row[]).map((r) => text(r.professional_claim_id)).filter(Boolean);

    if (claimIds.length > 0) {
      await sb.from("claim_status_events").insert(
        claimIds.map((claimId) => ({
          claim_id: claimId,
          source: "clearinghouse",
          status: "status_inquiry_submitted",
          status_message: `276 batch ${text((row as Row).batch_number) || id} marked submitted`,
          raw_payload: {
            action: "batch_276_submitted",
            batch_id: id,
            batch_number: text((row as Row).batch_number) || id,
          },
        })),
      );
    }

    return NextResponse.json({ success: true, batchId: id, status: "submitted", submittedAt: now });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to mark batch submitted" },
      { status: 500 },
    );
  }
}
