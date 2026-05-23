import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });

    const { clientId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // professional_claims uses patient_id which maps to clients.id
    const { data: claims, error } = await supabase
      .from("professional_claims")
      .select("id, claim_number, claim_status, total_charge, patient_responsibility_amount, diagnosis_codes, created_at, submitted_at, appointment_id, encounter_id, payer_profile_id")
      .eq("organization_id", organizationId)
      .eq("patient_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    const items = (claims ?? []).map((claim: DbRow) => ({
      id: claim.id as string,
      claimNumber: claim.claim_number as string | null,
      status: claim.claim_status as string | null,
      totalCharge: claim.total_charge as number | null,
      patientResponsibilityAmount: claim.patient_responsibility_amount as number | null,
      diagnosisCodes: (claim.diagnosis_codes ?? []) as string[],
      createdAt: claim.created_at as string | null,
      submittedAt: claim.submitted_at as string | null,
      appointmentId: claim.appointment_id as string | null,
      encounterId: claim.encounter_id as string | null,
      payerProfileId: claim.payer_profile_id as string | null,
    }));

    return NextResponse.json({ success: true, claims: items, total: items.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load claims" },
      { status: 500 },
    );
  }
}
