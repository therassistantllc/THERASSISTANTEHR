/**
 * POST /api/billing/claim-build-errors/[claimId]
 *
 * Action handler for the Claim Build Errors workqueue. Supports:
 *   - { action: "revalidate" } — re-runs Claim Content Validation and
 *                                 stamps last_validated_at + validation_errors.
 *   - { action: "hold", reason? } — sets defer_until far future +
 *                                    deferred_reason='claim_build_hold'.
 *   - { action: "route_to_admin", reason? } — same as hold but with
 *                                              deferred_reason='routed_to_admin'.
 *
 * Every action appends an audit_logs row so the action is traceable.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { runClaimContentValidation } from "@/lib/validation/claim/runClaimContentValidation";
import {
  BUILD_HOLD_DEFER_UNTIL,
  DEFERRED_REASON_HOLD,
  DEFERRED_REASON_ROUTED,
} from "@/lib/billing/claimBuildErrors";

type ActionBody = {
  organizationId?: string;
  action?: "revalidate" | "hold" | "route_to_admin" | "release_hold";
  reason?: string;
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as ActionBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const staffId = guard.staffId;
    const userId = guard.userId;

    const { claimId } = await ctx.params;
    if (!claimId) {
      return NextResponse.json(
        { success: false, error: "claimId is required" },
        { status: 400 },
      );
    }

    // Verify the claim belongs to this org before we touch it.
    const { data: existing, error: lookupErr } = await (supabase as any)
      .from("professional_claims")
      .select("id, claim_status, defer_until, deferred_reason, claim_number")
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }

    const action = body.action;
    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 },
      );
    }

    if (action === "revalidate") {
      const result = await runClaimContentValidation(
        supabase as any,
        organizationId,
        claimId,
      );
      const findings = result.report.findings;
      const errorPayload = findings.map((f) => ({
        ruleId: f.ruleId,
        category: f.category,
        severity: f.severity,
        message: f.message,
      }));
      const blocking = result.report.summary.blocking;
      const nextStatus =
        existing.claim_status === "draft"
          ? "draft"
          : blocking === 0
            ? "ready_for_batch"
            : "validation_failed";

      const { error: updErr } = await (supabase as any)
        .from("professional_claims")
        .update({
          claim_status: nextStatus,
          validation_errors: errorPayload,
          last_validated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId)
        .eq("organization_id", organizationId);
      if (updErr) throw updErr;

      await writeAudit(supabase, {
        organizationId,
        userId,
        claimId,
        eventType: "claim_build_revalidated",
        summary: `Claim ${existing.claim_number ?? claimId} re-validated (${blocking} blocking).`,
        metadata: { blocking, total: findings.length, staffId },
      });

      return NextResponse.json({
        success: true,
        action,
        blocking,
        nextStatus,
        findings: errorPayload,
      });
    }

    if (action === "hold" || action === "route_to_admin") {
      const deferredReason =
        action === "hold" ? DEFERRED_REASON_HOLD : DEFERRED_REASON_ROUTED;
      const { error: updErr } = await (supabase as any)
        .from("professional_claims")
        .update({
          defer_until: BUILD_HOLD_DEFER_UNTIL,
          deferred_reason: deferredReason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId)
        .eq("organization_id", organizationId);
      if (updErr) throw updErr;

      await writeAudit(supabase, {
        organizationId,
        userId,
        claimId,
        eventType:
          action === "hold" ? "claim_build_held" : "claim_routed_to_admin",
        summary:
          action === "hold"
            ? `Claim ${existing.claim_number ?? claimId} held by biller.`
            : `Claim ${existing.claim_number ?? claimId} routed to admin.`,
        metadata: {
          deferred_reason: deferredReason,
          reason: body.reason ?? null,
          staffId,
        },
      });

      return NextResponse.json({
        success: true,
        action,
        deferred_reason: deferredReason,
      });
    }

    if (action === "release_hold") {
      const { error: updErr } = await (supabase as any)
        .from("professional_claims")
        .update({
          defer_until: null,
          deferred_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId)
        .eq("organization_id", organizationId);
      if (updErr) throw updErr;

      await writeAudit(supabase, {
        organizationId,
        userId,
        claimId,
        eventType: "claim_build_hold_released",
        summary: `Hold released on claim ${existing.claim_number ?? claimId}.`,
        metadata: { staffId },
      });

      return NextResponse.json({ success: true, action });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
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

async function writeAudit(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  args: {
    organizationId: string;
    userId: string | null;
    claimId: string;
    eventType: string;
    summary: string;
    metadata: Record<string, unknown>;
  },
) {
  if (!supabase) return;
  await (supabase as any).from("audit_logs").insert({
    organization_id: args.organizationId,
    user_id: args.userId,
    action: args.eventType,
    object_type: "claim",
    object_id: args.claimId,
    event_type: args.eventType,
    event_summary: args.summary,
    event_metadata: args.metadata,
  });
}
