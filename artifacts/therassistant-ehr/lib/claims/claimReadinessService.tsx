import { DEFAULT_OFFICE_PLACE_OF_SERVICE, isAllowedPlaceOfService, normalizePlaceOfService } from "@/lib/billing/placeOfService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type ClaimReadinessStatus = "ready" | "not_ready";

interface ClaimReadinessError {
  field: string;
  message: string;
}

export interface BillingProviderInput {
  name: string;
  npi: string;
  taxId: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  address2?: string | null;
  taxIdType?: "EI" | "SY";
  phone?: string | null;
}

export interface ClaimServiceLineInput {
  serviceDate: string;
  procedureCode: string;
  chargeAmount: number;
  units?: number;
  modifiers?: string[];
  diagnosisPointers?: string[];
  placeOfService?: string | null;
  renderingProviderNpi?: string | null;
  authorizationNumber?: string | null;
  providerCredentialingProfileId?: string | null;
}

export interface CreateClaimDraftInput {
  organizationId: string;
  clientId: string;
  policyId?: string | null;
  caseId?: string | null;
  appointmentId?: string | null;
  encounterId?: string | null;
  placeOfService?: string | null;
  diagnosisCodes: string[];
  serviceLines: ClaimServiceLineInput[];
  billingProvider: BillingProviderInput;
  providerCredentialingProfileId?: string | null;
  patientAccountNumber?: string | null;
  claimNumber?: string | null;
}

export interface CreateClaimDraftResult {
  ok: boolean;
  claimId: string | null;
  errors: ClaimReadinessError[];
}

export interface ClaimReadinessResult {
  ok: boolean;
  status: ClaimReadinessStatus;
  claimId: string;
  errors: ClaimReadinessError[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRecord = Record<string, any>;

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeNullable(value: unknown): string | null {
  const valueText = normalizeText(value);
  return valueText.length > 0 ? valueText : null;
}

function normalizeDate(value: unknown): string | null {
  const valueText = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
  return valueText;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function addRequired(errors: ClaimReadinessError[], field: string, value: unknown, message: string) {
  if (!normalizeText(value)) {
    errors.push({ field, message });
  }
}

function firstDbText(row: DbRecord | null | undefined, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = normalizeText(row[key]);
    if (value) return value;
  }
  return "";
}

async function cleanupPartialClaimDraft(supabase: ReturnType<typeof createServerSupabaseAdminClient>, claimId: string) {
  if (!supabase) return;
  await supabase.from("claim_parties_snapshot").delete().eq("claim_id", claimId);
  await supabase.from("professional_claim_service_lines").delete().eq("claim_id", claimId);
  await supabase.from("professional_claims").delete().eq("id", claimId);
}

function addPlaceOfServiceError(errors: ClaimReadinessError[], field: string, value: unknown) {
  const pos = normalizePlaceOfService(value);
  if (!pos) return;
  if (!isAllowedPlaceOfService(pos)) {
    errors.push({
      field,
      message: pos === "10"
        ? "POS 10 is not allowed. Use 11 (office) or 02 (telehealth)."
        : `POS ${pos} is not allowed. Use 11 (office) or 02 (telehealth).`,
    });
  }
}

async function resolvePrimaryPolicy(params: {
  organizationId: string;
  clientId: string;
  policyId?: string | null;
  caseId?: string | null;
}): Promise<{ policy: DbRecord | null; payer: DbRecord | null; subscriber: DbRecord | null; errors: ClaimReadinessError[] }> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      policy: null,
      payer: null,
      subscriber: null,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const errors: ClaimReadinessError[] = [];
  let resolvedPolicyId = normalizeNullable(params.policyId);

  if (!resolvedPolicyId && params.caseId) {
    const { data: casePolicy, error: casePolicyError } = await supabase
      .from("client_case_policies")
      .select("policy_id")
      .eq("organization_id", params.organizationId)
      .eq("case_id", params.caseId)
      .eq("priority", "primary")
      .limit(1)
      .maybeSingle();

    if (!casePolicyError && casePolicy?.policy_id) {
      resolvedPolicyId = String(casePolicy.policy_id);
    }
  }

  let policyQuery = supabase
    .from("insurance_policies")
    .select("id, payer_id, subscriber_id, plan_name, policy_number, group_number, priority, active_flag, subscriber_relationship")
    .eq("organization_id", params.organizationId)
    .eq("client_id", params.clientId)
    .eq("active_flag", true)
    .is("archived_at", null)
    .limit(1);

  if (resolvedPolicyId) {
    policyQuery = policyQuery.eq("id", resolvedPolicyId);
  } else {
    policyQuery = policyQuery.eq("priority", "primary");
  }

  const { data: policy, error: policyError } = await policyQuery.maybeSingle();

  if (policyError || !policy) {
    errors.push({
      field: params.caseId ? "client_case_policies.policy_id" : "insurance_policy",
      message: params.caseId
        ? "Client case has no active primary insurance policy linked"
        : "No active primary insurance policy found for this client",
    });
    return { policy: null, payer: null, subscriber: null, errors };
  }

  const { data: payer } = await supabase
    .from("insurance_payers")
    .select("id, payer_name, payer_id")
    .eq("id", policy.payer_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!payer) {
    errors.push({ field: "payer", message: "Insurance policy has no usable payer record" });
  }

  const { data: subscriber } = await supabase
    .from("insurance_subscribers")
    .select("*")
    .eq("id", policy.subscriber_id)
    .is("archived_at", null)
    .maybeSingle();

  if (!subscriber) {
    errors.push({ field: "subscriber", message: "Insurance policy has no usable subscriber record" });
  }

  return { policy, payer: payer ?? null, subscriber: subscriber ?? null, errors };
}

async function ensurePayerProfile(params: {
  organizationId: string;
  payerName: string;
  availityPayerId: string;
}): Promise<string | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

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

function normalizeGender(value: unknown) {
  const raw = normalizeText(value).toUpperCase();
  if (["M", "MALE"].includes(raw)) return "M";
  if (["F", "FEMALE"].includes(raw)) return "F";
  return "U";
}

export async function createProfessionalClaimDraft(
  input: CreateClaimDraftInput
): Promise<CreateClaimDraftResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, claimId: null, errors: [{ field: "system", message: "Database connection not available" }] };
  }

  const errors: ClaimReadinessError[] = [];
  addRequired(errors, "organization_id", input.organizationId, "Organization is required");
  addRequired(errors, "client_id", input.clientId, "Client is required");
  addRequired(errors, "billing_provider.name", input.billingProvider.name, "Billing provider name is required");
  addRequired(errors, "billing_provider.npi", input.billingProvider.npi, "Billing provider NPI is required");
  addRequired(errors, "billing_provider.tax_id", input.billingProvider.taxId, "Billing provider tax ID is required");
  addRequired(errors, "billing_provider.address1", input.billingProvider.address1, "Billing provider address is required");
  addRequired(errors, "billing_provider.city", input.billingProvider.city, "Billing provider city is required. Populate provider_credentialing_profiles.practice_address city or the default service_locations.address_city before claim creation.");
  addRequired(errors, "billing_provider.state", input.billingProvider.state, "Billing provider state is required");
  addRequired(errors, "billing_provider.zip", input.billingProvider.zip, "Billing provider ZIP is required");

  const npiVal = normalizeText(input.billingProvider.npi);
  if (npiVal && !/^\d{10}$/.test(npiVal)) {
    errors.push({ field: "billing_provider.npi", message: "Billing provider NPI must be exactly 10 digits" });
  }
  const stateVal = normalizeText(input.billingProvider.state);
  if (stateVal && !/^[A-Z]{2}$/.test(stateVal)) {
    errors.push({ field: "billing_provider.state", message: "Billing provider state must be a valid 2-character state code (e.g. CA, NY)" });
  }
  const zipVal = normalizeText(input.billingProvider.zip);
  if (zipVal && !/^\d{5}(?:-\d{4})?$/.test(zipVal)) {
    errors.push({ field: "billing_provider.zip", message: "Billing provider ZIP must be 5 or 9 digits (e.g. 12345 or 12345-6789)" });
  }

  addPlaceOfServiceError(errors, "place_of_service", input.placeOfService);
  if (input.billingProvider.address1 && /^p\.?\s*o\.?\s*box/i.test(normalizeText(input.billingProvider.address1))) {
    errors.push({ field: "billing_provider.address1", message: "Billing provider address must be a street address, not a PO Box" });
  }

  if (!input.diagnosisCodes.length) {
    errors.push({ field: "diagnosis_codes", message: "At least one diagnosis code is required" });
  }

  if (!input.serviceLines.length) {
    errors.push({ field: "service_lines", message: "At least one service line is required" });
  }

  for (const [index, line] of input.serviceLines.entries()) {
    if (!normalizeDate(line.serviceDate)) {
      errors.push({ field: `service_lines.${index}.service_date`, message: "Service line has invalid service date" });
    }
    addRequired(errors, `service_lines.${index}.procedure_code`, line.procedureCode, "Procedure code is required");
    if (!Number.isFinite(line.chargeAmount) || line.chargeAmount <= 0) {
      errors.push({ field: `service_lines.${index}.charge_amount`, message: "Charge amount must be greater than zero" });
    }
  }

  const dxToCheck = [...new Set(input.diagnosisCodes.map((c) => normalizeText(c).toUpperCase()).filter(Boolean))];
  if (dxToCheck.length > 0) {
    const { data: dxRows } = await supabase
      .from("diagnosis_codes")
      .select("code")
      .eq("is_active", true)
      .in("code", dxToCheck);
    const known = new Set((dxRows ?? []).map((r: DbRecord) => String(r.code).toUpperCase()));
    for (const [index, raw] of input.diagnosisCodes.entries()) {
      const upper = normalizeText(raw).toUpperCase();
      if (upper && !known.has(upper)) {
        errors.push({ field: `diagnosis_codes.${index}`, message: `Unknown ICD-10 code: ${upper}` });
      }
    }
  }
  const procToCheck = [...new Set(input.serviceLines.map((l) => normalizeText(l.procedureCode).toUpperCase()).filter(Boolean))];
  if (procToCheck.length > 0) {
    const { data: pxRows } = await supabase
      .from("procedure_codes")
      .select("code")
      .eq("is_active", true)
      .in("code", procToCheck);
    const known = new Set((pxRows ?? []).map((r: DbRecord) => String(r.code).toUpperCase()));
    for (const [index, line] of input.serviceLines.entries()) {
      const upper = normalizeText(line.procedureCode).toUpperCase();
      if (upper && !known.has(upper)) {
        errors.push({ field: `service_lines.${index}.procedure_code`, message: `Unknown CPT/HCPCS code: ${upper}` });
      }
    }
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, organization_id, first_name, last_name, date_of_birth, sex_at_birth, address_line_1, address_line_2, city, state, postal_code")
    .eq("id", input.clientId)
    .eq("organization_id", input.organizationId)
    .is("archived_at", null)
    .maybeSingle();

  if (clientError || !client) {
    errors.push({ field: "client", message: "Client not found" });
  }

  const policyResolution = await resolvePrimaryPolicy({
    organizationId: input.organizationId,
    clientId: input.clientId,
    policyId: input.policyId,
    caseId: input.caseId,
  });
  errors.push(...policyResolution.errors);

  const payer = policyResolution.payer;
  const subscriber = policyResolution.subscriber;
  const policy = policyResolution.policy;

  if (payer && !normalizeText(payer.payer_id)) {
    errors.push({ field: "payer.payer_id", message: "Payer is missing clearinghouse payer ID" });
  }

  if (subscriber && !normalizeText(subscriber.member_id)) {
    errors.push({ field: "subscriber.member_id", message: "Subscriber is missing member ID" });
  }

  if (errors.length > 0) {
    return { ok: false, claimId: null, errors };
  }

  const payerProfileId = await ensurePayerProfile({
    organizationId: input.organizationId,
    payerName: normalizeText(payer!.payer_name),
    availityPayerId: normalizeText(payer!.payer_id),
  });

  const totalCharge = money(input.serviceLines.reduce((sum, line) => sum + line.chargeAmount * (line.units ?? 1), 0));
  const placeOfService = normalizeNullable(input.placeOfService) ?? DEFAULT_OFFICE_PLACE_OF_SERVICE;
  const patientAccountNumber = normalizeNullable(input.patientAccountNumber) ?? `PC-${Date.now()}`;
  const claimNumber = normalizeNullable(input.claimNumber) ?? `CLM-${Date.now()}`;

  const { data: claim, error: claimError } = await supabase
    .from("professional_claims")
    .insert({
      organization_id: input.organizationId,
      patient_id: input.clientId,
      client_id: input.clientId,
      appointment_id: input.appointmentId ?? undefined,
      encounter_id: input.encounterId ?? undefined,
      case_id: input.caseId ?? undefined,
      payer_profile_id: payerProfileId,
      provider_credentialing_profile_id: normalizeNullable(input.providerCredentialingProfileId),
      claim_number: claimNumber,
      patient_account_number: patientAccountNumber,
      claim_status: "draft",
      total_charge: totalCharge,
      place_of_service: placeOfService,
      diagnosis_codes: input.diagnosisCodes,
      accept_assignment: true,
      benefits_assignment: true,
      release_of_information: true,
      signature_on_file: true,
      validation_errors: [],
    })
    .select("id")
    .single();

  if (claimError || !claim) {
    return {
      ok: false,
      claimId: null,
      errors: [{ field: "professional_claims", message: claimError?.message ?? "Failed to create professional claim" }],
    };
  }

  const claimId = String(claim.id);
  const serviceLinePayload = input.serviceLines.map((line, index) => ({
    claim_id: claimId,
    line_number: index + 1,
    service_date_from: line.serviceDate,
    service_date_to: line.serviceDate,
    procedure_code: normalizeText(line.procedureCode),
    modifiers: line.modifiers ?? [],
    charge_amount: money(line.chargeAmount),
    units: line.units ?? 1,
    diagnosis_pointers: line.diagnosisPointers ?? ["1"],
    place_of_service: normalizeNullable(line.placeOfService) ?? placeOfService,
    rendering_provider_npi: normalizeNullable(line.renderingProviderNpi),
    authorization_number: normalizeNullable(line.authorizationNumber),
    provider_credentialing_profile_id:
      normalizeNullable(line.providerCredentialingProfileId) ??
      normalizeNullable(input.providerCredentialingProfileId),
  }));

  const { error: lineError } = await supabase.from("professional_claim_service_lines").insert(serviceLinePayload);
  if (lineError) {
    await cleanupPartialClaimDraft(supabase, claimId);
    return {
      ok: false,
      claimId: null,
      errors: [{ field: "professional_claim_service_lines", message: `${lineError.message}. Partial claim draft was rolled back.` }],
    };
  }

  const subscriberRelationship = normalizeText(policy?.subscriber_relationship) || normalizeText(subscriber!.relationship_to_client) || "self";
  const subscriberIsClient = ["self", "client", "patient", "insured"].includes(subscriberRelationship.toLowerCase());
  const subscriberAddress1 = firstDbText(subscriber, ["address_line_1", "address_line1", "address1", "street", "subscriber_address1"]) || (subscriberIsClient ? normalizeText(client!.address_line_1) : "");
  const subscriberAddress2 = firstDbText(subscriber, ["address_line_2", "address_line2", "address2", "subscriber_address2"]) || (subscriberIsClient ? normalizeText(client!.address_line_2) : "");
  const subscriberCity = firstDbText(subscriber, ["city", "address_city", "subscriber_city"]) || (subscriberIsClient ? normalizeText(client!.city) : "");
  const subscriberState = (firstDbText(subscriber, ["state", "address_state", "subscriber_state"]) || (subscriberIsClient ? normalizeText(client!.state) : "")).toUpperCase();
  const subscriberZip = firstDbText(subscriber, ["postal_code", "address_zip", "zip", "subscriber_zip"]) || (subscriberIsClient ? normalizeText(client!.postal_code) : "");

  const subscriberErrors: ClaimReadinessError[] = [];
  addRequired(subscriberErrors, "insurance_subscribers.first_name", subscriber!.first_name, "Subscriber first name is required");
  addRequired(subscriberErrors, "insurance_subscribers.last_name", subscriber!.last_name, "Subscriber last name is required");
  addRequired(subscriberErrors, "insurance_subscribers.date_of_birth", subscriber!.date_of_birth, "Subscriber DOB is required");
  addRequired(subscriberErrors, "insurance_subscribers.member_id", subscriber!.member_id, "Subscriber member ID is required");
  addRequired(subscriberErrors, "subscriber.address1", subscriberAddress1, subscriberIsClient ? "Subscriber address line 1 is required from clients.address_line_1" : "Subscriber address line 1 is required from insurance_subscribers address fields");
  addRequired(subscriberErrors, "subscriber.city", subscriberCity, subscriberIsClient ? "Subscriber city is required from clients.city" : "Subscriber city is required from insurance_subscribers city");
  addRequired(subscriberErrors, "subscriber.state", subscriberState, subscriberIsClient ? "Subscriber state is required from clients.state" : "Subscriber state is required from insurance_subscribers state");
  addRequired(subscriberErrors, "subscriber.zip", subscriberZip, subscriberIsClient ? "Subscriber ZIP is required from clients.postal_code" : "Subscriber ZIP is required from insurance_subscribers postal_code");
  if (subscriberErrors.length > 0) {
    await cleanupPartialClaimDraft(supabase, claimId);
    return { ok: false, claimId: null, errors: subscriberErrors };
  }

  let renderingProviderTaxonomy: string | null = null;
  const providerCredentialingProfileId = normalizeNullable(input.providerCredentialingProfileId);
  if (providerCredentialingProfileId) {
    const { data: credentialingProfile } = await supabase
      .from("provider_credentialing_profiles")
      .select("taxonomy_code")
      .eq("organization_id", input.organizationId)
      .eq("id", providerCredentialingProfileId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    renderingProviderTaxonomy = credentialingProfile
      ? normalizeNullable((credentialingProfile as DbRecord).taxonomy_code)
      : null;
  }

  const { error: snapshotError } = await supabase.from("claim_parties_snapshot").insert({
    claim_id: claimId,
    billing_provider_name: input.billingProvider.name,
    billing_provider_npi: input.billingProvider.npi,
    billing_provider_tax_id: input.billingProvider.taxId,
    billing_provider_tax_id_type: input.billingProvider.taxIdType ?? "EI",
    billing_provider_address1: input.billingProvider.address1,
    billing_provider_address2: normalizeNullable(input.billingProvider.address2),
    billing_provider_city: input.billingProvider.city,
    billing_provider_state: input.billingProvider.state,
    billing_provider_zip: input.billingProvider.zip,
    billing_provider_phone: normalizeNullable(input.billingProvider.phone),
    subscriber_last_name: normalizeText(subscriber!.last_name),
    subscriber_first_name: normalizeText(subscriber!.first_name),
    subscriber_member_id: normalizeText(subscriber!.member_id),
    subscriber_dob: normalizeDate(subscriber!.date_of_birth)!,
    subscriber_gender: "U",
    subscriber_address1: subscriberAddress1,
    subscriber_address2: subscriberAddress2 || null,
    subscriber_city: subscriberCity,
    subscriber_state: subscriberState,
    subscriber_zip: subscriberZip,
    patient_is_subscriber: subscriberIsClient,
    patient_relationship_to_insured: "self",
    patient_last_name: normalizeText(client!.last_name),
    patient_first_name: normalizeText(client!.first_name),
    patient_dob: normalizeDate(client!.date_of_birth),
    patient_gender: normalizeGender(client!.sex_at_birth),
    patient_address1: normalizeText(client!.address_line_1),
    patient_city: normalizeText(client!.city),
    patient_state: normalizeText(client!.state).toUpperCase(),
    patient_zip: normalizeText(client!.postal_code),
    payer_name: normalizeText(payer!.payer_name),
    payer_id: normalizeText(payer!.payer_id),
    insured_group_or_feca_number: normalizeNullable(policy?.group_number) ?? normalizeNullable(subscriber!.group_number),
    condition_employment_related: false,
    condition_auto_accident_related: false,
    condition_auto_accident_state: null,
    condition_other_accident_related: false,
    rendering_same_as_billing: false,
    rendering_provider_npi: normalizeNullable(input.serviceLines[0]?.renderingProviderNpi),
    rendering_provider_taxonomy: renderingProviderTaxonomy,
    service_facility_same_as_billing: true,
  });

  if (snapshotError) {
    await cleanupPartialClaimDraft(supabase, claimId);
    return {
      ok: false,
      claimId: null,
      errors: [{ field: "claim_parties_snapshot", message: `${snapshotError.message}. Partial claim draft was rolled back.` }],
    };
  }

  return { ok: true, claimId, errors: [] };
}

export async function validateProfessionalClaimReadiness(
  claimId: string,
  organizationId: string
): Promise<ClaimReadinessResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      status: "not_ready",
      claimId,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const errors: ClaimReadinessError[] = [];

  const { data: claim, error: claimError } = await supabase
    .from("professional_claims")
    .select("id, patient_id, payer_profile_id, claim_status, total_charge, place_of_service, diagnosis_codes")
    .eq("id", claimId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (claimError || !claim) {
    return {
      ok: false,
      status: "not_ready",
      claimId,
      errors: [{ field: "claim", message: "Professional claim not found" }],
    };
  }

  addRequired(errors, "claim.patient_id", claim.patient_id, "Claim is missing client/client link");
  addRequired(errors, "claim.place_of_service", claim.place_of_service, "Claim is missing place of service");

  if (!Array.isArray(claim.diagnosis_codes) || claim.diagnosis_codes.length === 0) {
    errors.push({ field: "claim.diagnosis_codes", message: "Claim requires at least one diagnosis code" });
  }

  if (!Number.isFinite(Number(claim.total_charge)) || Number(claim.total_charge) <= 0) {
    errors.push({ field: "claim.total_charge", message: "Claim total charge must be greater than zero" });
  }

  const { data: lines } = await supabase
    .from("professional_claim_service_lines")
    .select("id, line_number, service_date_from, procedure_code, charge_amount, units, diagnosis_pointers, place_of_service, rendering_provider_npi")
    .eq("claim_id", claimId)
    .order("line_number", { ascending: true });

  const dxOnClaim = Array.isArray(claim.diagnosis_codes)
    ? [...new Set((claim.diagnosis_codes as unknown[]).map((c) => normalizeText(c).toUpperCase()).filter(Boolean))]
    : [];
  if (dxOnClaim.length > 0) {
    const { data: dxRows } = await supabase
      .from("diagnosis_codes")
      .select("code")
      .eq("is_active", true)
      .in("code", dxOnClaim);
    const known = new Set((dxRows ?? []).map((r: DbRecord) => String(r.code).toUpperCase()));
    for (const code of dxOnClaim) {
      if (!known.has(code)) {
        errors.push({ field: "claim.diagnosis_codes", message: `Unknown ICD-10 code: ${code}` });
      }
    }
  }
  const procOnClaim = Array.isArray(lines)
    ? [...new Set((lines as DbRecord[]).map((l) => normalizeText(l.procedure_code).toUpperCase()).filter(Boolean))]
    : [];
  if (procOnClaim.length > 0) {
    const { data: pxRows } = await supabase
      .from("procedure_codes")
      .select("code")
      .eq("is_active", true)
      .in("code", procOnClaim);
    const known = new Set((pxRows ?? []).map((r: DbRecord) => String(r.code).toUpperCase()));
    for (const line of (lines ?? []) as DbRecord[]) {
      const code = normalizeText(line.procedure_code).toUpperCase();
      if (code && !known.has(code)) {
        errors.push({ field: `service_lines.${line.line_number}.procedure_code`, message: `Unknown CPT/HCPCS code: ${code}` });
      }
    }
  }

  if (!lines || lines.length === 0) {
    errors.push({ field: "service_lines", message: "Claim requires at least one service line" });
  } else {
    for (const line of lines as DbRecord[]) {
      addRequired(errors, `service_lines.${line.line_number}.service_date_from`, line.service_date_from, "Service date is required");
      addRequired(errors, `service_lines.${line.line_number}.procedure_code`, line.procedure_code, "Procedure code is required");
      if (!Number.isFinite(Number(line.charge_amount)) || Number(line.charge_amount) <= 0) {
        errors.push({ field: `service_lines.${line.line_number}.charge_amount`, message: "Service line charge must be greater than zero" });
      }
      if (!Number.isFinite(Number(line.units)) || Number(line.units) <= 0) {
        errors.push({ field: `service_lines.${line.line_number}.units`, message: "Service line units must be greater than zero" });
      }
      if (!Array.isArray(line.diagnosis_pointers) || line.diagnosis_pointers.length === 0) {
        errors.push({ field: `service_lines.${line.line_number}.diagnosis_pointers`, message: "Diagnosis pointer is required" });
      }
      addPlaceOfServiceError(errors, `service_lines.${line.line_number}.place_of_service`, line.place_of_service);
    }
  }

  const { data: snapshot } = await supabase
    .from("claim_parties_snapshot")
    .select("billing_provider_name, billing_provider_npi, billing_provider_tax_id, billing_provider_address1, billing_provider_city, billing_provider_state, billing_provider_zip, subscriber_first_name, subscriber_last_name, subscriber_member_id, subscriber_dob, subscriber_address1, subscriber_city, subscriber_state, subscriber_zip, patient_first_name, patient_last_name, patient_dob, patient_address1, patient_city, patient_state, patient_zip, payer_name, payer_id")
    .eq("claim_id", claimId)
    .maybeSingle();

  if (!snapshot) {
    errors.push({ field: "claim_parties_snapshot", message: "Claim party snapshot is missing" });
  } else {
    const requiredFields: Array<[string, unknown, string]> = [
      ["billing_provider_name", snapshot.billing_provider_name, "Billing provider name is required"],
      ["billing_provider_npi", snapshot.billing_provider_npi, "Billing provider NPI is required"],
      ["billing_provider_tax_id", snapshot.billing_provider_tax_id, "Billing provider tax ID is required"],
      ["billing_provider_address1", snapshot.billing_provider_address1, "Billing provider address is required"],
      ["billing_provider_city", snapshot.billing_provider_city, "Billing provider city is required"],
      ["billing_provider_state", snapshot.billing_provider_state, "Billing provider state is required"],
      ["billing_provider_zip", snapshot.billing_provider_zip, "Billing provider ZIP is required"],
      ["subscriber_first_name", snapshot.subscriber_first_name, "Subscriber first name is required"],
      ["subscriber_last_name", snapshot.subscriber_last_name, "Subscriber last name is required"],
      ["subscriber_member_id", snapshot.subscriber_member_id, "Subscriber member ID is required"],
      ["subscriber_dob", snapshot.subscriber_dob, "Subscriber DOB is required"],
      ["subscriber_address1", snapshot.subscriber_address1, "Subscriber address is required"],
      ["subscriber_city", snapshot.subscriber_city, "Subscriber city is required"],
      ["subscriber_state", snapshot.subscriber_state, "Subscriber state is required"],
      ["subscriber_zip", snapshot.subscriber_zip, "Subscriber ZIP is required"],
      ["patient_first_name", snapshot.patient_first_name, "Patient first name is required"],
      ["patient_last_name", snapshot.patient_last_name, "Patient last name is required"],
      ["patient_dob", snapshot.patient_dob, "Patient DOB is required"],
      ["patient_address1", snapshot.patient_address1, "Patient address is required"],
      ["patient_city", snapshot.patient_city, "Patient city is required"],
      ["patient_state", snapshot.patient_state, "Patient state is required"],
      ["patient_zip", snapshot.patient_zip, "Patient ZIP is required"],
      ["payer_name", snapshot.payer_name, "Payer name is required"],
      ["payer_id", snapshot.payer_id, "Payer ID is required"],
    ];
    for (const [field, value, message] of requiredFields) addRequired(errors, `snapshot.${field}`, value, message);
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "ready" : "not_ready",
    claimId,
    errors,
  };
}
