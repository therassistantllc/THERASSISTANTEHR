import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type ActionName =
  | "attach_records"
  | "send_documentation"
  | "create_cover_letter"
  | "route_to_clinician"
  | "route_to_admin"
  | "assign_biller"
  | "set_follow_up"
  | "mark_submitted";

interface ActionBody {
  organizationId?: string;
  action?: ActionName;
  claimId?: string;
  clientId?: string | null;
  appointmentId?: string | null;
  providerId?: string | null;
  billerId?: string | null;
  followUpDueAt?: string | null;
  note?: string;
  documentTitles?: string[];
  recipientEmail?: string;
}

async function writeAuditStrict(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  args: {
    organizationId: string;
    userId: string | null;
    action: string;
    claimId: string;
    clientId: string | null;
    appointmentId: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: "Database connection not available" };
  try {
    const { error } = await (
      supabase as unknown as {
        from: (t: string) => {
          insert: (v: unknown) => Promise<{ error: { message?: string } | null }>;
        };
      }
    )
      .from("audit_logs")
      .insert({
        organization_id: args.organizationId,
        user_id: args.userId,
        action: args.action,
        event_type: "medical_review_workqueue",
        event_summary: args.summary,
        event_metadata: args.metadata ?? {},
        appointment_id: args.appointmentId,
        claim_id: args.claimId,
        patient_id: args.clientId,
        object_type: "professional_claim",
        object_id: args.claimId,
      });
    if (error) return { ok: false, error: error.message ?? "audit_logs insert failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "audit_logs insert failed" };
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }
    const body = (await request.json()) as ActionBody;
    const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const userId = guard.userId;

    const action = body.action;
    const claimId = body.claimId ?? "";
    const note = (body.note ?? "").trim();

    if (!action || !claimId) {
      return NextResponse.json(
        { success: false, error: "action and claimId are required" },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };

    // Validate the claim exists in the caller's org BEFORE any audit write.
    const { data: claim, error: claimErr } = await sb
      .from("professional_claims")
      .select("id, patient_id, appointment_id, billing_notes")
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (claimErr) {
      return NextResponse.json(
        { success: false, error: claimErr.message ?? "Failed to look up claim" },
        { status: 500 },
      );
    }
    if (!claim) {
      return NextResponse.json(
        { success: false, error: "Claim not found in this organization" },
        { status: 404 },
      );
    }
    const clientId = body.clientId ?? (claim.patient_id as string | null) ?? null;
    const appointmentId = body.appointmentId ?? (claim.appointment_id as string | null) ?? null;

    switch (action) {
      case "attach_records": {
        const titles = (body.documentTitles ?? []).map((s) => String(s).trim()).filter(Boolean);
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_records_attached",
          claimId, clientId, appointmentId,
          summary: note || `Attached ${titles.length || 0} document(s) to claim`,
          metadata: { documentTitles: titles, note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({ success: true, attached: titles });
      }
      case "send_documentation": {
        const recipient = (body.recipientEmail ?? "").trim();
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_documentation_sent",
          claimId, clientId, appointmentId,
          summary: note || `Documentation sent${recipient ? ` to ${recipient}` : ""}`,
          metadata: { recipient, note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({ success: true, sentAt: new Date().toISOString() });
      }
      case "create_cover_letter": {
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_cover_letter_created",
          claimId, clientId, appointmentId,
          summary: note || "Cover letter generated",
          metadata: { note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({ success: true, createdAt: new Date().toISOString() });
      }
      case "route_to_clinician": {
        let providerId = body.providerId ?? null;
        if (!providerId && appointmentId) {
          const { data: appt } = await sb
            .from("appointments")
            .select("provider_id")
            .eq("id", appointmentId)
            .eq("organization_id", organizationId)
            .maybeSingle();
          providerId = appt ? String(appt.provider_id ?? "") || null : null;
        }
        const display = providerId ? `Clinician ${providerId.slice(0, 8)}` : "Clinician";
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_routed_clinician",
          claimId, clientId, appointmentId,
          summary: note || `Routed to ${display}`,
          metadata: { providerId, assignedToDisplay: display, kind: "clinician", note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({
          success: true,
          assignment: { kind: "clinician", display, userId: providerId },
        });
      }
      case "route_to_admin": {
        const display = "Admin pool";
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_routed_admin",
          claimId, clientId, appointmentId,
          summary: note || `Routed to ${display}`,
          metadata: { assignedToDisplay: display, kind: "admin", note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({
          success: true,
          assignment: { kind: "admin", display, userId: null },
        });
      }
      case "assign_biller": {
        const billerId = (body.billerId ?? userId ?? "").trim();
        if (!billerId) {
          return NextResponse.json(
            { success: false, error: "billerId is required" },
            { status: 400 },
          );
        }
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_assigned_biller",
          claimId, clientId, appointmentId,
          summary: note || `Assigned to biller ${billerId}`,
          metadata: { billerId, note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({ success: true, billerId });
      }
      case "set_follow_up": {
        const dueAt = (body.followUpDueAt ?? "").trim();
        if (!dueAt) {
          return NextResponse.json(
            { success: false, error: "followUpDueAt is required" },
            { status: 400 },
          );
        }
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_follow_up_set",
          claimId, clientId, appointmentId,
          summary: note || `Follow-up due ${dueAt}`,
          metadata: { dueAt, note },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({ success: true, dueAt });
      }
      case "mark_submitted": {
        const marker = `[MED REVIEW SUBMITTED ${new Date().toISOString()}] ${note || "Documentation submitted to payer"}`;
        const prior = (claim.billing_notes as string | null) ?? "";
        const merged = prior ? `${prior}\n${marker}` : marker;
        const { error } = await sb
          .from("professional_claims")
          .update({ billing_notes: merged })
          .eq("id", claimId)
          .eq("organization_id", organizationId);
        if (error) {
          return NextResponse.json(
            { success: false, error: error.message ?? "Failed to update claim" },
            { status: 500 },
          );
        }
        const audit = await writeAuditStrict(supabase, {
          organizationId, userId,
          action: "medical_review_submitted",
          claimId, clientId, appointmentId,
          summary: note || "Documentation submitted to payer",
          metadata: { note, submittedAt: new Date().toISOString() },
        });
        if (!audit.ok) return NextResponse.json({ success: false, error: audit.error }, { status: 500 });
        return NextResponse.json({ success: true, submittedAt: new Date().toISOString() });
      }
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Action failed" },
      { status: 500 },
    );
  }
}
