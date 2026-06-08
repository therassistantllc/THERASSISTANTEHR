/**
 * GET /api/billing/claims/[claimId]/documents/[documentId]/file
 *
 * Streams a claim-linked document from Supabase storage so billers can open
 * it from the Claim Hold detail panel without leaving the workqueue.
 *
 * Looks up the document by id, scopes it to the org and claim, then downloads
 * the underlying object using whatever bucket the document row points to
 * (mailroom-documents, etc).
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const clean = (v: unknown) => String(v ?? "").trim();

export async function GET(
  request: Request,
  ctx: { params: Promise<{ claimId: string; documentId: string }> },
) {
  try {
    const { claimId, documentId } = await ctx.params;
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
    if (!claimId || !documentId) {
      return NextResponse.json(
        { success: false, error: "claimId and documentId are required" },
        { status: 400 },
      );
    }

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, file_name, mime_type, storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .is("archived_at", null)
      .maybeSingle();

    if (docError) {
      return NextResponse.json(
        { success: false, error: docError.message },
        { status: 422 },
      );
    }
    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Document not found" },
        { status: 404 },
      );
    }

    const bucket = clean((doc as { storage_bucket?: string }).storage_bucket);
    const path = clean((doc as { storage_path?: string }).storage_path);
    const mime = clean((doc as { mime_type?: string }).mime_type) || "application/octet-stream";
    const fileName = clean((doc as { file_name?: string }).file_name) || "document";

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
