import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
type DbRow = Record<string, unknown>;

export async function GET(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });

    const { encounterId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // Mailroom-filed documents attached to this encounter. The clinician-facing
    // view only cares about the ones routed in from the mailroom, so we
    // require mailroom_item_id to be present.
    const { data, error } = await supabase
      .from("documents")
      .select("id, document_type, title, file_name, mime_type, filed_at, created_at, mailroom_item_id")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .not("mailroom_item_id", "is", null)
      .is("archived_at", null)
      .order("filed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    const documents = ((data ?? []) as DbRow[]).map((doc) => ({
      id: String(doc.id ?? ""),
      type: (doc.document_type as string | null) ?? null,
      title: (doc.title as string | null) ?? null,
      fileName: (doc.file_name as string | null) ?? null,
      mimeType: (doc.mime_type as string | null) ?? null,
      filedAt: (doc.filed_at as string | null) ?? null,
      createdAt: (doc.created_at as string | null) ?? null,
      mailroomItemId: (doc.mailroom_item_id as string | null) ?? null,
    }));

    return NextResponse.json({ success: true, documents });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load encounter documents" },
      { status: 500 },
    );
  }
}
