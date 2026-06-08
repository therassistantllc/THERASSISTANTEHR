/**
 * POST /api/billing/unmatched-era/[id]
 *
 * Action handler for the Unmatched ERA Claims workqueue. `[id]` is the
 * `era_claim_payments.id`.
 *
 * Supported actions:
 *   - { action: "match_claim", professionalClaimId | claimNumber, clientId? }
 *       Binds the ERA line to an internal claim. Delegates to the existing
 *       era-payments/[id]/match handler logic by writing the same fields
 *       (claim_match_status='matched', posting_status='ready').
 *   - { action: "create_missing_claim_record" }
 *       Records the intent (audit + note); the UI then opens the new-claim
 *       page with prefilled ERA data so the biller can save it.
 *   - { action: "post_manually" }
 *       Records the intent (audit + note); the UI opens the manual posting
 *       page for this batch so the biller can allocate without an internal
 *       claim.
 *   - { action: "ignore_line", reason? }
 *       Archives the era_claim_payments row (claim_match_status='ignored',
 *       archived_at=now). Resolves any companion workqueue_item.
 *   - { action: "escalate", note? }
 *       Bumps priority to 'urgent' on the companion workqueue_item (creating
 *       it if missing) and appends a note for the next biller.
 *
 * Every action also writes an `audit_logs` row.
 */
import { NextResponse } from "next/server";
import {
  createServerSupabaseAdminClient,
  createServerSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  addWorkqueueComment,
  resolveWorkqueueItem,
} from "@/lib/workqueue/workqueueActionService";

type ActionId =
  | "match_claim"
  | "create_missing_claim_record"
  | "post_manually"
  | "ignore_line"
  | "escalate";

interface ActionBody {
  organizationId?: string;
  action?: ActionId;
  professionalClaimId?: string;
  claimNumber?: string;
  clientId?: string;
  reason?: string;
  note?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Action failed";
}

async function writeAudit(args: {
  organizationId: string;
  userId: string | null;
  eraClaimPaymentId: string;
  claimId: string | null;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
}) {
  try {
    const sb = createServerSupabaseAdminClient();
    if (!sb) return;
    await (sb as any).from("audit_logs").insert({
      organization_id: args.organizationId,
      user_id: args.userId,
      action: args.eventType,
      object_type: args.claimId ? "claim" : "era_claim_payment",
      object_id: args.claimId ?? args.eraClaimPaymentId,
      event_type: args.eventType,
      event_summary: args.summary,
      event_metadata: { eraClaimPaymentId: args.eraClaimPaymentId, ...args.metadata },
    });
  } catch {
    // Audit must never block an otherwise successful action.
  }
}

async function ensureWorkqueueItem(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  payment: {
    id: string;
    professional_claim_id: string | null;
    client_id: string | null;
    clp01_claim_control_number: string;
    claim_match_status: string;
    posting_status: string;
  },
): Promise<string | null> {
  if (!supabase) return null;
  const { data: existing } = await (supabase as any)
    .from("workqueue_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("work_type", "era_mismatch")
    .eq("source_object_type", "payment_posting")
    .eq("source_object_id", payment.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await (supabase as any)
    .from("workqueue_items")
    .insert({
      organization_id: organizationId,
      title: `ERA mismatch – ${payment.clp01_claim_control_number}`,
      description: `Unmatched ERA line for claim control number ${payment.clp01_claim_control_number}.`,
      work_type: "era_mismatch",
      status: "open",
      priority: "high",
      source_object_type: "payment_posting",
      source_object_id: payment.id,
      client_id: payment.client_id,
      professional_claim_id: payment.professional_claim_id,
      context_payload: {
        logical_source_object_type: "era_claim_payment",
        clp01_claim_control_number: payment.clp01_claim_control_number,
        claim_match_status: payment.claim_match_status,
        posting_status: payment.posting_status,
      },
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted?.id ? String(inserted.id) : null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
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
    const userId = guard.userId;
    const staffId = guard.staffId;

    const { id: eraClaimPaymentId } = await ctx.params;
    if (!eraClaimPaymentId) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 },
      );
    }
    const action = body.action;
    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 },
      );
    }

    const { data: payment, error: payErr } = await (supabase as any)
      .from("era_claim_payments")
      .select(
        "id, organization_id, professional_claim_id, client_id, clp01_claim_control_number, claim_match_status, posting_status, archived_at",
      )
      .eq("organization_id", organizationId)
      .eq("id", eraClaimPaymentId)
      .maybeSingle();
    if (payErr) throw payErr;
    if (!payment) {
      return NextResponse.json(
        { success: false, error: "ERA claim payment not found" },
        { status: 404 },
      );
    }

    // ── match_claim ─────────────────────────────────────────────────────
    if (action === "match_claim") {
      const sr = createServerSupabaseServiceRoleClient();
      if (!sr) {
        return NextResponse.json(
          { success: false, error: "Service role key not configured" },
          { status: 503 },
        );
      }
      const claimNumber = (body.claimNumber ?? "").trim();
      const claimIdInput = (body.professionalClaimId ?? "").trim();
      if (!claimNumber && !claimIdInput) {
        return NextResponse.json(
          {
            success: false,
            error: "professionalClaimId or claimNumber is required",
          },
          { status: 400 },
        );
      }

      let claimId = claimIdInput;
      if (!claimId) {
        const { data: claim, error: claimErr } = await (sr as any)
          .from("professional_claims")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("claim_number", claimNumber)
          .maybeSingle();
        if (claimErr) throw claimErr;
        if (!claim?.id) {
          return NextResponse.json(
            {
              success: false,
              error: `No claim found with number "${claimNumber}" in this organization.`,
            },
            { status: 404 },
          );
        }
        claimId = String(claim.id);
      } else {
        // Re-verify tenant ownership of the supplied claim id.
        const { data: ownClaim, error: ownErr } = await (sr as any)
          .from("professional_claims")
          .select("id, client_id")
          .eq("organization_id", organizationId)
          .eq("id", claimId)
          .maybeSingle();
        if (ownErr) throw ownErr;
        if (!ownClaim?.id) {
          return NextResponse.json(
            {
              success: false,
              error: "Professional claim not found in this organization.",
            },
            { status: 404 },
          );
        }
      }

      const clientIdInput = (body.clientId ?? "").trim();
      if (clientIdInput) {
        const { data: ownClient, error: ownClientErr } = await (sr as any)
          .from("clients")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("id", clientIdInput)
          .maybeSingle();
        if (ownClientErr) throw ownClientErr;
        if (!ownClient?.id) {
          return NextResponse.json(
            { success: false, error: "Client not found in this organization." },
            { status: 404 },
          );
        }
      }

      const updatePayload: Record<string, unknown> = {
        professional_claim_id: claimId,
        claim_match_status: "matched",
        posting_status: "ready",
        updated_at: new Date().toISOString(),
      };
      if (clientIdInput) updatePayload.client_id = clientIdInput;

      const { error: updErr } = await (sr as any)
        .from("era_claim_payments")
        .update(updatePayload)
        .eq("id", eraClaimPaymentId)
        .eq("organization_id", organizationId);
      if (updErr) throw updErr;

      // Resolve any companion workqueue item.
      const { data: wq } = await (supabase as any)
        .from("workqueue_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("work_type", "era_mismatch")
        .eq("source_object_type", "payment_posting")
        .eq("source_object_id", eraClaimPaymentId)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (wq?.id) {
        await resolveWorkqueueItem({
          organizationId,
          workqueueItemId: String(wq.id),
          userId,
          comment: `ERA line matched to claim ${claimId} from Unmatched ERA workqueue.`,
        });
      }

      await writeAudit({
        organizationId,
        userId,
        eraClaimPaymentId,
        claimId,
        eventType: "unmatched_era_matched",
        summary: "Unmatched ERA line matched to internal claim.",
        metadata: { staffId, clientId: clientIdInput || null },
      });

      return NextResponse.json({ success: true, action, claimId });
    }

    // ── ignore_line ─────────────────────────────────────────────────────
    if (action === "ignore_line") {
      const sr = createServerSupabaseServiceRoleClient();
      if (!sr) {
        return NextResponse.json(
          { success: false, error: "Service role key not configured" },
          { status: 503 },
        );
      }
      const now = new Date().toISOString();
      const { error: updErr } = await (sr as any)
        .from("era_claim_payments")
        .update({
          archived_at: now,
          claim_match_status: "ignored",
          posting_status: "ignored",
          updated_at: now,
        })
        .eq("id", eraClaimPaymentId)
        .eq("organization_id", organizationId);
      if (updErr) throw updErr;

      const { data: wq } = await (supabase as any)
        .from("workqueue_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("work_type", "era_mismatch")
        .eq("source_object_type", "payment_posting")
        .eq("source_object_id", eraClaimPaymentId)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (wq?.id) {
        await resolveWorkqueueItem({
          organizationId,
          workqueueItemId: String(wq.id),
          userId,
          comment: body.reason
            ? `Ignored ERA line: ${body.reason}`
            : "ERA line ignored from Unmatched ERA workqueue.",
        });
      }

      await writeAudit({
        organizationId,
        userId,
        eraClaimPaymentId,
        claimId: null,
        eventType: "unmatched_era_ignored",
        summary: "Unmatched ERA line ignored / archived.",
        metadata: { staffId, reason: body.reason ?? null },
      });

      return NextResponse.json({ success: true, action });
    }

    // ── escalate ────────────────────────────────────────────────────────
    if (action === "escalate") {
      const wqId = await ensureWorkqueueItem(supabase, organizationId, payment);
      if (!wqId) {
        return NextResponse.json(
          { success: false, error: "Could not create workqueue item" },
          { status: 500 },
        );
      }
      const { error: priErr } = await (supabase as any)
        .from("workqueue_items")
        .update({ priority: "urgent", updated_at: new Date().toISOString() })
        .eq("id", wqId)
        .eq("organization_id", organizationId);
      if (priErr) throw priErr;
      await addWorkqueueComment({
        organizationId,
        workqueueItemId: wqId,
        userId,
        comment: body.note ?? "Escalated from Unmatched ERA workqueue.",
      });
      await writeAudit({
        organizationId,
        userId,
        eraClaimPaymentId,
        claimId: payment.professional_claim_id ?? null,
        eventType: "unmatched_era_escalated",
        summary: "Unmatched ERA line escalated.",
        metadata: { staffId, workqueueItemId: wqId },
      });
      return NextResponse.json({ success: true, action, workqueueItemId: wqId });
    }

    // ── post_manually / create_missing_claim_record ─────────────────────
    if (
      action === "post_manually" ||
      action === "create_missing_claim_record"
    ) {
      const sr = createServerSupabaseServiceRoleClient();
      if (!sr) {
        return NextResponse.json(
          { success: false, error: "Service role key not configured" },
          { status: 503 },
        );
      }
      // Transition the ERA line + workqueue item to in-progress so the
      // row reflects state change without a full reload and the line
      // stops getting re-suggested elsewhere.
      const nowIso = new Date().toISOString();
      const nextMatchStatus =
        action === "post_manually" ? "manual_posting" : "pending_claim_creation";
      const { error: ecpErr } = await (sr as any)
        .from("era_claim_payments")
        .update({
          claim_match_status: nextMatchStatus,
          posting_status: "in_progress",
          assigned_to_staff_id: staffId ?? null,
          updated_at: nowIso,
        })
        .eq("id", eraClaimPaymentId)
        .eq("organization_id", organizationId);
      if (ecpErr) throw ecpErr;

      const wqId = await ensureWorkqueueItem(supabase, organizationId, payment);
      if (wqId) {
        await (supabase as any)
          .from("workqueue_items")
          .update({
            status: "in_progress",
            assigned_to_user_id: userId ?? null,
            updated_at: nowIso,
          })
          .eq("id", wqId)
          .eq("organization_id", organizationId);
        await addWorkqueueComment({
          organizationId,
          workqueueItemId: wqId,
          userId,
          comment:
            action === "post_manually"
              ? "Biller is posting this ERA line manually (no internal claim)."
              : "Biller is creating the missing internal claim record for this ERA line.",
        });
      }
      await writeAudit({
        organizationId,
        userId,
        eraClaimPaymentId,
        claimId: null,
        eventType:
          action === "post_manually"
            ? "unmatched_era_post_manual_started"
            : "unmatched_era_create_claim_started",
        summary:
          action === "post_manually"
            ? "Manual posting started for unmatched ERA line."
            : "Started creating missing claim record from unmatched ERA line.",
        metadata: { staffId, workqueueItemId: wqId ?? null },
      });
      return NextResponse.json({
        success: true,
        action,
        workqueueItemId: wqId ?? null,
        rowPatch: {
          matchStatus: nextMatchStatus,
          postingStatus: "in_progress",
          status: "in_progress",
        },
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: errMsg(e) },
      { status: 500 },
    );
  }
}
