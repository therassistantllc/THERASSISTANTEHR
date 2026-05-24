import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { itemId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const guard = await requireOrgAccess({
      requestedOrganizationId: typeof body?.organizationId === "string" ? body.organizationId : null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: existing, error: loadError } = await supabase
      .from("workqueue_items")
      .select("id, work_type, context_payload")
      .eq("organization_id", organizationId)
      .eq("id", itemId)
      .is("archived_at", null)
      .maybeSingle();

    if (loadError || !existing) {
      return NextResponse.json({ success: false, error: "Workqueue item not found" }, { status: 404 });
    }

    const priorPayload =
      existing.context_payload && typeof existing.context_payload === "object"
        ? (existing.context_payload as Record<string, unknown>)
        : {};

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("workqueue_items")
      .update({
        work_type: "clinician_routed_billing_review",
        updated_at: now,
        context_payload: {
          ...priorPayload,
          routed_to_billing_at: now,
          routed_to_billing_from_work_type: existing.work_type ?? null,
          routed_from: "patient_workqueue_ui",
        },
      })
      .eq("organization_id", organizationId)
      .eq("id", itemId);

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 422 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Route to bill failed" },
      { status: 500 },
    );
  }
}
