import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { rebuild837PBatchFile } from "@/lib/claims/rebuild837PBatchFile";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function loadBatch(params: { orgId: string; batchId: string }) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error }: { data: DbRow | null; error: { message?: string; code?: string } | null } = await supabase
    .from("claim_837p_batches")
    .select("id, batch_number, batch_source, generated_file_name, generated_file_content, batch_status")
    .eq("organization_id", params.orgId)
    .eq("id", params.batchId)
    .eq("batch_source", "charge_auto")
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message ?? "Failed to load batch");
  return (data ?? null) as DbRow | null;
}

async function markChargesDownloaded(params: { orgId: string; batchId: string }) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data: links, error: linkError } = await supabase
    .from("claim_837p_batch_claims")
    .select("professional_claim_id")
    .eq("organization_id", params.orgId)
    .eq("batch_id", params.batchId)
    .is("archived_at", null);

  if (linkError) throw new Error(linkError.message ?? "Failed to load batch claims");

  const claimIds = ((links ?? []) as DbRow[]).map((r) => text(r.professional_claim_id)).filter(Boolean);
  if (claimIds.length === 0) return;

  const now = new Date().toISOString();
  const { error: chargeError } = await supabase
    .from("charge_capture_items")
    .update({
      charge_status: "downloaded",
      downloaded_at: now,
      updated_at: now,
    })
    .eq("organization_id", params.orgId)
    .in("claim_id", claimIds)
    .is("archived_at", null);

  if (chargeError) throw new Error(chargeError.message ?? "Failed to mark charges downloaded");
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;

    const { id } = await ctx.params;
    let batch = await loadBatch({ orgId: guard.organizationId, batchId: id });
    if (!batch) {
      return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });
    }

    let content = text(batch.generated_file_content);
    let fileName = text(batch.generated_file_name) || `${text(batch.batch_number) || id}.837p.txt`;

    if (!content) {
      const rebuilt = await rebuild837PBatchFile({ batchId: id, organizationId: guard.organizationId });
      if (!rebuilt.ok) {
        return NextResponse.json(
          { success: false, error: rebuilt.error ?? "Failed to generate 837P file" },
          { status: 422 },
        );
      }
      batch = await loadBatch({ orgId: guard.organizationId, batchId: id });
      content = text(batch?.generated_file_content);
      fileName = text(batch?.generated_file_name) || rebuilt.fileName || fileName;
    }

    if (!content) {
      return NextResponse.json({ success: false, error: "No 837 content available for this batch" }, { status: 404 });
    }

    await markChargesDownloaded({ orgId: guard.organizationId, batchId: id });

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to download batch" },
      { status: 500 },
    );
  }
}
