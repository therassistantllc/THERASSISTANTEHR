import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { rebuild276BatchFile } from "@/lib/claims/rebuild276BatchFile";

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

async function loadBatch(sb: any, organizationId: string, batchId: string): Promise<Row | null> {
  const { data, error } = await sb
    .from("claim_276_batches")
    .select("id, batch_number, batch_status, generated_file_name, generated_file_content")
    .eq("organization_id", organizationId)
    .eq("id", batchId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message ?? "Failed to load 276 batch");
  return (data ?? null) as Row | null;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const sb = supabase as any;
    const { id } = await ctx.params;

    let batch = await loadBatch(sb, guard.organizationId, id);
    if (!batch) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    let content = text(batch.generated_file_content);
    let fileName = text(batch.generated_file_name) || `${text(batch.batch_number) || id}.edi`;

    if (!content) {
      const rebuilt = await rebuild276BatchFile({ batchId: id, organizationId: guard.organizationId });
      if (!rebuilt.ok) {
        return NextResponse.json({ success: false, error: rebuilt.error ?? "Failed to generate 276" }, { status: 422 });
      }
      batch = await loadBatch(sb, guard.organizationId, id);
      content = text(batch?.generated_file_content);
      fileName = text(batch?.generated_file_name) || rebuilt.fileName || fileName;
    }

    if (!content) {
      return NextResponse.json({ success: false, error: "No 276 content available for this batch" }, { status: 404 });
    }

    const now = new Date().toISOString();
    await sb
      .from("claim_276_batches")
      .update({ batch_status: "downloaded", downloaded_at: now, updated_at: now })
      .eq("id", id)
      .eq("organization_id", guard.organizationId);

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
          status: "status_inquiry_downloaded",
          status_message: `276 batch ${text(batch?.batch_number) || id} downloaded`,
          raw_payload: {
            action: "batch_276_downloaded",
            batch_id: id,
            batch_number: text(batch?.batch_number) || id,
          },
        })),
      );
    }

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${fileName.replace(/\"/g, "")}\"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to download 276 batch" },
      { status: 500 },
    );
  }
}
