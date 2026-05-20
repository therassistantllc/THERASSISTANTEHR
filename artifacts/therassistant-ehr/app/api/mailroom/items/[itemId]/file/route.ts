import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";

const DEFAULT_BUCKET = "mailroom-documents";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { itemId } = await context.params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    if (!itemId) return NextResponse.json({ success: false, error: "itemId is required" }, { status: 400 });

    const { data: item, error } = await supabase
      .from("mailroom_items")
      .select("id, organization_id, file_name, mime_type, file_mime_type, storage_bucket, storage_path")
      .eq("id", itemId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    if (!item) return NextResponse.json({ success: false, error: "Mailroom item not found" }, { status: 404 });

    const path = clean((item as Record<string, unknown>).storage_path);
    if (!path) return NextResponse.json({ success: false, error: "No file on this mailroom item" }, { status: 404 });

    const bucket = clean((item as Record<string, unknown>).storage_bucket) || DEFAULT_BUCKET;

    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !blob) {
      return NextResponse.json(
        { success: false, error: dlErr?.message || "File not available in storage" },
        { status: 404 },
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const mime =
      clean((item as Record<string, unknown>).mime_type) ||
      clean((item as Record<string, unknown>).file_mime_type) ||
      blob.type ||
      "application/octet-stream";
    const fileName = clean((item as Record<string, unknown>).file_name) || "mailroom-document";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Mailroom item file fetch error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to fetch file" },
      { status: 500 },
    );
  }
}
