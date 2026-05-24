import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { loadMedicalReviewClaimContext } from "@/lib/medical-review/medicalReviewService";

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const claimId = searchParams.get("claimId");
    if (!claimId) {
      return NextResponse.json({ success: false, error: "claimId required" }, { status: 400 });
    }
    const context = await loadMedicalReviewClaimContext(supabase, guard.organizationId, claimId);
    return NextResponse.json({ success: true, context });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed to load context" },
      { status: 500 },
    );
  }
}
