/**
 * /api/billing/claims/bulk-hold
 *
 * POST — place many claims on hold in one request using the same
 * category/reason/follow-up/priority for every claim. Mirrors the
 * "place" action in /api/billing/claims/[claimId]/hold but iterates
 * over a list of claim ids and surfaces a per-claim success/failure
 * summary so the UI can show "X placed on hold, Y failed".
 *
 * Body shape:
 *   {
 *     organizationId,
 *     claimIds: string[],          // required, max 200
 *     holdCategory,                 // same enum as single-claim place
 *     holdReason,                   // required, non-empty
 *     followUpDate?: "YYYY-MM-DD",  // optional
 *     priority?: "low|normal|high|urgent"
 *   }
 *
 * Each claim is processed independently. A failure on one claim never
 * blocks the others. The response is always 200 (the request itself
 * was well-formed) — callers inspect `succeeded`/`failed` to decide
 * what to render.
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

const MAX_CLAIMS_PER_REQUEST = 200;

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

type BulkHoldBody = {
  organizationId?: string;
  claimIds?: unknown;
  holdCategory?: string;
  holdReason?: string;
  followUpDate?: string | null;
  priority?: string;
};

interface PerClaimResult {
  claimId: string;
  success: boolean;
  claimNumber?: string | null;
  error?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as BulkHoldBody;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const rawIds = Array.isArray(body.claimIds) ? body.claimIds : [];
    const claimIds = Array.from(
      new Set(
        rawIds
          .map((v) => text(v))
          .filter((s) => s.length > 0),
      ),
    );
    if (claimIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "claimIds is required" },
        { status: 400 },
      );
    }
    if (claimIds.length > MAX_CLAIMS_PER_REQUEST) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many claims (max ${MAX_CLAIMS_PER_REQUEST} per request)`,
        },
        { status: 400 },
      );
    }

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
    const followUpDate = body.followUpDate || null;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const actorName = await resolveActorDisplayName(supabase, guard.staffId);
    const nowIso = new Date().toISOString();

    // Bulk-load all targeted claims up front so we can validate
    // existence/ownership without an extra round-trip per claim.
    const { data: loaded, error: loadErr } = await (supabase as any)
      .from("professional_claims")
      .select("id, claim_number, hold_started_at")
      .in("id", claimIds)
      .eq("organization_id", organizationId);
    if (loadErr) {
      return NextResponse.json(
        { success: false, error: loadErr.message },
        { status: 500 },
      );
    }
    const byId = new Map<
      string,
      { id: string; claim_number: string | null; hold_started_at: string | null }
    >();
    for (const row of (loaded ?? []) as Array<{
      id: string;
      claim_number: string | null;
      hold_started_at: string | null;
    }>) {
      byId.set(row.id, row);
    }

    const results: PerClaimResult[] = [];

    for (const claimId of claimIds) {
      const claim = byId.get(claimId);
      if (!claim) {
        results.push({
          claimId,
          success: false,
          error: "Claim not found",
        });
        continue;
      }

      const update = {
        updated_at: nowIso,
        claim_status: "on_hold",
        hold_category: category,
        hold_reason: reason,
        held_by_user_id: guard.userId,
        held_by_display_name: actorName,
        hold_started_at: claim.hold_started_at ?? nowIso,
        hold_follow_up_date: followUpDate,
        hold_priority: priority,
      };

      const { error: updErr } = await (supabase as any)
        .from("professional_claims")
        .update(update)
        .eq("id", claimId)
        .eq("organization_id", organizationId);
      if (updErr) {
        results.push({
          claimId,
          claimNumber: claim.claim_number,
          success: false,
          error: updErr.message,
        });
        continue;
      }

      // Audit trail — failures here shouldn't fail the hold itself
      // (the update already succeeded). Log and continue.
      const { error: auditErr } = await (supabase as any)
        .from("claim_status_events")
        .insert({
          claim_id: claimId,
          source: "biller",
          status: "on_hold",
          status_message: `Placed on ${category} hold by ${actorName} (bulk): ${reason}`,
          raw_payload: {
            action: "place",
            bulk: true,
            actor_user_id: guard.userId,
            actor_display_name: actorName,
            holdCategory: category,
            holdReason: reason,
            followUpDate,
            priority,
          },
        });
      if (auditErr) {
        console.warn("[bulk-hold] audit insert failed", {
          claimId,
          error: auditErr.message,
        });
      }

      results.push({
        claimId,
        claimNumber: claim.claim_number,
        success: true,
      });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;

    return NextResponse.json({
      success: true,
      totalRequested: claimIds.length,
      succeeded,
      failed,
      results,
    });
  } catch (e) {
    console.error("Bulk hold error:", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
