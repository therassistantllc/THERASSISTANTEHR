import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
/**
 * Returns 999/277CA acknowledgements for a claim_837p_batches row.
 * We bridge to edi_acknowledgements by matching on batch_number (also used as
 * the EDI batch identifier in edi_batches when submitted via the EDI pipeline).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { id } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const type = (searchParams.get("type") || "").trim();

    // Confirm the claim batch exists and belongs to this org.
    const { data: batch, error: batchErr } = await supabase
      .from("claim_837p_batches")
      .select("id, batch_number")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (batchErr) return NextResponse.json({ success: false, error: batchErr.message }, { status: 422 });
    if (!batch) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    const batchNumber = String((batch as Record<string, unknown>).batch_number ?? "").trim();

    // Look up matching edi_batches rows (same org, same batch number) and read
    // their acknowledgements. Empty result is normal until the clearinghouse
    // responds.
    let ediBatchIds: string[] = [];
    if (batchNumber) {
      const { data: ediBatches } = await supabase
        .from("edi_batches")
        .select("id")
        .eq("organization_id", organizationId)
        .or(`isa_control_number.eq.${batchNumber},gs_control_number.eq.${batchNumber},st_control_number.eq.${batchNumber},availity_file_id.eq.${batchNumber}`);
      ediBatchIds = ((ediBatches ?? []) as Array<{ id: string }>).map((r) => String(r.id));
    }

    if (ediBatchIds.length === 0) {
      return NextResponse.json({ success: true, acknowledgements: [] });
    }

    let q = supabase
      .from("edi_acknowledgements")
      .select("id, acknowledgement_type, file_name, raw_content, parsed_content, created_at")
      .eq("organization_id", organizationId)
      .in("edi_batch_id", ediBatchIds)
      .order("created_at", { ascending: false });
    if (type) q = q.eq("acknowledgement_type", type);

    const { data, error } = await q;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    return NextResponse.json({ success: true, acknowledgements: data ?? [] });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
