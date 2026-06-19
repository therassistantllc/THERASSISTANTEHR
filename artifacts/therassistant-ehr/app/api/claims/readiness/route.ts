import { NextResponse } from "next/server";
import {
  createProfessionalClaimDraft,
  validateProfessionalClaimReadiness,
} from "@/lib/claims/claimReadinessService";
import { assignClaimToAutoBatch } from "@/lib/claims/autoBatchClaimService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { assertClaimSubmissionReady, gateResponse } from "@/lib/validation/claimSubmissionGate";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action ?? "create_draft";

    if (action === "validate_existing") {
      if (!body.organizationId || !body.claimId) {
        return NextResponse.json({ success: false, error: "organizationId and claimId are required" }, { status: 400 });
      }

      const result = await validateProfessionalClaimReadiness(String(body.claimId), String(body.organizationId));
      return NextResponse.json({ success: result.ok, result });
    }

    if (action === "release_to_batch") {
      if (!body.organizationId || !body.claimId) {
        return NextResponse.json({ success: false, error: "organizationId and claimId are required" }, { status: 400 });
      }

      const organizationId = String(body.organizationId);
      const claimId = String(body.claimId);
      const validation = await validateProfessionalClaimReadiness(claimId, organizationId);
      if (!validation.ok) {
        return NextResponse.json({ success: false, result: validation }, { status: 422 });
      }

      const supabase = createServerSupabaseAdminClient();
      if (!supabase) {
        return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
      }

      const { error: updateError } = await supabase
        .from("professional_claims")
        .update({ claim_status: "ready_for_batch", updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("id", claimId)
        .in("claim_status", ["draft", "ready_for_validation", "validation_failed", "ready_for_batch"]);

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 422 });
      }

      const batchResult = await assignClaimToAutoBatch({ organizationId, claimId });
      return NextResponse.json(
        { success: batchResult.ok, result: { ...validation, batch: batchResult } },
        { status: batchResult.ok ? 200 : 422 },
      );
    }

    const required = ["organizationId", "clientId", "diagnosisCodes", "serviceLines", "billingProvider"];
    for (const field of required) {
      if (body[field] == null) {
        return NextResponse.json({ success: false, error: `${field} is required` }, { status: 400 });
      }
    }

    const gate = await assertClaimSubmissionReady(String(body.organizationId));
    const blocked = gateResponse(gate);
    if (blocked) return blocked;

    const result = await createProfessionalClaimDraft({
      organizationId: String(body.organizationId),
      clientId: String(body.clientId),
      policyId: body.policyId ?? null,
      appointmentId: body.appointmentId ?? null,
      placeOfService: body.placeOfService ?? null,
      diagnosisCodes: body.diagnosisCodes,
      serviceLines: body.serviceLines,
      billingProvider: body.billingProvider,
      providerCredentialingProfileId: body.providerCredentialingProfileId ?? null,
      patientAccountNumber: body.patientAccountNumber ?? null,
      claimNumber: body.claimNumber ?? null,
    });

    return NextResponse.json({ success: result.ok, result }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("Claim readiness API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Claim readiness failed" },
      { status: 500 },
    );
  }
}
