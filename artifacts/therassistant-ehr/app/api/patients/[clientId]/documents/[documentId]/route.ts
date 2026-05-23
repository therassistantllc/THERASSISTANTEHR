import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

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
