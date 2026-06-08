/**
 * /api/billing/claims/[claimId]/hold
 *
 * POST — perform a hold-related action on a single claim. Body shape:
 *   { organizationId, action, ...args }
 *
 * Supported actions:
 *   - "place"          place a draft/ready claim on hold
 *   - "release"        release the hold (claim returns to draft)
 *   - "extend"         move the follow-up date forward
 *   - "change_reason"  change hold_category and/or hold_reason
 *   - "assign"         assign hold to a biller
 *   - "cancel_claim"   cancel the claim outright (voided)
 *
 * Every successful action writes a `claim_status_events` row tagged
 * source='biller' so it shows up on the claim timeline as an audit
 * trail entry.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

const HOLD_CATEGORIES = new Set([
  "manual",
  "documentation",
  "eligibility",
  "auth",
  "compliance",
  "payer_rule",
]);

const HOLD_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

type ActionBody = {
  organizationId?: string;
  action?: string;
  holdCategory?: string;
  holdReason?: string;
  followUpDate?: string | null;
  assigneeUserId?: string | null;
  assigneeDisplayName?: string | null;
  priority?: string;
  reason?: string;
};

function isYmd(value: string | null | undefined): boolean {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function resolveActorDisplayName(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  staffId: string | null,
): Promise<string> {
  if (!supabase || !staffId) return "Staff";
  const { data } = await (supabase as any)
    .from("staff_profiles")
    .select("first_name, last_name, email")
    .eq("id", staffId)
    .maybeSingle();
  if (!data) return "Staff";
  const composed = [data.first_name, data.last_name]
    .map((v: unknown) => text(v))
    .filter(Boolean)
    .join(" ");
  return composed || text(data.email) || "Staff";
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as ActionBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const { data: claim, error: loadErr } = await (supabase as any)
      .from("professional_claims")
      .select(
        "id, organization_id, claim_status, hold_category, hold_reason, hold_started_at, hold_follow_up_date, hold_assigned_to_user_id, hold_assigned_to_display_name, hold_priority",
      )
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!claim) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }

    const actorName = await resolveActorDisplayName(supabase, guard.staffId);
    const nowIso = new Date().toISOString();
    const action = text(body.action);

    const update: Record<string, unknown> = { updated_at: nowIso };
    let auditStatus = "hold_updated";
    let auditMessage = "";

    switch (action) {
      case "place": {
        const category = text(body.holdCategory) || "manual";
        if (!HOLD_CATEGORIES.has(category)) {
          return NextResponse.json(
            { success: false, error: "Invalid hold category" },
            { status: 400 },
          );
        }
        const reason = text(body.holdReason);
        if (!reason) {
          return NextResponse.json(
            { success: false, error: "Hold reason is required" },
            { status: 400 },
          );
        }
        const priority = text(body.priority) || "normal";
        if (!HOLD_PRIORITIES.has(priority)) {
          return NextResponse.json(
            { success: false, error: "Invalid priority" },
            { status: 400 },
          );
        }
        if (body.followUpDate && !isYmd(body.followUpDate)) {
          return NextResponse.json(
            { success: false, error: "followUpDate must be YYYY-MM-DD" },
            { status: 400 },
          );
        }
        Object.assign(update, {
          claim_status: "on_hold",
          hold_category: category,
          hold_reason: reason,
          held_by_user_id: guard.userId,
          held_by_display_name: actorName,
          hold_started_at: claim.hold_started_at ?? nowIso,
          hold_follow_up_date: body.followUpDate ?? null,
          hold_priority: priority,
        });
        auditStatus = "on_hold";
        auditMessage = `Placed on ${category} hold by ${actorName}: ${reason}`;
        break;
      }
      case "release": {
        if (claim.claim_status !== "on_hold") {
          return NextResponse.json(
            { success: false, error: "Claim is not on hold" },
            { status: 409 },
          );
        }
        Object.assign(update, {
          claim_status: "draft",
          hold_category: null,
          hold_reason: null,
          held_by_user_id: null,
          held_by_display_name: null,
          hold_started_at: null,
          hold_follow_up_date: null,
          hold_assigned_to_user_id: null,
          hold_assigned_to_display_name: null,
          hold_priority: null,
        });
        auditStatus = "hold_released";
        auditMessage = `Hold released by ${actorName}${text(body.reason) ? `: ${text(body.reason)}` : ""}`;
        break;
      }
      case "extend": {
        if (claim.claim_status !== "on_hold") {
          return NextResponse.json(
            { success: false, error: "Claim is not on hold" },
            { status: 409 },
          );
        }
        const followUp = text(body.followUpDate);
        if (!isYmd(followUp)) {
          return NextResponse.json(
            { success: false, error: "followUpDate must be YYYY-MM-DD" },
            { status: 400 },
          );
        }
        update.hold_follow_up_date = followUp;
        auditStatus = "hold_extended";
        auditMessage = `Hold extended by ${actorName} to ${followUp}`;
        break;
      }
      case "change_reason": {
        if (claim.claim_status !== "on_hold") {
          return NextResponse.json(
            { success: false, error: "Claim is not on hold" },
            { status: 409 },
          );
        }
        const category = body.holdCategory ? text(body.holdCategory) : null;
        if (category && !HOLD_CATEGORIES.has(category)) {
          return NextResponse.json(
            { success: false, error: "Invalid hold category" },
            { status: 400 },
          );
        }
        const reason = text(body.holdReason);
        if (!reason && !category) {
          return NextResponse.json(
            { success: false, error: "Provide a new reason or category" },
            { status: 400 },
          );
        }
        if (category) update.hold_category = category;
        if (reason) update.hold_reason = reason;
        auditStatus = "hold_reason_changed";
        auditMessage = `Hold reason changed by ${actorName}: ${[category, reason].filter(Boolean).join(" — ")}`;
        break;
      }
      case "assign": {
        if (claim.claim_status !== "on_hold") {
          return NextResponse.json(
            { success: false, error: "Claim is not on hold" },
            { status: 409 },
          );
        }
        const assigneeId = body.assigneeUserId ? text(body.assigneeUserId) : null;
        const assigneeName = body.assigneeDisplayName
          ? text(body.assigneeDisplayName)
          : null;
        update.hold_assigned_to_user_id = assigneeId;
        update.hold_assigned_to_display_name = assigneeName;
        auditStatus = "hold_assigned";
        auditMessage = `Hold assigned by ${actorName} → ${assigneeName ?? "(unassigned)"}`;
        break;
      }
      case "cancel_claim": {
        Object.assign(update, {
          claim_status: "cancelled",
          hold_category: null,
          hold_reason: null,
          held_by_user_id: null,
          held_by_display_name: null,
          hold_started_at: null,
          hold_follow_up_date: null,
          hold_assigned_to_user_id: null,
          hold_assigned_to_display_name: null,
          hold_priority: null,
        });
        auditStatus = "cancelled";
        auditMessage = `Claim cancelled by ${actorName}${text(body.reason) ? `: ${text(body.reason)}` : ""}`;
        break;
      }
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action || "(none)"}` },
          { status: 400 },
        );
    }

    const { data: updated, error: updErr } = await (supabase as any)
      .from("professional_claims")
      .update(update)
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .select(
        "id, claim_status, hold_category, hold_reason, held_by_display_name, hold_started_at, hold_follow_up_date, hold_assigned_to_user_id, hold_assigned_to_display_name, hold_priority, updated_at",
      )
      .single();
    if (updErr) {
      return NextResponse.json(
        { success: false, error: updErr.message },
        { status: 422 },
      );
    }

    // Audit trail entry on the claim timeline.
    await (supabase as any).from("claim_status_events").insert({
      claim_id: claimId,
      source: "biller",
      status: auditStatus,
      status_message: auditMessage,
      raw_payload: {
        action,
        actor_user_id: guard.userId,
        actor_display_name: actorName,
        ...body,
      },
    });

    return NextResponse.json({ success: true, claim: updated });
  } catch (e) {
    console.error("Claim hold action error:", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
