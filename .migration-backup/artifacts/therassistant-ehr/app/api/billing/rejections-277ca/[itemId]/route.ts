/**
 * POST /api/billing/rejections-277ca/[itemId]
 *
 * Action handler for the 277CA Rejections workqueue. Supports:
 *   - { action: "correct_claim" }            — adds a "correction started" note.
 *   - { action: "resubmit_corrected_claim" } — flips the underlying claim
 *                                              back to ready_for_validation
 *                                              and notes the resubmission.
 *   - { action: "route_to_eligibility" }     — defers the item and notes the
 *                                              eligibility hand-off.
 *   - { action: "route_to_enrollment" }      — defers the item and notes the
 *                                              credentialing/enrollment
 *                                              hand-off.
 *   - { action: "mark_resolved" }            — closes the workqueue item via
 *                                              resolveWorkqueueItem (also
 *                                              creates a billing_alerts row).
 *
 * The action semantics live in `lib/billing/rejections277caActions.ts` so the
 * bulk endpoint can reuse them.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  applyRejection277CaAction,
  type Rejection277CaActionId,
} from "@/lib/billing/rejections277caActions";

type ActionBody = {
  organizationId?: string;
  action?: Rejection277CaActionId;
  note?: string;
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
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

    const { itemId } = await ctx.params;
    if (!itemId) {
      return NextResponse.json(
        { success: false, error: "itemId is required" },
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

    const result = await applyRejection277CaAction({
      supabase,
      organizationId,
      userId,
      staffId,
      itemId,
      action,
      note: body.note ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.httpStatus },
      );
    }
    return NextResponse.json({
      success: true,
      action: result.action,
      status: result.status,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Action failed" },
      { status: 500 },
    );
  }
}
