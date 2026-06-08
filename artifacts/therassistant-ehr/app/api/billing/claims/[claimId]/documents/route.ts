/**
 * GET /api/billing/claims/[claimId]/documents
 *
 * Returns the documents linked to a claim, for the Claim Hold detail panel
 * (and any other surface that needs a claim's supporting paperwork).
 *
 * Source is derived from the document and (when present) its originating
 * mailroom item — so faxes and email-ingested mail show as "Fax" / "Mailroom"
 * rather than the generic "Manual upload".
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const UPLOAD_BUCKET = "mailroom-documents";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const text = (v: unknown) => String(v ?? "").trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

async function ensureBucket(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
) {
  if (!supabase) return;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (buckets && buckets.some((b) => b.name === UPLOAD_BUCKET)) return;
    const { error } = await supabase.storage.createBucket(UPLOAD_BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_BYTES,
    });
    if (error && !/already exists/i.test(error.message)) {
      console.warn("[claim.documents] ensure-bucket-error", error.message);
    }
  } catch (err) {
    console.warn(
      "[claim.documents] ensure-bucket-exception",
      err instanceof Error ? err.message : String(err),
    );
  }
}

type DocumentSource = "mailroom" | "fax" | "manual_upload" | "other";

function deriveSource(doc: DbRow): { source: DocumentSource; sourceLabel: string } {
  const mailroom = doc.mailroom_items as DbRow | null;
  const mailroomSource =
    mailroom && typeof mailroom.source === "string"
      ? String(mailroom.source).toLowerCase()
      : null;

  if (mailroomSource === "fax") {
    return { source: "fax", sourceLabel: "Fax" };
  }
  if (mailroom || doc.document_scope === "mailroom" || doc.mailroom_item_id) {
    return { source: "mailroom", sourceLabel: "Mailroom" };
  }
  return { source: "manual_upload", sourceLabel: "Manual upload" };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
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

    if (!claimId) {
      return NextResponse.json(
        { success: false, error: "claimId is required" },
        { status: 400 },
      );
    }

    const { data, error } = await (supabase as DbRow)
      .from("documents")
      .select(
        `id, document_scope, document_type, title, file_name, mime_type,
         file_size_bytes, notes, filed_at, created_at, mailroom_item_id,
         storage_bucket, storage_path,
         mailroom_items:mailroom_item_id ( id, source, sender_name, received_date )`,
      )
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 },
      );
    }

    const documents = (data ?? []).map((doc: DbRow) => {
      const { source, sourceLabel } = deriveSource(doc);
      return {
        id: doc.id as string,
        title: (doc.title as string | null) ?? (doc.file_name as string | null) ?? "Document",
        fileName: (doc.file_name as string | null) ?? null,
        documentType: (doc.document_type as string | null) ?? null,
        documentScope: (doc.document_scope as string | null) ?? null,
        mimeType: (doc.mime_type as string | null) ?? null,
        fileSizeBytes: (doc.file_size_bytes as number | null) ?? null,
        notes: (doc.notes as string | null) ?? null,
        uploadedAt: (doc.filed_at as string | null) ?? (doc.created_at as string | null),
        createdAt: (doc.created_at as string | null) ?? null,
        mailroomItemId: (doc.mailroom_item_id as string | null) ?? null,
        hasFile: Boolean(doc.storage_bucket && doc.storage_path),
        source,
        sourceLabel,
      };
    });

    return NextResponse.json({
      success: true,
      documents,
      total: documents.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load documents",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/billing/claims/[claimId]/documents
 *
 * Two modes:
 *   1. multipart/form-data with a `file` field — uploads a new file to
 *      Supabase storage and inserts a `documents` row with `claim_id` set.
 *   2. application/json with `{ mailroomItemId }` — files an existing
 *      mailroom item against this claim, mirroring /api/mailroom/file so
 *      the claim_id FK is populated and the mailroom item is marked filed.
 *
 * In both cases the claim must exist and belong to the caller's org.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }
    if (!claimId) {
      return NextResponse.json(
        { success: false, error: "claimId is required" },
        { status: 400 },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.toLowerCase().includes("multipart/form-data");

    if (isMultipart) {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json(
          { success: false, error: "file is required" },
          { status: 400 },
        );
      }
      const guard = await requireBillingAccess({
        requestedOrganizationId: text(form.get("organizationId")) || null,
      });
      if (guard instanceof NextResponse) return guard;
      const organizationId = guard.organizationId;

      const claim = await (supabase as DbRow)
        .from("professional_claims")
        .select("id")
        .eq("id", claimId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (claim.error) {
        return NextResponse.json(
          { success: false, error: claim.error.message },
          { status: 422 },
        );
      }
      if (!claim.data) {
        return NextResponse.json(
          { success: false, error: "Claim not found" },
          { status: 404 },
        );
      }

      const blob = file as Blob & { name?: string };
      const size = blob.size ?? 0;
      if (size <= 0) {
        return NextResponse.json(
          { success: false, error: "Uploaded file is empty" },
          { status: 400 },
        );
      }
      if (size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB cap`,
          },
          { status: 413 },
        );
      }

      const fileName = (blob.name && String(blob.name)) || `claim-${Date.now()}`;
      const mimeType = blob.type || "application/octet-stream";
      const documentType = text(form.get("documentType")) || "other";
      const notes = text(form.get("notes")) || null;
      const safeName = fileName.replace(/[^\w.\-]+/g, "_");
      const storagePath = `${organizationId}/claims/${claimId}/${Date.now()}-${safeName}`;

      await ensureBucket(supabase);

      const buffer = new Uint8Array(await blob.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
      if (upErr) {
        return NextResponse.json(
          { success: false, error: `Storage upload failed: ${upErr.message}` },
          { status: 500 },
        );
      }

      const userId = (guard as { userId?: string | null }).userId ?? null;
      const now = new Date().toISOString();
      const { data: inserted, error: insertErr } = await (supabase as DbRow)
        .from("documents")
        .insert({
          organization_id: organizationId,
          claim_id: claimId,
          title: fileName,
          document_scope: "claim",
          document_type: documentType,
          file_name: fileName,
          mime_type: mimeType,
          file_size_bytes: size,
          storage_bucket: UPLOAD_BUCKET,
          storage_path: storagePath,
          uploaded_by_user_id: userId,
          filed_at: now,
          notes,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        await supabase.storage
          .from(UPLOAD_BUCKET)
          .remove([storagePath])
          .catch(() => {});
        return NextResponse.json(
          {
            success: false,
            error: insertErr?.message || "Failed to record document",
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        success: true,
        documentId: inserted.id as string,
      });
    }

    // JSON path: file an existing mailroom item against this claim.
    const body = (await request.json().catch(() => ({}))) as {
      mailroomItemId?: string;
      organizationId?: string;
      notes?: string;
    };
    const mailroomItemId = text(body.mailroomItemId);
    const guard = await requireBillingAccess({
      requestedOrganizationId: text(body.organizationId) || null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    if (!mailroomItemId) {
      return NextResponse.json(
        { success: false, error: "mailroomItemId is required" },
        { status: 400 },
      );
    }

    const claim = await (supabase as DbRow)
      .from("professional_claims")
      .select("id")
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (claim.error) {
      return NextResponse.json(
        { success: false, error: claim.error.message },
        { status: 422 },
      );
    }
    if (!claim.data) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }

    const { data: mailroomItem, error: mailroomError } = await (supabase as DbRow)
      .from("mailroom_items")
      .select("*")
      .eq("id", mailroomItemId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (mailroomError) {
      return NextResponse.json(
        { success: false, error: mailroomError.message },
        { status: 422 },
      );
    }
    if (!mailroomItem) {
      return NextResponse.json(
        { success: false, error: "Mailroom item not found" },
        { status: 404 },
      );
    }

    const mimeType = text(mailroomItem.mime_type) || "application/pdf";
    const fileName = text(mailroomItem.file_name) || "mailroom_document";
    const documentType = text(mailroomItem.document_type) || "other";
    const userId = (guard as { userId?: string | null }).userId ?? null;
    const notes = text(body.notes) || null;
    const now = new Date().toISOString();

    const { data: inserted, error: insertErr } = await (supabase as DbRow)
      .from("documents")
      .insert({
        organization_id: organizationId,
        mailroom_item_id: mailroomItemId,
        claim_id: claimId,
        title: fileName,
        document_scope: "claim",
        document_type: documentType,
        file_name: fileName,
        mime_type: mimeType,
        storage_bucket: UPLOAD_BUCKET,
        storage_path: text(mailroomItem.storage_path) || null,
        uploaded_by_user_id: text(mailroomItem.uploaded_by_user_id) || userId,
        filed_at: now,
        notes,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        {
          success: false,
          error: insertErr?.message || "Failed to file mailroom item",
        },
        { status: 422 },
      );
    }

    const { error: updateError } = await (supabase as DbRow)
      .from("mailroom_items")
      .update({
        status: "filed",
        admin_comments: notes,
        updated_at: now,
      })
      .eq("id", mailroomItemId)
      .eq("organization_id", organizationId);

    if (updateError) {
      console.warn(
        "[claim.documents] mailroom-item-update-failed",
        updateError.message,
      );
    }

    return NextResponse.json({
      success: true,
      documentId: inserted.id as string,
      mailroomItemId,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Attach failed",
      },
      { status: 500 },
    );
  }
}
