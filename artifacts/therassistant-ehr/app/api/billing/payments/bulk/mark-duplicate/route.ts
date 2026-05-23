/**
 * POST /api/billing/payments/bulk/mark-duplicate
 * Body: { organizationId, ids: string[], duplicateOfId?: string }
 *
 * Marks selected payments as duplicates (stamps duplicate_of_id metadata
 * for later reconciliation) and archives them. Audit row keeps full provenance.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedPaymentPoster } from "@/lib/payments/postingEngine";
import { writePaymentAuditLog } from "@/lib/payments/postingEngine/audit";
import { applyBulkUpdate, parseTargets } from "../_shared";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const organizationId = String((body as { organizationId?: string }).organizationId ?? "");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }
  const duplicateOfId =
    (body as { duplicateOfId?: string | null }).duplicateOfId ?? null;
  const { targets, errors: parseErrors } = parseTargets((body as { ids?: unknown }).ids);
  if (targets.length === 0) {
    return NextResponse.json({ error: "No valid targets", parseErrors }, { status: 400 });
  }

  let actor;
  try {
    actor = await requireAuthenticatedPaymentPoster(organizationId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const now = new Date().toISOString();

  // 1) Persist the duplicate linkage as a workqueue item per target so the
  //    relationship is queryable from the workqueue + audit_logs (the
  //    payment tables don't carry a duplicate_of_id column). The item is
  //    written before archive so we keep referential context for AR.
  const linkageItemIds: string[] = [];
  for (const t of targets) {
    try {
      const { data } = await supabase
        .from("workqueue_items")
        .insert({
          organization_id: organizationId,
          source_object_type: t.auditObjectType,
          source_object_id: t.id,
          priority: "low",
          status: "open",
          work_type: "duplicate_review",
          title: "Marked as duplicate payment",
          description: duplicateOfId
            ? `This payment was marked as a duplicate of ${duplicateOfId} and archived. Review and reconcile in AR.`
            : `This payment was marked as a duplicate (no source id provided) and archived. Review and reconcile.`,
          context_payload: {
            rule: "duplicate_review",
            duplicate_of_id: duplicateOfId,
            archived_at: now,
            source_kind: t.kind,
          },
        })
        .select("id")
        .single();
      if (data && (data as { id?: string }).id) {
        const id = String((data as { id: string }).id);
        linkageItemIds.push(id);
        await writePaymentAuditLog(supabase, {
          organizationId,
          actor,
          action: "payment_adjusted",
          objectType: t.auditObjectType,
          objectId: t.id,
          workqueueItemId: id,
          afterValue: { duplicate_of_id: duplicateOfId },
          summary: `Duplicate linkage recorded → ${duplicateOfId ?? "(no source)"} for ${t.kind} ${t.id}`,
          metadata: { source: "mark_duplicate_linkage" },
        });
      }
    } catch (err) {
      // Non-fatal: linkage is best-effort; archive still runs below so
      // the duplicate is removed from the active dashboard either way.
      console.warn(
        "[bulk.mark-duplicate] linkage insert failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2) Archive the duplicate payments themselves.
  const r = await applyBulkUpdate(
    {
      supabase,
      organizationId,
      actor,
      action: "payment_voided",
      verb: "mark_duplicate",
      metadata: { duplicate_of_id: duplicateOfId, linkage_item_ids: linkageItemIds },
    },
    targets,
    () => ({
      archived_at: now,
      updated_at: now,
    }),
  );

  return NextResponse.json({
    ok: r.failed === 0,
    parseErrors,
    linkageItemIds,
    ...r,
  });
}
