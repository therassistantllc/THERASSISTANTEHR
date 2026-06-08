import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string; documentId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
    }

    const { clientId, documentId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, file_name, mime_type, storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .is("archived_at", null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }
    if (!doc) {
      return NextResponse.json({ success: false, error: "Document not found" }, { status: 404 });
    }

    const bucket = clean(doc.storage_bucket);
    const path = clean(doc.storage_path);
    if (!bucket || !path) {
      return NextResponse.json({ success: false, error: "Document has no storage file" }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(path);

    if (downloadError || !blob) {
      return NextResponse.json(
        { success: false, error: downloadError?.message ?? "Failed to download file" },
        { status: 404 },
      );
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fileName = clean(doc.file_name) || `document-${documentId}`;
    const mimeType = clean(doc.mime_type) || "application/octet-stream";

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load document file" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ clientId: string; documentId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
    }

    const { clientId, documentId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const body = (await request.json().catch(() => ({}))) as {
      patientVisible?: boolean;
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.patientVisible === "boolean") {
      updates.patient_visible = body.patientVisible;
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json(
        { success: false, error: "No supported fields provided" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("documents")
      .update(updates)
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .select("id, patient_visible")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      document: { id: data.id, patientVisible: Boolean(data.patient_visible) },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to update document" },
      { status: 500 },
    );
  }
}
