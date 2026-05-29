import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
const BUCKET = "mailroom-documents";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "text/plain",
  "text/csv",
]);

function logCtx(label: string, ctx: Record<string, unknown>) {
  const parts = Object.entries(ctx)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  console.log(`[mailroom.upload] ${label} ${parts}`);
}

function looksLikeAllowedFile(bytes: Uint8Array, mimeType: string) {
  const hasPrefix = (...sig: number[]) => sig.every((n, i) => bytes[i] === n);
  if (mimeType === "application/pdf") return hasPrefix(0x25, 0x50, 0x44, 0x46); // %PDF
  if (mimeType === "image/png") return hasPrefix(0x89, 0x50, 0x4e, 0x47);
  if (mimeType === "image/jpeg") return hasPrefix(0xff, 0xd8, 0xff);
  if (mimeType === "image/tiff") return hasPrefix(0x49, 0x49, 0x2a, 0x00) || hasPrefix(0x4d, 0x4d, 0x00, 0x2a);
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    // Permit UTF-8 BOM or mostly-printable text for plain/csv.
    let printable = 0;
    const sample = bytes.subarray(0, Math.min(bytes.length, 512));
    for (const b of sample) {
      if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) printable++;
    }
    return sample.length === 0 || printable / sample.length > 0.9;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const requestId = crypto.randomUUID();
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
    }
    const guard = await requireOrgAccess({
      requestedOrganizationId: String(form.get("organizationId") || "").trim() || null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const clientId = String(form.get("clientId") || "").trim() || null;
    const documentType = String(form.get("documentType") || "").trim() || "other";

    const blob = file as Blob & { name?: string };
    const fileName = (blob.name && String(blob.name)) || `mailroom-${Date.now()}`;
    const mimeType = (blob.type || "").toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { success: false, error: "Unsupported file type. Allowed types: PDF, PNG, JPEG, TIFF, TXT, CSV." },
        { status: 415 },
      );
    }

    if (typeof blob.size !== "number" || blob.size <= 0 || blob.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: `File size must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes.` },
        { status: 413 },
      );
    }

    const safeName = fileName.replace(/[^\w.\-]+/g, "_");
    const storagePath = `${organizationId}/${Date.now()}-${safeName}`;

    logCtx("upload-start", { requestId, organizationId, size: blob.size ?? 0 });

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (!looksLikeAllowedFile(bytes, mimeType)) {
      return NextResponse.json(
        { success: false, error: "File content does not match the declared MIME type." },
        { status: 400 },
      );
    }

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
    if (upErr) {
      logCtx("upload-failed", {
        requestId,
        organizationId,
        err: upErr.message,
      });
      return NextResponse.json(
        { success: false, error: "Storage upload failed" },
        { status: 500 },
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("mailroom_items")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        file_name: fileName,
        mime_type: mimeType,
        storage_path: storagePath,
        status: "needs_review",
        document_type: documentType,
        source: "manual_upload",
        notes: "Uploaded via mailroom drop zone.",
        created_at: now,
        updated_at: now,
      })
      .select("id, file_name, mime_type, storage_path, status, document_type, source, client_id, notes, created_at, updated_at")
      .single();

    if (error || !data) {
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      logCtx("db-insert-failed", {
        requestId,
        organizationId,
        err: error?.message || "db-insert-failed",
      });
      return NextResponse.json(
        { success: false, error: "Failed to create mailroom item" },
        { status: 422 },
      );
    }

    logCtx("upload-ok", {
      requestId,
      organizationId,
      itemId: String(data.id),
    });

    return NextResponse.json({
      success: true,
      item: {
        id: String(data.id),
        fileName: String(data.file_name ?? fileName),
        mimeType: String(data.mime_type ?? mimeType),
        storagePath: String(data.storage_path ?? storagePath),
        status: String(data.status ?? "needs_review"),
        documentType: String(data.document_type ?? documentType),
        source: String(data.source ?? "manual_upload"),
        clientId: data.client_id ? String(data.client_id) : null,
        notes: String(data.notes ?? ""),
        createdAt: String(data.created_at ?? now),
      },
    });
  } catch (error) {
    console.error("Mailroom upload error:", error);
    return NextResponse.json(
      { success: false, error: "Upload failed" },
      { status: 500 },
    );
  }
}
