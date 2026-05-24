/**
 * POST /api/claims/[claimId]/restore
 * Body: { organizationId: string }
 *
 * Clears archived_at on a professional_claims row so a biller can undo an
 * accidental archive. Refuses (409) when a different live claim already
 * occupies the encounter's dedupe slot — otherwise restoring would violate
 * the partial unique index `idx_professional_claims_unique_active_encounter`
 * (see supabase/migrations/20260604000000_professional_claims_archived_at.sql).
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
    if (!existing.archived_at) {
      return NextResponse.json({
        success: true,
        alreadyRestored: true,
        claim: { id: existing.id, archivedAt: null },
      });
    }

    if (existing.encounter_id) {
      const { data: liveSibling, error: siblingError } = await supabase
        .from("professional_claims")
        .select("id, claim_number")
        .eq("organization_id", organizationId)
        .eq("encounter_id", existing.encounter_id)
        .is("archived_at", null)
        .neq("id", claimId)
        .limit(1)
        .maybeSingle();

      if (siblingError) {
        return NextResponse.json(
          { success: false, error: siblingError.message },
          { status: 500 },
        );
      }
      if (liveSibling) {
        return NextResponse.json(
          {
            success: false,
            error:
              `Cannot restore: another live claim (${liveSibling.claim_number ?? liveSibling.id}) already exists for this encounter. ` +
              `Archive that claim first if you want to restore this one.`,
            conflictingClaimId: liveSibling.id,
          },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("professional_claims")
      .update({ archived_at: null, updated_at: now })
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
        error: error instanceof Error ? error.message : "Failed to restore claim",
      },
      { status: 500 },
    );
  }
}
