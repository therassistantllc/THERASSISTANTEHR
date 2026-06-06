import {
  createProfessionalClaimDraft,
  validateProfessionalClaimReadiness,
  type ClaimServiceLineInput,
} from "@/lib/claims/claimReadinessService";
import { assignClaimToAutoBatch } from "@/lib/claims/autoBatchClaimService";
import { resolveProviderCredentialingProfile } from "@/lib/providers/providerCredentialingResolverService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

export interface CreateClaimFromChargeCaptureInput {
  organizationId: string;
  chargeCaptureId: string;
}

export interface CreateClaimFromChargeCaptureResult {
  ok: boolean;
  claimId: string | null;
  errors: Array<{ field: string; message: string }>;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function readArray(value: unknown): DbRow[] {
  return Array.isArray(value) ? (value as DbRow[]) : [];
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function serviceLinesFromCharge(charge: DbRow, renderingProviderNpi: string | null): ClaimServiceLineInput[] {
  return readArray(charge.service_lines).map((line) => ({
    serviceDate: text(line.serviceDate) || text(charge.service_date),
    procedureCode: text(line.procedureCode),
    modifiers: readTextArray(line.modifiers),
    units: Number(line.units ?? 1) || 1,
    chargeAmount: money(line.chargeAmount),
    diagnosisPointers: ["1"],
    placeOfService: text(line.placeOfService) || text(charge.place_of_service) || null,
    renderingProviderNpi: text(line.renderingProviderNpi) || renderingProviderNpi,
    authorizationNumber: text(line.authorizationNumber) || null,
  })).filter((line) => line.procedureCode && line.chargeAmount > 0 && line.serviceDate);
}

async function linkChargeToClaim(params: {
  organizationId: string;
  chargeCaptureId: string;
  claimId: string;
  encounterId?: string | null;
}) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");
  const now = new Date().toISOString();

  const { error: chargeLinkError } = await supabase
    .from("charge_capture_items")
    .update({
      claim_id: params.claimId,
      charge_status: "claim_created",
      claim_created_at: now,
      updated_at: now,
    })
    .eq("organization_id", params.organizationId)
    .eq("id", params.chargeCaptureId);

  if (chargeLinkError) throw new Error(chargeLinkError.message);

  if (params.encounterId) {
    const { error: encounterLinkError } = await supabase
      .from("professional_claims")
      .update({ encounter_id: params.encounterId, updated_at: now })
      .eq("organization_id", params.organizationId)
      .eq("id", params.claimId)
      .is("encounter_id", null);

    if (encounterLinkError) throw new Error(encounterLinkError.message);
  }
}

async function findExistingClaimForCharge(charge: DbRow, organizationId: string): Promise<string | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const chargeClaimId = text(charge.claim_id);
  if (chargeClaimId) {
    const { data } = await supabase
      .from("professional_claims")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", chargeClaimId)
      .neq("claim_status", "voided")
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const encounterId = text(charge.encounter_id);
  if (encounterId) {
    const { data } = await supabase
      .from("professional_claims")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .neq("claim_status", "voided")
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const appointmentId = text(charge.appointment_id);
  const clientId = text(charge.client_id);
  if (appointmentId && clientId) {
    const { data } = await supabase
      .from("professional_claims")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("appointment_id", appointmentId)
      .eq("patient_id", clientId)
      .neq("claim_status", "voided")
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  return null;
}

export async function createClaimDraftFromChargeCapture(
  input: CreateClaimFromChargeCaptureInput,
): Promise<CreateClaimFromChargeCaptureResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, claimId: null, errors: [{ field: "system", message: "Database connection not available" }] };
  }

  const { data: charge, error: chargeError } = await supabase
    .from("charge_capture_items")
    .select("id, organization_id, encounter_id, client_id, provider_id, appointment_id, insurance_policy_id, charge_status, service_date, diagnosis_codes, service_lines, place_of_service, claim_id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.chargeCaptureId)
    .is("archived_at", null)
    .maybeSingle();

  if (chargeError || !charge) {
    return { ok: false, claimId: null, errors: [{ field: "charge_capture_items", message: "Charge capture item not found" }] };
  }

  const statusText = text(charge.charge_status);
  if (statusText !== "ready_for_claim" && statusText !== "claim_created") {
    return { ok: false, claimId: null, errors: [{ field: "charge_status", message: "Charge capture item is not ready for claim creation" }] };
  }

  const existingClaimId = await findExistingClaimForCharge(charge as DbRow, input.organizationId);
  if (existingClaimId) {
    await linkChargeToClaim({
      organizationId: input.organizationId,
      chargeCaptureId: input.chargeCaptureId,
      claimId: existingClaimId,
      encounterId: text(charge.encounter_id) || null,
    });
    const readiness = await validateProfessionalClaimReadiness(existingClaimId, input.organizationId);
    return { ok: readiness.ok, claimId: existingClaimId, errors: readiness.errors };
  }

  if (statusText === "claim_created") {
    return { ok: false, claimId: null, errors: [{ field: "claim_id", message: "Charge capture item is marked claim_created but no linked claim was found" }] };
  }

  const providerResolution = await resolveProviderCredentialingProfile({
    organizationId: input.organizationId,
    providerId: charge.provider_id ? String(charge.provider_id) : null,
  });

  if (!providerResolution.ok || !providerResolution.billingProvider) {
    return { ok: false, claimId: null, errors: providerResolution.errors };
  }

  const draft = await createProfessionalClaimDraft({
    organizationId: input.organizationId,
    clientId: String(charge.client_id),
    policyId: charge.insurance_policy_id ? String(charge.insurance_policy_id) : null,
    appointmentId: charge.appointment_id ? String(charge.appointment_id) : null,
    encounterId: charge.encounter_id ? String(charge.encounter_id) : null,
    placeOfService: text(charge.place_of_service) || null,
    diagnosisCodes: readTextArray(charge.diagnosis_codes),
    serviceLines: serviceLinesFromCharge(charge as DbRow, providerResolution.renderingProviderNpi),
    billingProvider: providerResolution.billingProvider,
    patientAccountNumber: charge.encounter_id ? `ENC-${String(charge.encounter_id).slice(0, 8)}` : null,
    claimNumber: `CLM-${String(charge.id).slice(0, 8)}`,
  });

  if (!draft.claimId) return draft;

  await linkChargeToClaim({
    organizationId: input.organizationId,
    chargeCaptureId: input.chargeCaptureId,
    claimId: draft.claimId,
    encounterId: charge.encounter_id ? String(charge.encounter_id) : null,
  });

  if (!draft.ok) return draft;

  const readiness = await validateProfessionalClaimReadiness(draft.claimId, input.organizationId);

  if (readiness.ok) {
    const autoBatch = await assignClaimToAutoBatch({
      organizationId: input.organizationId,
      claimId: draft.claimId,
    });
    if (!autoBatch.ok) {
      return {
        ok: false,
        claimId: draft.claimId,
        errors: [
          ...readiness.errors,
          {
            field: "auto_batch",
            message: autoBatch.error ?? "Claim was validated but auto-batching failed",
          },
        ],
      };
    }
  }

  return { ok: readiness.ok, claimId: draft.claimId, errors: readiness.errors };
}
