import {
  createProfessionalClaimDraft,
  type BillingProviderInput,
  type ClaimServiceLineInput,
} from "@/lib/claims/claimReadinessService";
import { resolveProviderCredentialingProfile } from "@/lib/providers/providerCredentialingResolverService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;
type ClaimReadinessError = { field: string; message: string };

const CLAIM_OVERWRITE_GUARD_STATUSES = new Set([
  "batched",
  "submitted",
  "accepted_oa",
  "accepted_payer",
  "rejected_oa",
  "rejected_payer",
  "paid",
  "denied",
]);

const CLAIM_PRE_SUBMISSION_STATUSES = new Set([
  "draft",
  "ready_for_validation",
  "validation_failed",
  "ready_for_batch",
]);

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

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText.length > 0 ? valueText : null;
}

function normalizeDate(value: unknown): string | null {
  const valueText = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
  return valueText;
}

function firstDbText(row: DbRow | null | undefined, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

function fallbackBillingProvider(): BillingProviderInput {
  return {
    name: "Needs billing provider review",
    npi: "0000000000",
    taxId: "000000000",
    taxIdType: "EI",
    address1: "Needs billing provider address",
    address2: null,
    city: "Needs review",
    state: "CO",
    zip: "00000",
  };
}

function serviceLinesFromCharge(
  charge: DbRow,
  renderingProviderNpi: string | null,
  providerCredentialingProfileId: string | null,
): ClaimServiceLineInput[] {
  return readArray(charge.service_lines)
    .map((line) => ({
      serviceDate: text(line.serviceDate) || text(charge.service_date),
      procedureCode: text(line.procedureCode),
      modifiers: readTextArray(line.modifiers),
      units: Number(line.units ?? 1) || 1,
      chargeAmount: money(line.chargeAmount),
      diagnosisPointers: ["1"],
      placeOfService: text(line.placeOfService) || text(charge.place_of_service) || null,
      renderingProviderNpi: text(line.renderingProviderNpi) || renderingProviderNpi,
      authorizationNumber: text(line.authorizationNumber) || null,
      providerCredentialingProfileId:
        text(line.providerCredentialingProfileId) ||
        text(line.provider_credentialing_profile_id) ||
        text(charge.provider_credentialing_profile_id) ||
        providerCredentialingProfileId,
    }))
    .filter((line) => line.procedureCode && line.chargeAmount > 0 && line.serviceDate);
}

async function linkChargeToClaim(params: {
  organizationId: string;
  chargeCaptureId: string;
  claimId: string;
  encounterId?: string | null;
  caseId?: string | null;
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

  if (params.encounterId || params.caseId) {
    const { error: claimLinkError } = await supabase
      .from("professional_claims")
      .update({
        encounter_id: params.encounterId ?? undefined,
        case_id: params.caseId ?? undefined,
        updated_at: now,
      })
      .eq("organization_id", params.organizationId)
      .eq("id", params.claimId);

    if (claimLinkError) throw new Error(claimLinkError.message);
  }
}

async function setClaimStatus(params: {
  organizationId: string;
  claimId: string;
  status: "draft" | "validation_failed";
  errors?: ClaimReadinessError[];
}) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const now = new Date().toISOString();
  const errors = params.errors ?? [];

  const { error } = await supabase
    .from("professional_claims")
    .update({
      claim_status: params.status,
      validation_errors: errors,
      last_validated_at: params.status === "validation_failed" ? now : null,
      updated_at: now,
    })
    .eq("organization_id", params.organizationId)
    .eq("id", params.claimId);

  if (error) throw new Error(error.message);
}

async function resolvePolicySnapshot(params: {
  organizationId: string;
  clientId: string;
  policyId?: string | null;
}): Promise<{
  client: DbRow | null;
  policy: DbRow | null;
  payer: DbRow | null;
  subscriber: DbRow | null;
  errors: ClaimReadinessError[];
}> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      client: null,
      policy: null,
      payer: null,
      subscriber: null,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const errors: ClaimReadinessError[] = [];

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, organization_id, first_name, last_name, date_of_birth, sex_at_birth, address_line_1, city, state, postal_code")
    .eq("id", params.clientId)
    .eq("organization_id", params.organizationId)
    .is("archived_at", null)
    .maybeSingle();

  if (clientError || !client) {
    errors.push({ field: "client", message: "Client not found" });
  }

  let policyQuery = supabase
    .from("insurance_policies")
    .select("id, payer_id, subscriber_id, plan_name, policy_number, priority, active_flag, subscriber_relationship")
    .eq("organization_id", params.organizationId)
    .eq("client_id", params.clientId)
    .eq("active_flag", true)
    .is("archived_at", null)
    .limit(1);

  if (params.policyId) {
    policyQuery = policyQuery.eq("id", params.policyId);
  } else {
    policyQuery = policyQuery.eq("priority", "primary");
  }

  const { data: policy, error: policyError } = await policyQuery.maybeSingle();

  if (policyError || !policy) {
    errors.push({
      field: "insurance_policy",
      message: "No active primary insurance policy found for this client",
    });

    return {
      client: (client as DbRow | null) ?? null,
      policy: null,
      payer: null,
      subscriber: null,
      errors,
    };
  }

  const { data: payer } = await supabase
    .from("insurance_payers")
    .select("id, payer_name, payer_id")
    .eq("id", (policy as DbRow).payer_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!payer) {
    errors.push({ field: "payer", message: "Insurance policy has no usable payer record" });
  }

  const { data: subscriber } = await supabase
    .from("insurance_subscribers")
    .select("*")
    .eq("id", (policy as DbRow).subscriber_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!subscriber) {
    errors.push({ field: "subscriber", message: "Insurance policy has no usable subscriber record" });
  }

  if (payer && !text((payer as DbRow).payer_id)) {
    errors.push({ field: "payer.payer_id", message: "Payer is missing clearinghouse payer ID" });
  }

  if (subscriber && !text((subscriber as DbRow).member_id)) {
    errors.push({ field: "subscriber.member_id", message: "Subscriber is missing member ID" });
  }

  return {
    client: (client as DbRow | null) ?? null,
    policy: (policy as DbRow | null) ?? null,
    payer: (payer as DbRow | null) ?? null,
    subscriber: (subscriber as DbRow | null) ?? null,
    errors,
  };
}

async function ensurePayerProfile(params: {
  organizationId: string;
  payerName: string;
  availityPayerId: string;
}): Promise<string | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  if (!params.payerName || !params.availityPayerId) return null;

  const { data: existing } = await supabase
    .from("payer_profiles")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("availity_payer_id", params.availityPayerId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return String(existing.id);

  const { data: inserted, error } = await supabase
    .from("payer_profiles")
    .insert({
      organization_id: params.organizationId,
      payer_name: params.payerName,
      availity_payer_id: params.availityPayerId,
      payer_type: "commercial",
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !inserted) return null;
  return String(inserted.id);
}

async function renderingProviderTaxonomy(params: {
  organizationId: string;
  appointmentId?: string | null;
}) {
  if (!params.appointmentId) return null;

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, provider_id")
    .eq("organization_id", params.organizationId)
    .eq("id", params.appointmentId)
    .maybeSingle();

  const renderingProviderId = appointment ? nullableText((appointment as DbRow).provider_id) : null;
  if (!renderingProviderId) return null;

  const { data: profileByStaff } = await supabase
    .from("provider_profiles")
    .select("*")
    .eq("organization_id", params.organizationId)
    .eq("staff_id", renderingProviderId)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  let profile = profileByStaff as DbRow | null;

  if (!profile) {
    const { data: profileById } = await supabase
      .from("provider_profiles")
      .select("*")
      .eq("organization_id", params.organizationId)
      .eq("id", renderingProviderId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    profile = (profileById as DbRow | null) ?? null;
  }

  return profile
    ? nullableText(profile.taxonomy_code) ??
        nullableText(profile.taxonomy) ??
        nullableText(profile.provider_taxonomy_code)
    : null;
}

function snapshotPayload(params: {
  claimId: string;
  billingProvider: BillingProviderInput;
  client: DbRow;
  payer: DbRow;
  policy: DbRow;
  subscriber: DbRow;
  renderingProviderTaxonomy: string | null;
}) {
  const subscriberRelationship =
    text(params.subscriber.relationship_to_client) ||
    text(params.policy.subscriber_relationship) ||
    "self";

  const subscriberIsClient = ["self", "client", "patient", "insured"].includes(
    subscriberRelationship.toLowerCase(),
  );

  const subscriberAddress1 =
    firstDbText(params.subscriber, [
      "address_line1",
      "address_line_1",
      "address1",
      "street",
      "subscriber_address1",
    ]) || (subscriberIsClient ? text(params.client.address_line_1) : "");

  const subscriberCity =
    firstDbText(params.subscriber, ["address_city", "city", "subscriber_city"]) ||
    (subscriberIsClient ? text(params.client.city) : "");

  const subscriberState = (
    firstDbText(params.subscriber, ["address_state", "state", "subscriber_state"]) ||
    (subscriberIsClient ? text(params.client.state) : "")
  ).toUpperCase();

  const subscriberZip =
    firstDbText(params.subscriber, ["address_zip", "zip", "postal_code", "subscriber_zip"]) ||
    (subscriberIsClient ? text(params.client.postal_code) : "");

  return {
    claim_id: params.claimId,

    billing_provider_name: params.billingProvider.name,
    billing_provider_npi: params.billingProvider.npi,
    billing_provider_tax_id: params.billingProvider.taxId,
    billing_provider_tax_id_type: params.billingProvider.taxIdType ?? "EI",
    billing_provider_address1: params.billingProvider.address1,
    billing_provider_address2: nullableText(params.billingProvider.address2),
    billing_provider_city: params.billingProvider.city,
    billing_provider_state: params.billingProvider.state,
    billing_provider_zip: params.billingProvider.zip,

    subscriber_last_name: text(params.subscriber.last_name),
    subscriber_first_name: text(params.subscriber.first_name),
    subscriber_member_id: text(params.subscriber.member_id),
    subscriber_dob: normalizeDate(params.subscriber.date_of_birth),
    subscriber_gender: "U",
    subscriber_address1: subscriberAddress1,
    subscriber_city: subscriberCity,
    subscriber_state: subscriberState,
    subscriber_zip: subscriberZip,

    patient_is_subscriber: subscriberIsClient,
    patient_last_name: subscriberIsClient ? null : text(params.client.last_name),
    patient_first_name: subscriberIsClient ? null : text(params.client.first_name),
    patient_dob: subscriberIsClient ? null : normalizeDate(params.client.date_of_birth),
    patient_gender: subscriberIsClient ? null : "U",
    patient_address1: subscriberIsClient ? null : text(params.client.address_line_1),
    patient_city: subscriberIsClient ? null : text(params.client.city),
    patient_state: subscriberIsClient ? null : text(params.client.state).toUpperCase(),
    patient_zip: subscriberIsClient ? null : text(params.client.postal_code),

    payer_name: text(params.payer.payer_name),
    payer_id: text(params.payer.payer_id),

    rendering_same_as_billing: true,
    rendering_provider_taxonomy: params.renderingProviderTaxonomy,
    service_facility_same_as_billing: true,
    updated_at: new Date().toISOString(),
  };
}

function serviceLinePayloadFromCharge(params: {
  claimId: string;
  serviceLines: ClaimServiceLineInput[];
  placeOfService: string;
  providerCredentialingProfileId?: string | null;
}) {
  return params.serviceLines.map((line, index) => ({
    claim_id: params.claimId,
    line_number: index + 1,
    service_date_from: line.serviceDate,
    service_date_to: line.serviceDate,
    procedure_code: text(line.procedureCode),
    modifiers: line.modifiers ?? [],
    charge_amount: money(line.chargeAmount),
    units: line.units ?? 1,
    diagnosis_pointers: line.diagnosisPointers ?? ["1"],
    place_of_service: nullableText(line.placeOfService) ?? params.placeOfService,
    rendering_provider_npi: nullableText(line.renderingProviderNpi),
    authorization_number: nullableText(line.authorizationNumber),
    provider_credentialing_profile_id:
      nullableText(line.providerCredentialingProfileId) ??
      nullableText(params.providerCredentialingProfileId),
    updated_at: new Date().toISOString(),
  }));
}

async function syncExistingClaimFromCharge(params: {
  organizationId: string;
  charge: DbRow;
  claimId: string;
}): Promise<CreateClaimFromChargeCaptureResult | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      claimId: params.claimId,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const { data: claim, error: claimError } = await supabase
    .from("professional_claims")
    .select("id, claim_status")
    .eq("organization_id", params.organizationId)
    .eq("id", params.claimId)
    .maybeSingle();

  if (claimError || !claim) {
    return {
      ok: false,
      claimId: params.claimId,
      errors: [{ field: "claim_id", message: "Existing professional claim was not found" }],
    };
  }

  const claimStatus = text((claim as DbRow).claim_status) || "draft";

  if (CLAIM_OVERWRITE_GUARD_STATUSES.has(claimStatus) || !CLAIM_PRE_SUBMISSION_STATUSES.has(claimStatus)) {
    return {
      ok: false,
      claimId: params.claimId,
      errors: [
        {
          field: "claim_status",
          message: `Claim ${params.claimId} is ${claimStatus}; signed-note charge changes require an amendment/correction flow instead of overwriting this claim.`,
        },
      ],
    };
  }

  const providerResolution = await resolveProviderCredentialingProfile({
    organizationId: params.organizationId,
    providerId: params.charge.provider_id ? String(params.charge.provider_id) : null,
    providerCredentialingProfileId: params.charge.provider_credentialing_profile_id
      ? String(params.charge.provider_credentialing_profile_id)
      : null,
  });

  const providerErrors =
    !providerResolution.ok || !providerResolution.billingProvider
      ? providerResolution.errors
      : [];

  const billingProvider: BillingProviderInput =
    providerResolution.billingProvider ?? fallbackBillingProvider();

  const policyResolution = await resolvePolicySnapshot({
    organizationId: params.organizationId,
    clientId: String(params.charge.client_id),
    policyId: params.charge.insurance_policy_id
      ? String(params.charge.insurance_policy_id)
      : null,
  });

  const policyErrors = policyResolution.errors;

  const payerProfileId =
    policyResolution.payer
      ? await ensurePayerProfile({
          organizationId: params.organizationId,
          payerName: text(policyResolution.payer.payer_name),
          availityPayerId: text(policyResolution.payer.payer_id),
        })
      : null;

  const serviceLines = serviceLinesFromCharge(
    params.charge,
    providerResolution.renderingProviderNpi,
    providerResolution.providerCredentialingProfileId,
  );

  const placeOfService =
    nullableText(params.charge.place_of_service) ??
    nullableText(serviceLines[0]?.placeOfService) ??
    "11";

  const totalCharge = money(
    serviceLines.reduce((sum, line) => sum + line.chargeAmount * (line.units ?? 1), 0),
  );

  const diagnosisCodes = readTextArray(params.charge.diagnosis_codes);
  const now = new Date().toISOString();
  const combinedErrors = [...providerErrors, ...policyErrors];

  const { error: claimUpdateError } = await supabase
    .from("professional_claims")
    .update({
      patient_id: params.charge.client_id,
      appointment_id: nullableText(params.charge.appointment_id) ?? undefined,
      encounter_id: nullableText(params.charge.encounter_id) ?? undefined,
      case_id: nullableText(params.charge.case_id) ?? undefined,
      payer_profile_id: payerProfileId,
      provider_credentialing_profile_id: nullableText(params.charge.provider_credentialing_profile_id),
      total_charge: totalCharge,
      place_of_service: placeOfService,
      diagnosis_codes: diagnosisCodes,
      claim_status: combinedErrors.length ? "validation_failed" : "draft",
      validation_errors: combinedErrors,
      last_validated_at: combinedErrors.length ? now : null,
      updated_at: now,
    })
    .eq("organization_id", params.organizationId)
    .eq("id", params.claimId);

  if (claimUpdateError) {
    return {
      ok: false,
      claimId: params.claimId,
      errors: [{ field: "professional_claims", message: claimUpdateError.message }],
    };
  }

  const { error: deleteLinesError } = await supabase
    .from("professional_claim_service_lines")
    .delete()
    .eq("claim_id", params.claimId);

  if (deleteLinesError) {
    return {
      ok: false,
      claimId: params.claimId,
      errors: [{ field: "professional_claim_service_lines", message: deleteLinesError.message }],
    };
  }

  const linePayload = serviceLinePayloadFromCharge({
    claimId: params.claimId,
    serviceLines,
    placeOfService,
    providerCredentialingProfileId:
      nullableText(params.charge.provider_credentialing_profile_id) ??
      providerResolution.providerCredentialingProfileId,
  });

  if (linePayload.length > 0) {
    const { error: insertLinesError } = await supabase
      .from("professional_claim_service_lines")
      .insert(linePayload);

    if (insertLinesError) {
      return {
        ok: false,
        claimId: params.claimId,
        errors: [
          {
            field: "professional_claim_service_lines",
            message: insertLinesError.message,
          },
        ],
      };
    }
  }

  if (
    policyResolution.client &&
    policyResolution.policy &&
    policyResolution.payer &&
    policyResolution.subscriber
  ) {
    const taxonomy = await renderingProviderTaxonomy({
      organizationId: params.organizationId,
      appointmentId: nullableText(params.charge.appointment_id),
    });

    const snapshot = snapshotPayload({
      claimId: params.claimId,
      billingProvider,
      client: policyResolution.client,
      policy: policyResolution.policy,
      payer: policyResolution.payer,
      subscriber: policyResolution.subscriber,
      renderingProviderTaxonomy: taxonomy,
    });

    const { error: deleteSnapshotError } = await supabase
      .from("claim_parties_snapshot")
      .delete()
      .eq("claim_id", params.claimId);

    if (deleteSnapshotError) {
      return {
        ok: false,
        claimId: params.claimId,
        errors: [{ field: "claim_parties_snapshot", message: deleteSnapshotError.message }],
      };
    }

    const { error: insertSnapshotError } = await supabase
      .from("claim_parties_snapshot")
      .insert(snapshot);

    if (insertSnapshotError) {
      return {
        ok: false,
        claimId: params.claimId,
        errors: [{ field: "claim_parties_snapshot", message: insertSnapshotError.message }],
      };
    }
  }

  return combinedErrors.length
    ? { ok: false, claimId: params.claimId, errors: combinedErrors }
    : null;
}

async function findExistingClaimForCharge(
  charge: DbRow,
  organizationId: string,
): Promise<string | null> {
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
    return {
      ok: false,
      claimId: null,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const { data: charge, error: chargeError } = await supabase
    .from("charge_capture_items")
    .select(
      "id, organization_id, encounter_id, client_id, provider_id, provider_credentialing_profile_id, appointment_id, insurance_policy_id, case_id, charge_status, service_date, diagnosis_codes, service_lines, place_of_service, total_charge, claim_id",
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.chargeCaptureId)
    .is("archived_at", null)
    .maybeSingle();

  if (chargeError || !charge) {
    return {
      ok: false,
      claimId: null,
      errors: [{ field: "charge_capture_items", message: "Charge capture item not found" }],
    };
  }

  const statusText = text(charge.charge_status);
  if (statusText !== "ready_for_claim" && statusText !== "claim_created") {
    return {
      ok: false,
      claimId: null,
      errors: [
        {
          field: "charge_status",
          message: "Charge capture item is not ready for claim creation",
        },
      ],
    };
  }

  const existingClaimId = await findExistingClaimForCharge(
    charge as DbRow,
    input.organizationId,
  );

  if (existingClaimId) {
    const syncResult = await syncExistingClaimFromCharge({
      organizationId: input.organizationId,
      charge: charge as DbRow,
      claimId: existingClaimId,
    });

    await linkChargeToClaim({
      organizationId: input.organizationId,
      chargeCaptureId: input.chargeCaptureId,
      claimId: existingClaimId,
      encounterId: text(charge.encounter_id) || null,
      caseId: text((charge as DbRow).case_id) || null,
    });

    if (syncResult) return syncResult;

    return { ok: true, claimId: existingClaimId, errors: [] };
  }

  const providerResolution = await resolveProviderCredentialingProfile({
    organizationId: input.organizationId,
    providerId: charge.provider_id ? String(charge.provider_id) : null,
    providerCredentialingProfileId: charge.provider_credentialing_profile_id
      ? String(charge.provider_credentialing_profile_id)
      : null,
  });

  const providerErrors =
    !providerResolution.ok || !providerResolution.billingProvider
      ? providerResolution.errors
      : [];

  const billingProvider: BillingProviderInput =
    providerResolution.billingProvider ?? fallbackBillingProvider();

  const draft = await createProfessionalClaimDraft({
  organizationId: input.organizationId,
  clientId: String(charge.client_id),
  policyId: charge.insurance_policy_id ? String(charge.insurance_policy_id) : null,
  appointmentId: charge.appointment_id ? String(charge.appointment_id) : null,
  encounterId: charge.encounter_id ? String(charge.encounter_id) : null,
  placeOfService: text(charge.place_of_service) || null,
  billingProvider,
  providerCredentialingProfileId:
    nullableText((charge as DbRow).provider_credentialing_profile_id) ??
    providerResolution.providerCredentialingProfileId,
  diagnosisCodes: readTextArray(charge.diagnosis_codes),
  serviceLines: serviceLinesFromCharge(
    charge as DbRow,
    providerResolution.renderingProviderNpi,
    providerResolution.providerCredentialingProfileId,
  ),
  patientAccountNumber: charge.encounter_id
    ? `ENC-${String(charge.encounter_id).slice(0, 8)}`
    : null,
  claimNumber: `CLM-${String(charge.id).slice(0, 8)}`,
});

  if (!draft.claimId) {
    return {
      ok: false,
      claimId: null,
      errors: [...providerErrors, ...(draft.errors ?? [])],
    };
  }

  await linkChargeToClaim({
    organizationId: input.organizationId,
    chargeCaptureId: input.chargeCaptureId,
    claimId: draft.claimId,
    encounterId: charge.encounter_id ? String(charge.encounter_id) : null,
    caseId: text((charge as DbRow).case_id) || null,
  });

  const combinedErrors = [...providerErrors, ...(draft.errors ?? [])];

  await setClaimStatus({
    organizationId: input.organizationId,
    claimId: draft.claimId,
    status: combinedErrors.length ? "validation_failed" : "draft",
    errors: combinedErrors,
  });

  return combinedErrors.length
    ? { ok: false, claimId: draft.claimId, errors: combinedErrors }
    : { ok: true, claimId: draft.claimId, errors: [] };
}