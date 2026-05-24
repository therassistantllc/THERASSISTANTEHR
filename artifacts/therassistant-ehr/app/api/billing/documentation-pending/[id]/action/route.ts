/**
 * POST /api/billing/documentation-pending/:id/action
 *
 * `:id` is the appointment id. Body shape:
 *   {
 *     action: "send_reminder" | "route_to_clinician" | "hold" |
 *             "mark_not_billable" | "supervisor_review",
 *     organizationId: string,
 *     target_provider_id?: string,  // for route_to_clinician
 *     note?: string,                 // optional free-form context
 *   }
 *
 * Every action writes an audit_logs entry under the
 * `doc_pending_<action>` event_type. The GET route reduces those
 * events into the queue's authoritative state.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const ALLOWED = [
  "send_reminder",
  "route_to_clinician",
  "hold",
  "unhold",
  "mark_not_billable",
  "supervisor_review",
] as const;
type Action = (typeof ALLOWED)[number];

const SUMMARIES: Record<Action, string> = {
  send_reminder: "Clinician reminder sent for missing documentation",
  route_to_clinician: "Documentation routed to a clinician for completion",
  hold: "Appointment held from billing pending documentation",
  unhold: "Documentation hold released",
  mark_not_billable: "Appointment marked not billable",
  supervisor_review: "Documentation flagged for supervisor review",
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing appointment id" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      organizationId?: string;
      target_provider_id?: string;
      note?: string;
    };

    const action = body.action as Action | undefined;
    if (!action || !ALLOWED.includes(action)) {
      return NextResponse.json(
        { success: false, error: `Unknown action: ${body.action ?? ""}` },
        { status: 400 },
      );
    }

    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    // Verify the appointment belongs to this org. Cheap sanity check
    // that doubles as a 404 for malformed ids.
    const { data: appt, error: apptErr } = await (supabase as any)
      .from("appointments")
      .select("id, organization_id, client_id, provider_id")
      .eq("id", id)
      .maybeSingle();
    if (apptErr) throw apptErr;
    if (!appt || appt.organization_id !== organizationId) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 },
      );
    }

    const metadata: Record<string, unknown> = {};
    if (body.note) metadata.note = String(body.note).slice(0, 2000);
    if (action === "route_to_clinician" && body.target_provider_id) {
      metadata.target_provider_id = body.target_provider_id;
    }

    const eventType = `doc_pending_${action}`;
    const summary = SUMMARIES[action];

    const { data: encounterRow } = await (supabase as any)
      .from("encounters")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("appointment_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error: auditErr } = await (supabase as any).from("audit_logs").insert({
      organization_id: organizationId,
      appointment_id: id,
      encounter_id: encounterRow?.id ?? null,
      patient_id: appt.client_id ?? null,
      event_type: eventType,
      event_summary: summary,
      event_metadata: metadata,
      user_id: guard.userId,
      action: eventType,
      object_type: "appointment",
      object_id: id,
    });
    if (auditErr) throw auditErr;

    return NextResponse.json({
      success: true,
      organizationId,
      appointmentId: id,
      action,
      summary,
    });
  } catch (error) {
    console.error("Documentation Pending action error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Action failed",
      },
      { status: 500 },
    );
  }
}
