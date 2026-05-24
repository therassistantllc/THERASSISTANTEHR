import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type ActionName =
  | "hold_claim"
  | "release_claim"
  | "route_to_credentialing"
  | "appeal_denial"
  | "resubmit_after_correction"
  | "credentialing_note"
  | "assign_biller"
  | "set_follow_up";

interface ActionBody {
  organizationId?: string;
  action?: ActionName;
  claimId?: string;
  clientId?: string | null;
  appointmentId?: string | null;
  note?: string;
  billerId?: string | null;
  followUpDueAt?: string | null;
}

async function writeAudit(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  args: {
    organizationId: string;
    userId: string | null;
    action: string;
    claimId: string | null;
    clientId: string | null;
    appointmentId: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  if (!supabase) return;
  try {
    await (supabase as unknown as {
      from: (t: string) => { insert: (v: unknown) => Promise<unknown> };
    })
      .from("audit_logs")
      .insert({
        organization_id: args.organizationId,
        user_id: args.userId,
        action: args.action,
        event_type: "provider_enrollment_workqueue",
        event_summary: args.summary,
        event_metadata: args.metadata ?? {},
        appointment_id: args.appointmentId,
        claim_id: args.claimId,
        patient_id: args.clientId,
        object_type: "professional_claim",
        object_id: args.claimId,
      });
  } catch (e) {
    console.warn("provider-enrollment-issues audit failed:", e);
  }
}

async function appendBillingNote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: { from: (t: string) => any },
  args: {
    organizationId: string;
    claimId: string;
    marker: string;
    claimStatus?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await sb
    .from("professional_claims")
    .select("billing_notes")
    .eq("id", args.claimId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  const prior = (existing?.billing_notes as string | null) ?? "";
  const merged = prior ? `${prior}\n${args.marker}` : args.marker;
  const update: Record<string, unknown> = { billing_notes: merged };
  if (args.claimStatus) update.claim_status = args.claimStatus;
  const { error } = await sb
    .from("professional_claims")
    .update(update)
    .eq("id", args.claimId)
    .eq("organization_id", args.organizationId);
  if (error) return { ok: false, error: error.message ?? "Failed to update claim" };
  return { ok: true };
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
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const userId = guard.userId;

    const action = body.action;
    const claimId = body.claimId ?? null;
    const clientId = body.clientId ?? null;
    const appointmentId = body.appointmentId ?? null;
    const note = (body.note ?? "").trim();

    if (!action || !claimId) {
      return NextResponse.json(
        { success: false, error: "action and claimId are required" },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };

    switch (action) {
      case "hold_claim": {
        const marker = `[HOLD - enrollment ${new Date().toISOString()}] ${
          note || "Held pending provider enrollment fix"
        }`;
        const r = await appendBillingNote(sb, {
          organizationId,
          claimId,
          marker,
          claimStatus: "draft",
        });
        if (!r.ok) {
          return NextResponse.json({ success: false, error: r.error }, { status: 500 });
        }
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_claim_held",
          claimId,
          clientId,
          appointmentId,
          summary: note || "Held claim pending provider enrollment fix",
        });
        return NextResponse.json({ success: true });
      }
      case "release_claim": {
        const marker = `[RELEASED - enrollment ${new Date().toISOString()}] ${
          note || "Released after provider enrollment correction"
        }`;
        const r = await appendBillingNote(sb, {
          organizationId,
          claimId,
          marker,
          claimStatus: "ready_for_validation",
        });
        if (!r.ok) {
          return NextResponse.json({ success: false, error: r.error }, { status: 500 });
        }
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_claim_released",
          claimId,
          clientId,
          appointmentId,
          summary: note || "Released claim after enrollment correction",
        });
        return NextResponse.json({ success: true });
      }
      case "route_to_credentialing": {
        const summary = note || "Routed to credentialing";
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_routed_credentialing",
          claimId,
          clientId,
          appointmentId,
          summary,
          metadata: { note },
        });
        return NextResponse.json({
          success: true,
          assignment: { kind: "credentialing", display: "Credentialing", userId: null },
        });
      }
      case "credentialing_note": {
        if (!note) {
          return NextResponse.json(
            { success: false, error: "note is required" },
            { status: 400 },
          );
        }
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_credentialing_note",
          claimId,
          clientId,
          appointmentId,
          summary: note,
        });
        return NextResponse.json({ success: true });
      }
      case "appeal_denial": {
        const marker = `[APPEAL - enrollment ${new Date().toISOString()}] ${
          note || "Appeal opened for enrollment-related denial"
        }`;
        const r = await appendBillingNote(sb, { organizationId, claimId, marker });
        if (!r.ok) {
          return NextResponse.json({ success: false, error: r.error }, { status: 500 });
        }
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_appeal_started",
          claimId,
          clientId,
          appointmentId,
          summary: note || "Appeal started for enrollment denial",
        });
        return NextResponse.json({ success: true });
      }
      case "resubmit_after_correction": {
        const marker = `[RESUBMIT - enrollment ${new Date().toISOString()}] ${
          note || "Resubmitted after enrollment correction"
        }`;
        const r = await appendBillingNote(sb, {
          organizationId,
          claimId,
          marker,
          claimStatus: "ready_for_batch",
        });
        if (!r.ok) {
          return NextResponse.json({ success: false, error: r.error }, { status: 500 });
        }
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_claim_resubmitted",
          claimId,
          clientId,
          appointmentId,
          summary: note || "Resubmitted claim after enrollment correction",
        });
        return NextResponse.json({ success: true });
      }
      case "assign_biller": {
        const billerId = (body.billerId ?? userId ?? "").trim();
        if (!billerId) {
          return NextResponse.json(
            { success: false, error: "billerId is required" },
            { status: 400 },
          );
        }
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_assigned_biller",
          claimId,
          clientId,
          appointmentId,
          summary: note || `Assigned to biller ${billerId}`,
          metadata: { billerId, note },
        });
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
        await writeAudit(supabase, {
          organizationId,
          userId,
          action: "enrollment_follow_up_set",
          claimId,
          clientId,
          appointmentId,
          summary: note || `Follow-up due ${dueAt}`,
          metadata: { dueAt, note },
        });
        return NextResponse.json({ success: true, dueAt });
      }
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Action failed",
      },
      { status: 500 },
    );
  }
}
