/**
 * GET /api/billing/appeals/[appealId]/documents/[documentId]/file
 *
 * Streams a supporting document attached to a claim appeal so billers can
 * open the file directly from the Attachments tab without leaving the
 * workqueue.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ appealId: string; documentId: string }> },
) {
  try {
    const { appealId, documentId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }
    if (!appealId || !documentId) {
      return NextResponse.json(
        { success: false, error: "appealId and documentId are required" },
        { status: 400 },
      );
    }

    const { data: doc, error } = await supabase
      .from("claim_appeal_documents")
      .select("id, file_name, mime_type, storage_bucket, storage_path")
      .eq("organization_id", organizationId)
      .eq("appeal_id", appealId)
      .eq("id", documentId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 },
      );
    }
    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 },
      );
    }

    const bucket = text((doc as { storage_bucket?: string }).storage_bucket);
    const path = text((doc as { storage_path?: string }).storage_path);
    const mime = text((doc as { mime_type?: string }).mime_type) || "application/octet-stream";
    const fileName = text((doc as { file_name?: string }).file_name) || "document";

    if (!bucket || !path) {
      return NextResponse.json(
        { success: false, error: "No file is attached to this document" },
        { status: 404 },
      );
    }

    const { data: blob, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(path);
    if (dlErr || !blob) {
      return NextResponse.json(
        {
          success: false,
          error: dlErr?.message || "File not available in storage",
        },
        { status: 404 },
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": blob.type || mime,
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to fetch file",
      },
      { status: 500 },
    );
  }
}
