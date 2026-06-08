/**
 * POST /api/claims/[claimId]/archive
 * Body: { organizationId: string }
 *
 * Soft-archives a professional_claims row by stamping archived_at = now().
 *
 * The partial unique index `idx_professional_claims_unique_active_encounter`
 * (see supabase/migrations/20260604000000_professional_claims_archived_at.sql)
 * only constrains rows where `archived_at IS NULL`, so archiving a claim
 * frees its dedupe slot and lets a biller create a fresh claim for the same
 * encounter via /api/claims/create-from-encounter.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await context.params;
    if (!claimId) {
      return NextResponse.json(
        { success: false, error: "claimId is required" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      organizationId?: string;
    };

    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data: existing, error: fetchError } = await supabase
      .from("professional_claims")
      .select("id, archived_at, encounter_id")
      .eq("organization_id", organizationId)
      .eq("id", claimId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { success: false, error: fetchError.message },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }
    if (existing.archived_at) {
      return NextResponse.json({
        success: true,
        alreadyArchived: true,
        claim: { id: existing.id, archivedAt: existing.archived_at },
      });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("professional_claims")
      .update({ archived_at: now, updated_at: now })
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .select("id, archived_at, encounter_id")
      .single();

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      claim: {
        id: updated.id,
        archivedAt: updated.archived_at,
        encounterId: updated.encounter_id,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to archive claim",
      },
      { status: 500 },
    );
  }
}
