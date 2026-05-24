/**
 * POST /api/billing/transmission-failures/:batchId
 *
 * Handles the action buttons on the Transmission Failures workqueue.
 *
 * Supported actions:
 *   - "retry"           — Re-attempt transmission by delegating to the
 *                         canonical /api/claims/837p/batch/[id]/submit
 *                         retry path. Returns the submit endpoint's body.
 *   - "rebuild"         — Reset the batch so it can be regenerated and
 *                         re-submitted: clear submission_error, drop
 *                         http_status, force status back to
 *                         "ready_to_generate", reset attempt count.
 *   - "remove_claim"    — Archive a single claim out of this failed
 *                         batch so it can be reworked or rebatched
 *                         elsewhere. Decrements claim_count and
 *                         total_charge_amount on the batch.
 *   - "escalate"        — Open a routable escalation record against
 *                         this batch. Inserts a row into
 *                         `claim_837p_batch_escalations` (assignee +
 *                         priority + note + opened_at) and stamps the
 *                         batch's `assigned_to_user_id` so the
 *                         universal "Assigned biller" filter on the
 *                         queue can push down. We deliberately do NOT
 *                         munge `submission_error` here — that column
 *                         is the payer/clearinghouse's verdict and
 *                         must remain unedited so retries and audit
 *                         trails stay truthful.
 *   - "resolve_escalation"
 *                       — Close the current open escalation on this
 *                         batch (sets status=resolved, resolved_at,
 *                         resolved_by) and clears the batch-level
 *                         assignee.
 *
 * Every action is org-scoped and uses optimistic concurrency on the
 * batch's updated_at so two simultaneous biller actions don't clobber
 * each other.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;

const ALLOWED_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

interface Body {
  organizationId?: string;
  action?:
    | "retry"
    | "rebuild"
    | "remove_claim"
    | "escalate"
    | "resolve_escalation";
  claimId?: string;
  note?: string;
  assigneeUserId?: string | null;
  assigneeDisplayName?: string | null;
  priority?: string;
  resolutionNote?: string;
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function money(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ batchId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { batchId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Body;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const action = body.action;

    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 },
      );
    }

    const { data: batch, error: lookupErr } = await supabase
      .from("claim_837p_batches")
      .select(
        "id, batch_status, claim_count, total_charge_amount, submission_attempt_count, submission_error, updated_at",
      )
      .eq("id", batchId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (lookupErr) {
      return NextResponse.json(
        { success: false, error: lookupErr.message },
        { status: 422 },
      );
    }
    if (!batch) {
      return NextResponse.json(
        { success: false, error: "Batch not found" },
        { status: 404 },
      );
    }
    const observedUpdatedAt = text((batch as DbRow).updated_at);

    if (action === "retry") {
      // Delegate to the canonical submit endpoint so we share its
      // idempotency, concurrency, credential, and enrollment gates.
      const origin = new URL(request.url).origin;
      const res = await fetch(
        `${origin}/api/claims/837p/batch/${encodeURIComponent(batchId)}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId, action: "retry" }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      await writeAudit(supabase, {
        organizationId,
        userId: guard.userId ?? null,
        batchId,
        eventType: "transmission_failure.retry",
        summary: `Retried transmission for batch ${batchId} (status ${res.status})`,
        metadata: {
          httpStatus: res.status,
          delegatedSuccess: (payload as { success?: boolean })?.success === true,
          previousAttemptCount: Number((batch as DbRow).submission_attempt_count ?? 0),
          previousBatchStatus: text((batch as DbRow).batch_status),
        },
      });
      return NextResponse.json(payload, { status: res.status });
    }

    if (action === "rebuild") {
      const nowIso = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabase
        .from("claim_837p_batches")
        .update({
          batch_status: "ready_to_generate",
          submission_error: null,
          submission_attempt_count: 0,
          last_submission_http_status: null,
          last_submission_attempted_at: null,
          submission_idempotency_key: null,
          generated_file_content: null,
          generated_file_name: null,
          submitted_at: null,
          updated_at: nowIso,
        })
        .eq("id", batchId)
        .eq("organization_id", organizationId)
        .eq("updated_at", observedUpdatedAt)
        .select("id, batch_status, updated_at");
      if (updateErr) {
        return NextResponse.json(
          { success: false, error: updateErr.message },
          { status: 422 },
        );
      }
      if (!updated || updated.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Batch was modified by another request. Reload and try again.",
          },
          { status: 409 },
        );
      }
      await writeAudit(supabase, {
        organizationId,
        userId: guard.userId ?? null,
        batchId,
        eventType: "transmission_failure.rebuild",
        summary: `Reset batch ${batchId} to ready_to_generate`,
        metadata: {
          previousBatchStatus: text((batch as DbRow).batch_status),
          previousAttemptCount: Number((batch as DbRow).submission_attempt_count ?? 0),
          previousError: text((batch as DbRow).submission_error) || null,
        },
      });
      return NextResponse.json({ success: true, batch: updated[0] });
    }

    if (action === "remove_claim") {
      const claimId = text(body.claimId);
      if (!claimId) {
        return NextResponse.json(
          { success: false, error: "claimId is required for remove_claim" },
          { status: 400 },
        );
      }
      // Look up the link row + the claim's charge so we can decrement
      // the batch rollup atomically with the unlink.
      const { data: link } = await supabase
        .from("claim_837p_batch_claims")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("batch_id", batchId)
        .eq("professional_claim_id", claimId)
        .is("archived_at", null)
        .maybeSingle();
      if (!link) {
        return NextResponse.json(
          { success: false, error: "Claim is not in this batch" },
          { status: 404 },
        );
      }
      const { data: claim } = await supabase
        .from("professional_claims")
        .select("total_charge")
        .eq("id", claimId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      const removedCharge = money((claim as DbRow | null)?.total_charge);

      const archivedAt = new Date().toISOString();
      const linkId = (link as DbRow).id as string;
      const { error: unlinkErr } = await supabase
        .from("claim_837p_batch_claims")
        .update({ archived_at: archivedAt })
        .eq("id", linkId)
        .eq("organization_id", organizationId);
      if (unlinkErr) {
        return NextResponse.json(
          { success: false, error: unlinkErr.message },
          { status: 422 },
        );
      }

      const nextCount = Math.max(0, Number((batch as DbRow).claim_count ?? 0) - 1);
      const nextTotal = Math.max(
        0,
        Math.round(
          (money((batch as DbRow).total_charge_amount) - removedCharge) * 100,
        ) / 100,
      );
      // Rollup update uses optimistic concurrency on the same updated_at
      // we observed at the top of the request. If the rollup write fails
      // for any reason — DB error, version drift from a concurrent
      // action — we MUST compensate by un-archiving the link row so the
      // batch and its claims stay consistent. Supabase has no client-
      // side transaction, so this rollback is the only safety net.
      const { data: rollup, error: rollupErr } = await supabase
        .from("claim_837p_batches")
        .update({
          claim_count: nextCount,
          total_charge_amount: nextTotal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId)
        .eq("organization_id", organizationId)
        .eq("updated_at", observedUpdatedAt)
        .select("id, claim_count, total_charge_amount, updated_at");

      if (rollupErr || !rollup || rollup.length === 0) {
        await supabase
          .from("claim_837p_batch_claims")
          .update({ archived_at: null })
          .eq("id", linkId)
          .eq("organization_id", organizationId);
        if (rollupErr) {
          return NextResponse.json(
            { success: false, error: rollupErr.message },
            { status: 422 },
          );
        }
        return NextResponse.json(
          {
            success: false,
            error:
              "Batch was modified by another request. Reload and try again.",
          },
          { status: 409 },
        );
      }

      await writeAudit(supabase, {
        organizationId,
        userId: guard.userId ?? null,
        batchId,
        eventType: "transmission_failure.remove_claim",
        summary: `Removed claim ${claimId} from batch ${batchId}`,
        metadata: {
          claimId,
          removedCharge,
          previousClaimCount: Number((batch as DbRow).claim_count ?? 0),
          previousTotalCharges: money((batch as DbRow).total_charge_amount),
          nextClaimCount: nextCount,
          nextTotalCharges: nextTotal,
        },
      });

      return NextResponse.json({
        success: true,
        removed: { claimId, removedCharge },
        batch: { id: batchId, claimCount: nextCount, totalCharges: nextTotal },
      });
    }

    if (action === "escalate") {
      const note = text(body.note) || "Escalated for technical review.";
      const priority = text(body.priority).toLowerCase() || "normal";
      if (!ALLOWED_PRIORITIES.has(priority)) {
        return NextResponse.json(
          { success: false, error: `Invalid priority: ${priority}` },
          { status: 400 },
        );
      }
      // Always derive the assignee's display name server-side from
      // staff_profiles. We never trust a client-supplied display name —
      // and we require the assignee belong to this organization, so a
      // forged user id can't slip past tenant boundaries.
      const assigneeUserIdRaw = text(body.assigneeUserId) || null;
      let assigneeUserId: string | null = null;
      let assigneeDisplayName: string | null = null;
      if (assigneeUserIdRaw) {
        const { data: staff } = await (supabase as any)
          .from("staff_profiles")
          .select("id, first_name, last_name, email")
          .eq("id", assigneeUserIdRaw)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (!staff) {
          return NextResponse.json(
            { success: false, error: "Assignee is not a member of this organization" },
            { status: 422 },
          );
        }
        assigneeUserId = text((staff as DbRow).id);
        const composed = [(staff as DbRow).first_name, (staff as DbRow).last_name]
          .map(text)
          .filter(Boolean)
          .join(" ");
        assigneeDisplayName =
          composed || text((staff as DbRow).email) || null;
      }

      const stamp = new Date().toISOString();

      // Single-open invariant: a batch may have at most one open
      // escalation at a time. A reassign (re-escalate while one is
      // already open) supersedes the prior row by marking it
      // "cancelled" with an audit-friendly resolution note. The DB
      // also enforces this via a partial unique index, so racing
      // reassigns can't both win.
      const { data: priorOpen } = await (supabase as any)
        .from("claim_837p_batch_escalations")
        .select("id, assigned_to_display_name")
        .eq("organization_id", organizationId)
        .eq("batch_id", batchId)
        .eq("status", "open");
      const priorIds = ((priorOpen as DbRow[]) ?? [])
        .map((r) => text(r.id))
        .filter(Boolean);
      if (priorIds.length > 0) {
        const { error: cancelErr } = await (supabase as any)
          .from("claim_837p_batch_escalations")
          .update({
            status: "cancelled",
            resolved_at: stamp,
            resolved_by_user_id: guard.userId ?? null,
            resolution_note: "Superseded by reassign",
          })
          .in("id", priorIds)
          .eq("organization_id", organizationId);
        if (cancelErr) {
          return NextResponse.json(
            { success: false, error: cancelErr.message },
            { status: 422 },
          );
        }
      }

      // Create the new routable escalation record.
      const { data: inserted, error: insertErr } = await (supabase as any)
        .from("claim_837p_batch_escalations")
        .insert({
          organization_id: organizationId,
          batch_id: batchId,
          status: "open",
          priority,
          note,
          assigned_to_user_id: assigneeUserId,
          assigned_to_display_name: assigneeDisplayName,
          opened_by_user_id: guard.userId ?? null,
          opened_at: stamp,
        })
        .select(
          "id, status, priority, note, assigned_to_user_id, assigned_to_display_name, opened_at, opened_by_user_id",
        )
        .single();
      if (insertErr || !inserted) {
        return NextResponse.json(
          { success: false, error: insertErr?.message || "Failed to record escalation" },
          { status: 422 },
        );
      }

      // Mirror the assignee onto the batch so the queue's universal
      // "Assigned biller" filter can push down at SQL. If this update
      // loses on optimistic concurrency we keep the escalation row
      // (it's the source of truth) and let the next refresh re-sync.
      const { data: updated, error: updateErr } = await supabase
        .from("claim_837p_batches")
        .update({
          assigned_to_user_id: assigneeUserId,
          assigned_to_display_name: assigneeDisplayName,
          updated_at: stamp,
        })
        .eq("id", batchId)
        .eq("organization_id", organizationId)
        .eq("updated_at", observedUpdatedAt)
        .select("id, assigned_to_user_id, assigned_to_display_name, updated_at");
      if (updateErr) {
        return NextResponse.json(
          { success: false, error: updateErr.message },
          { status: 422 },
        );
      }

      await writeAudit(supabase, {
        organizationId,
        userId: guard.userId ?? null,
        batchId,
        eventType: "transmission_failure.escalate",
        summary: `Escalated batch ${batchId} to ${
          assigneeDisplayName ?? "unassigned"
        } (${priority})`,
        metadata: {
          escalationId: (inserted as DbRow).id,
          note,
          priority,
          assigneeUserId,
          assigneeDisplayName,
          escalatedBy: guard.userId ?? null,
          escalatedAt: stamp,
          previousBatchStatus: text((batch as DbRow).batch_status),
        },
      });
      return NextResponse.json({
        success: true,
        escalation: inserted,
        batch: updated && updated.length ? updated[0] : null,
      });
    }

    if (action === "resolve_escalation") {
      const stamp = new Date().toISOString();
      const resolutionNote = text(body.resolutionNote) || null;
      const { data: open, error: openErr } = await (supabase as any)
        .from("claim_837p_batch_escalations")
        .select("id, assigned_to_user_id, assigned_to_display_name")
        .eq("organization_id", organizationId)
        .eq("batch_id", batchId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openErr) {
        return NextResponse.json(
          { success: false, error: openErr.message },
          { status: 422 },
        );
      }
      if (!open) {
        return NextResponse.json(
          { success: false, error: "No open escalation on this batch" },
          { status: 404 },
        );
      }

      const { data: resolved, error: resolveErr } = await (supabase as any)
        .from("claim_837p_batch_escalations")
        .update({
          status: "resolved",
          resolved_at: stamp,
          resolved_by_user_id: guard.userId ?? null,
          resolution_note: resolutionNote,
        })
        .eq("id", (open as DbRow).id)
        .eq("organization_id", organizationId)
        .select("id, status, resolved_at, resolved_by_user_id, resolution_note");
      if (resolveErr) {
        return NextResponse.json(
          { success: false, error: resolveErr.message },
          { status: 422 },
        );
      }

      // Mirror the batch's `assigned_to_*` from whatever escalation is
      // still open (if any). The DB partial unique index guarantees at
      // most one remains, but we tolerate stragglers by taking the most
      // recent. Only clear the batch assignee when no open escalation
      // remains — otherwise we'd break the "Assigned biller" filter for
      // batches that still have a routed escalation.
      const { data: remaining } = await (supabase as any)
        .from("claim_837p_batch_escalations")
        .select("assigned_to_user_id, assigned_to_display_name")
        .eq("organization_id", organizationId)
        .eq("batch_id", batchId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextAssigneeId = remaining
        ? (text((remaining as DbRow).assigned_to_user_id) || null)
        : null;
      const nextAssigneeName = remaining
        ? (text((remaining as DbRow).assigned_to_display_name) || null)
        : null;
      await supabase
        .from("claim_837p_batches")
        .update({
          assigned_to_user_id: nextAssigneeId,
          assigned_to_display_name: nextAssigneeName,
          updated_at: stamp,
        })
        .eq("id", batchId)
        .eq("organization_id", organizationId)
        .eq("updated_at", observedUpdatedAt);

      await writeAudit(supabase, {
        organizationId,
        userId: guard.userId ?? null,
        batchId,
        eventType: "transmission_failure.resolve_escalation",
        summary: `Resolved escalation on batch ${batchId}`,
        metadata: {
          escalationId: (open as DbRow).id,
          resolutionNote,
          resolvedBy: guard.userId ?? null,
          resolvedAt: stamp,
        },
      });

      return NextResponse.json({
        success: true,
        escalation: resolved && resolved.length ? resolved[0] : null,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Action failed" },
      { status: 500 },
    );
  }
}

async function writeAudit(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  args: {
    organizationId: string;
    userId: string | null;
    batchId: string;
    eventType: string;
    summary: string;
    metadata: Record<string, unknown>;
  },
) {
  try {
    await (supabase as any).from("audit_logs").insert({
      organization_id: args.organizationId,
      user_id: args.userId,
      action: args.eventType,
      object_type: "claim_837p_batch",
      object_id: args.batchId,
      event_type: args.eventType,
      event_summary: args.summary,
      event_metadata: args.metadata,
    });
  } catch {
    // Audit write must never break the action it audits.
  }
}
