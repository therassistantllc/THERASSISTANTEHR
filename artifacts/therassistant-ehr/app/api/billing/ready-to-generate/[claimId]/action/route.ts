/**
 * POST /api/billing/ready-to-generate/[claimId]/action
 * Body: { organizationId: string, action: "generate" | "add_to_batch" | "return_to_charge_capture" | "hold" | "unhold", reason?: string }
 *
 * Row/panel actions for the Ready-to-Generate workqueue. All updates are
 * recorded in claim_status_events so the timeline reflects the change.
 *
 *   - generate          → create a single-claim 837P batch
 *   - add_to_batch      → same as generate (claim is queued onto a batch);
 *                          accepts an optional `batchId` to attach to an
 *                          existing pending batch in the future.
 *   - return_to_charge_capture → flip claim_status back to 'draft' so the
 *                          biller can re-edit it in Charge Capture
 *   - hold              → stamp held_at + hold_reason (claim drops off the
 *                          Ready tab and surfaces on the On Hold filter)
 *   - unhold            → clear held_at / hold_reason
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { rebuild837PBatchFile } from "@/lib/claims/rebuild837PBatchFile";

type Action = "generate" | "add_to_batch" | "return_to_charge_capture" | "hold" | "unhold";

function batchNumber() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `837P-${stamp}`;
}

async function recordEvent(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  claimId: string,
  source: string,
  detail: Record<string, unknown>,
) {
  if (!supabase) return;
  try {
    const { error } = await (supabase as any).from("claim_status_events").insert({
      organization_id: organizationId,
      claim_id: claimId,
      source,
      detail,
    });
    if (error) {
      console.warn("[ready-to-generate] audit insert failed", {
        organizationId,
        claimId,
        source,
        detail,
        error: error.message ?? error,
      });
    }
  } catch (err) {
    // Audit trail is best-effort — never fail the action because the
    // events table is missing a column — but always surface the cause in
    // logs so observability tooling can alert on schema drift.
    console.warn("[ready-to-generate] audit insert threw", {
      organizationId,
      claimId,
      source,
      detail,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await context.params;
    if (!claimId) {
      return NextResponse.json({ success: false, error: "claimId is required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      organizationId?: string;
      action?: Action;
      reason?: string;
      batchId?: string;
    };

    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const createdByUserId = guard.userId ?? null;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data: claim, error: fetchError } = await (supabase as any)
      .from("professional_claims")
      .select("id, claim_status, total_charge, held_at, archived_at")
      .eq("organization_id", organizationId)
      .eq("id", claimId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }
    if (claim.archived_at) {
      return NextResponse.json(
        { success: false, error: "Claim is archived" },
        { status: 422 },
      );
    }

    const now = new Date().toISOString();
    const action = body.action;

    if (action === "hold") {
      const reason = (body.reason ?? "").trim() || "Held by biller";
      const { error } = await (supabase as any)
        .from("professional_claims")
        .update({ held_at: now, hold_reason: reason, updated_at: now })
        .eq("organization_id", organizationId)
        .eq("id", claimId);
      if (error) throw error;
      await recordEvent(supabase, organizationId, claimId, "ready_to_generate", {
        action: "hold",
        reason,
      });
      return NextResponse.json({ success: true, claim: { id: claimId, held_at: now, hold_reason: reason } });
    }

    if (action === "unhold") {
      const { error } = await (supabase as any)
        .from("professional_claims")
        .update({ held_at: null, hold_reason: null, updated_at: now })
        .eq("organization_id", organizationId)
        .eq("id", claimId);
      if (error) throw error;
      await recordEvent(supabase, organizationId, claimId, "ready_to_generate", { action: "unhold" });
      return NextResponse.json({ success: true, claim: { id: claimId, held_at: null } });
    }

    if (action === "return_to_charge_capture") {
      const { error } = await (supabase as any)
        .from("professional_claims")
        .update({ claim_status: "draft", held_at: null, hold_reason: null, updated_at: now })
        .eq("organization_id", organizationId)
        .eq("id", claimId);
      if (error) throw error;
      await recordEvent(supabase, organizationId, claimId, "ready_to_generate", {
        action: "return_to_charge_capture",
      });
      return NextResponse.json({ success: true, claim: { id: claimId, claim_status: "draft" } });
    }

    if (action === "generate" || action === "add_to_batch") {
      if (claim.claim_status !== "ready_for_batch") {
        return NextResponse.json(
          { success: false, error: `Claim is ${claim.claim_status}; only ready_for_batch claims can be batched` },
          { status: 422 },
        );
      }
      if (claim.held_at) {
        return NextResponse.json(
          { success: false, error: "Claim is on hold; release the hold before batching" },
          { status: 422 },
        );
      }

      // Single source of truth for the composite write: the Postgres
      // function runs all three writes (batch insert, link insert,
      // status flip) inside one transaction so a mid-process kill can
      // never leave the claim half-batched.
      const generatedBatchNumber = batchNumber();
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
        "create_837p_batch_atomic",
        {
          p_organization_id: organizationId,
          p_claim_ids: [claimId],
          p_batch_number: generatedBatchNumber,
          p_payer_profile_id: null,
        },
      );
      if (rpcError) {
        const msg = rpcError.message ?? "Failed to create batch";
        const status = rpcError.code === "P0002" ? 404 : rpcError.code === "22023" ? 422 : 500;
        return NextResponse.json({ success: false, error: msg }, { status });
      }
      const result = (rpcData ?? {}) as { batch_id?: string; batch_number?: string };
      if (!result.batch_id) {
        return NextResponse.json(
          { success: false, error: "Batch creation returned no batch id" },
          { status: 500 },
        );
      }

      // Stamp the originating biller on the freshly created batch so a
      // failed generation can be auto-routed back to them by the
      // orphaned-batches workqueue (Task #694). Best-effort.
      if (createdByUserId) {
        try {
          await (supabase as any)
            .from("claim_837p_batches")
            .update({ created_by_user_id: createdByUserId })
            .eq("id", result.batch_id)
            .eq("organization_id", organizationId);
        } catch (err) {
          console.warn("[ready-to-generate/action] failed to stamp created_by", {
            batchId: result.batch_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await recordEvent(supabase, organizationId, claimId, "ready_to_generate", {
        action,
        batch_id: result.batch_id,
        batch_number: result.batch_number,
      });

      // Auto-generate the 837P file so the freshly created batch lands as
      // a downloadable, submittable file. On validator failure, mirror the
      // Rebuild route: leave the batch in 'ready_to_generate' and surface
      // 422 with the message rather than silently shipping an empty batch.
      const rebuildResult = await rebuild837PBatchFile({
        batchId: result.batch_id,
        organizationId,
      });
      if (!rebuildResult.ok) {
        // The validator pinpoints the failing field; the structured
        // errorDetail lets the Ready-to-Generate UI map it onto the
        // 837P field checklist tab instead of forcing the biller to
        // parse the prose error string.
        const detail = rebuildResult.errorDetail
          ? { ...rebuildResult.errorDetail, claimId: rebuildResult.errorDetail.claimId ?? claimId }
          : undefined;
        return NextResponse.json(
          {
            success: false,
            error: rebuildResult.error ?? "Failed to generate 837P file",
            batchId: result.batch_id,
            batchNumber: result.batch_number,
            status: "ready_to_generate",
            errorDetail: detail,
            claim: { id: claimId, claim_status: "batched" },
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        success: true,
        batchId: result.batch_id,
        batchNumber: result.batch_number,
        status: "generated",
        fileName: rebuildResult.fileName,
        claimCount: rebuildResult.claimCount,
        claim: { id: claimId, claim_status: "batched" },
      });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("Ready-to-Generate action error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 },
    );
  }
}
