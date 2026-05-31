/**
 * rebuild837pForRejection
 *
 * Shared helper used by the 999 Rejections workqueue actions
 * ("Rebuild 837" and "Resubmit"). Rebuilds a fresh 837P artifact for a
 * single claim via the spec-compliant Availity generator
 * (`lib/edi/availity837p/generate837p`), persists it as a new
 * `edi_batches` row (with the linking `edi_batch_claims` row), and —
 * when `submit: true` — transmits it through `AvailityJsonApiAdapter`.
 *
 * Returns a structured result so the caller can:
 *   - update the workqueue item status (resolved on success, in_progress
 *     on failure / build-only rebuild),
 *   - post a comment to the timeline that surfaces validation or
 *     transmission errors verbatim,
 *   - bubble the new batch id back to the UI so billers can open it.
 *
 * Failure modes never throw — they return `{ ok: false, ... }` with a
 * stage marker (`validation` | `build` | `persistence` | `submission`)
 * so the caller can craft an actionable comment.
 */
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { generateAvaility837PBatch } from "@/lib/edi/availity837p/generate837p";
import { validateAvaility837PClaim } from "@/lib/edi/availity837p/validate837p";
import type {
  AvailityConnection,
  Availity837PGenerationInput,
  ClaimPartiesSnapshot,
  ProfessionalClaim,
  ProfessionalClaimServiceLine,
} from "@/lib/edi/availity837p/types";
import { AvailityJsonApiAdapter } from "@/lib/clearinghouse/adapters/AvailityJsonApiAdapter";
import { resolveClearinghouseCredential } from "@/lib/clearinghouse/credentials";

type DbRow = Record<string, unknown>;

const asString = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const asBoolean = (v: unknown, fallback = false): boolean =>
  typeof v === "boolean" ? v : fallback;
const asNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function normalizeClaim(row: DbRow): ProfessionalClaim {
  return {
    id: asString(row.id),
    organization_id: asString(row.organization_id),
    patient_id: (row.patient_id as string | null | undefined) ?? null,
    appointment_id: (row.appointment_id as string | null | undefined) ?? null,
    payer_profile_id: (row.payer_profile_id as string | null | undefined) ?? null,
    claim_number: (row.claim_number as string | null | undefined) ?? null,
    patient_account_number: (row.patient_account_number as string | null | undefined) ?? null,
    claim_status: (row.claim_status as string | null | undefined) ?? null,
    total_charge: (row.total_charge as number | string | null | undefined) ?? 0,
    place_of_service: (row.place_of_service as string | null | undefined) ?? null,
    diagnosis_codes: Array.isArray(row.diagnosis_codes)
      ? (row.diagnosis_codes as unknown[]).map((x) => String(x))
      : [],
    prior_authorization_number:
      (row.prior_authorization_number as string | null | undefined) ?? null,
    accept_assignment: typeof row.accept_assignment === "boolean" ? row.accept_assignment : true,
    benefits_assignment:
      typeof row.benefits_assignment === "boolean" ? row.benefits_assignment : true,
    release_of_information:
      typeof row.release_of_information === "boolean" ? row.release_of_information : true,
    signature_on_file: typeof row.signature_on_file === "boolean" ? row.signature_on_file : true,
    validation_errors: row.validation_errors,
    last_validated_at: (row.last_validated_at as string | null | undefined) ?? null,
    created_at: (row.created_at as string | null | undefined) ?? null,
    updated_at: (row.updated_at as string | null | undefined) ?? null,
  };
}

function normalizeServiceLine(row: DbRow): ProfessionalClaimServiceLine {
  return {
    id: asString(row.id),
    claim_id: asString(row.claim_id),
    line_number: asNumber(row.line_number, 1),
    service_date_from: asString(row.service_date_from),
    service_date_to: (row.service_date_to as string | null | undefined) ?? null,
    procedure_code: asString(row.procedure_code),
    modifiers: Array.isArray(row.modifiers)
      ? (row.modifiers as unknown[]).map((x) => String(x))
      : [],
    charge_amount: (row.charge_amount as number | string | undefined) ?? 0,
    units: (row.units as number | string | undefined) ?? 1,
    diagnosis_pointers: Array.isArray(row.diagnosis_pointers)
      ? (row.diagnosis_pointers as unknown[]).map((x) => String(x))
      : ["1"],
    place_of_service: (row.place_of_service as string | null | undefined) ?? null,
    rendering_provider_npi: (row.rendering_provider_npi as string | null | undefined) ?? null,
    authorization_number: (row.authorization_number as string | null | undefined) ?? null,
    created_at: (row.created_at as string | null | undefined) ?? null,
    updated_at: (row.updated_at as string | null | undefined) ?? null,
  };
}

function normalizeParties(row: DbRow): ClaimPartiesSnapshot {
  return {
    id: asString(row.id),
    claim_id: asString(row.claim_id),
    billing_provider_entity_type: (row.billing_provider_entity_type === "1" ? "1" : "2") as
      | "1"
      | "2",
    billing_provider_name: asString(row.billing_provider_name),
    billing_provider_first_name:
      (row.billing_provider_first_name as string | null | undefined) ?? null,
    billing_provider_npi: asString(row.billing_provider_npi),
    billing_provider_tax_id: asString(row.billing_provider_tax_id),
    billing_provider_tax_id_type: (row.billing_provider_tax_id_type === "SY" ? "SY" : "EI") as
      | "EI"
      | "SY",
    billing_provider_address1: asString(row.billing_provider_address1),
    billing_provider_address2:
      (row.billing_provider_address2 as string | null | undefined) ?? null,
    billing_provider_city: asString(row.billing_provider_city),
    billing_provider_state: asString(row.billing_provider_state),
    billing_provider_zip: asString(row.billing_provider_zip),
    subscriber_last_name: asString(row.subscriber_last_name),
    subscriber_first_name: asString(row.subscriber_first_name),
    subscriber_member_id: asString(row.subscriber_member_id),
    subscriber_dob: asString(row.subscriber_dob),
    subscriber_gender:
      row.subscriber_gender === "F" || row.subscriber_gender === "M" || row.subscriber_gender === "U"
        ? (row.subscriber_gender as "F" | "M" | "U")
        : null,
    subscriber_address1: asString(row.subscriber_address1),
    subscriber_city: asString(row.subscriber_city),
    subscriber_state: asString(row.subscriber_state),
    subscriber_zip: asString(row.subscriber_zip),
    patient_is_subscriber: asBoolean(row.patient_is_subscriber, true),
    patient_last_name: (row.patient_last_name as string | null | undefined) ?? null,
    patient_first_name: (row.patient_first_name as string | null | undefined) ?? null,
    patient_dob: (row.patient_dob as string | null | undefined) ?? null,
    patient_gender:
      row.patient_gender === "F" || row.patient_gender === "M" || row.patient_gender === "U"
        ? (row.patient_gender as "F" | "M" | "U")
        : null,
    patient_address1: (row.patient_address1 as string | null | undefined) ?? null,
    patient_city: (row.patient_city as string | null | undefined) ?? null,
    patient_state: (row.patient_state as string | null | undefined) ?? null,
    patient_zip: (row.patient_zip as string | null | undefined) ?? null,
    payer_name: asString(row.payer_name),
    payer_id: asString(row.payer_id),
    rendering_same_as_billing: asBoolean(row.rendering_same_as_billing, true),
    rendering_provider_entity_type:
      row.rendering_provider_entity_type === "1" || row.rendering_provider_entity_type === "2"
        ? (row.rendering_provider_entity_type as "1" | "2")
        : null,
    rendering_provider_last_name_or_org:
      (row.rendering_provider_last_name_or_org as string | null | undefined) ?? null,
    rendering_provider_first_name:
      (row.rendering_provider_first_name as string | null | undefined) ?? null,
    rendering_provider_npi: (row.rendering_provider_npi as string | null | undefined) ?? null,
    service_facility_same_as_billing: asBoolean(row.service_facility_same_as_billing, true),
    service_facility_name: (row.service_facility_name as string | null | undefined) ?? null,
    service_facility_npi: (row.service_facility_npi as string | null | undefined) ?? null,
    service_facility_address1:
      (row.service_facility_address1 as string | null | undefined) ?? null,
    service_facility_city: (row.service_facility_city as string | null | undefined) ?? null,
    service_facility_state: (row.service_facility_state as string | null | undefined) ?? null,
    service_facility_zip: (row.service_facility_zip as string | null | undefined) ?? null,
    created_at: (row.created_at as string | null | undefined) ?? null,
    updated_at: (row.updated_at as string | null | undefined) ?? null,
  };
}

function normalizeConnection(row: DbRow): AvailityConnection {
  const mode = row.mode === "production" ? "production" : "test";
  const submitterContactPhone = (row.submitter_contact_phone as string | null | undefined) ?? null;
  const submitterContactEmailRaw =
    (row.submitter_contact_email as string | null | undefined)?.trim() ?? "";
  const submitterContactEmail = submitterContactEmailRaw ||
    (submitterContactPhone ? null : "admin@therassistant.com");
  return {
    id: asString(row.id),
    organization_id: asString(row.organization_id),
    clearinghouse_name: asString(row.clearinghouse_name, "availity"),
    mode,
    submitter_id: asString(row.submitter_id),
    sender_qualifier: row.sender_qualifier === "30" ? "30" : "ZZ",
    receiver_qualifier: row.receiver_qualifier === "ZZ" ? "ZZ" : "30",
    receiver_id: asString(row.receiver_id, "330897513"),
    receiver_name: asString(row.receiver_name, "AVAILITY"),
    gs_receiver_code: asString(row.gs_receiver_code, "OA"),
    x12_version: asString(row.x12_version, "005010X222A1"),
    isa_usage_indicator: mode === "production" ? "P" : "T",
    submitter_contact_phone: submitterContactPhone,
    submitter_contact_email: submitterContactEmail,
    sftp_host: (row.sftp_host as string | null | undefined) ?? null,
    sftp_port: typeof row.sftp_port === "number" ? row.sftp_port : 22,
    sftp_username: (row.sftp_username as string | null | undefined) ?? null,
    inbound_folder: (row.inbound_folder as string | null | undefined) ?? "inbound",
    outbound_folder: (row.outbound_folder as string | null | undefined) ?? "outbound",
    is_active: asBoolean(row.is_active, true),
    created_at: (row.created_at as string | null | undefined) ?? null,
    updated_at: (row.updated_at as string | null | undefined) ?? null,
  };
}

export type Rebuild837PForRejectionStage =
  | "lookup"
  | "validation"
  | "build"
  | "persistence"
  | "submission";

export interface Rebuild837PForRejectionInput {
  organizationId: string;
  claimId: string;
  /** When true, the new batch is transmitted to Availity after build. */
  submit: boolean;
}

export type Rebuild837PForRejectionResult =
  | {
      ok: true;
      submitted: boolean;
      batchId: string;
      fileName: string;
      availityTransactionId: string | null;
      warnings: Array<{ field: string; message: string }>;
    }
  | {
      ok: false;
      stage: Rebuild837PForRejectionStage;
      message: string;
      batchId?: string;
      errors?: Array<{ field: string; message: string }>;
    };

function extractTransactionId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const inner = (d.data as Record<string, unknown> | undefined) ?? undefined;
  const candidates = [
    d.transactionId,
    d.submissionId,
    d.referenceId,
    inner?.transactionId,
    inner?.submissionId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

export async function rebuild837PForRejection(
  input: Rebuild837PForRejectionInput,
): Promise<Rebuild837PForRejectionResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, stage: "lookup", message: "Database connection not available" };
  }

  const { organizationId, claimId, submit } = input;

  // 1. Load the claim, service lines, parties snapshot, payer profile, connection, organization.
  const { data: claimRow, error: claimErr } = await (supabase as any)
    .from("professional_claims")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", claimId)
    .maybeSingle();
  if (claimErr) return { ok: false, stage: "lookup", message: claimErr.message };
  if (!claimRow)
    return { ok: false, stage: "lookup", message: "Professional claim not found" };

  const [
    { data: serviceRows, error: serviceErr },
    { data: partiesRow, error: partiesErr },
  ] = await Promise.all([
    (supabase as any)
      .from("professional_claim_service_lines")
      .select("*")
      .eq("claim_id", claimId)
      .order("line_number", { ascending: true }),
    (supabase as any)
      .from("claim_parties_snapshot")
      .select("*")
      .eq("claim_id", claimId)
      .maybeSingle(),
  ]);
  if (serviceErr) return { ok: false, stage: "lookup", message: serviceErr.message };
  if (partiesErr) return { ok: false, stage: "lookup", message: partiesErr.message };
  if (!partiesRow)
    return { ok: false, stage: "lookup", message: "Claim parties snapshot not found" };

  const claim = normalizeClaim(claimRow as DbRow);
  const serviceLines = ((serviceRows ?? []) as DbRow[]).map(normalizeServiceLine);
  const parties = normalizeParties(partiesRow as DbRow);

  const { data: payerProfileRow, error: payerErr } = await (supabase as any)
    .from("payer_profiles")
    .select("*")
    .eq("id", claim.payer_profile_id ?? "")
    .maybeSingle();
  if (payerErr) return { ok: false, stage: "lookup", message: payerErr.message };
  if (!payerProfileRow)
    return { ok: false, stage: "lookup", message: "Payer profile not found for claim" };

  const { data: connectionRow, error: connErr } = await (supabase as any)
    .from("clearinghouse_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("vendor", "availity")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connErr) return { ok: false, stage: "lookup", message: connErr.message };
  if (!connectionRow)
    return {
      ok: false,
      stage: "lookup",
      message: "Active Availity clearinghouse connection not found",
    };

  const existingPhone = String((connectionRow as DbRow).submitter_contact_phone ?? "")
    .replace(/\D/g, "");
  const existingEmail = String((connectionRow as DbRow).submitter_contact_email ?? "").trim();
  if (!existingPhone && !existingEmail) {
    await (supabase as any)
      .from("clearinghouse_connections")
      .update({
        submitter_contact_email: "admin@therassistant.com",
        updated_at: new Date().toISOString(),
      })
      .eq("id", asString((connectionRow as DbRow).id));
    (connectionRow as DbRow).submitter_contact_email = "admin@therassistant.com";
  }

  const connection = normalizeConnection(connectionRow as DbRow);

  const { data: orgRow } = await (supabase as any)
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const submitterName =
    asString((orgRow as DbRow | null)?.name, "") ||
    asString(connection.submitter_id, "THERASSISTANT");

  const generationInput: Availity837PGenerationInput = {
    connection,
    submitterName,
    claim,
    serviceLines,
    parties,
    payerProfile: {
      id: asString((payerProfileRow as DbRow).id),
      organization_id: asString((payerProfileRow as DbRow).organization_id),
      payer_name: asString((payerProfileRow as DbRow).payer_name),
      availity_payer_id: asString((payerProfileRow as DbRow).availity_payer_id),
      payer_type: ((payerProfileRow as DbRow).payer_type as string | null | undefined) ?? null,
      is_active: (payerProfileRow as DbRow).is_active as boolean | null | undefined,
      notes: ((payerProfileRow as DbRow).notes as string | null | undefined) ?? null,
    },
  };

  // 2. Validate before we build / persist anything.
  const validation = validateAvaility837PClaim(generationInput);
  if (!validation.isValid) {
    const summary =
      validation.errors
        .slice(0, 5)
        .map((e) => `${e.field}: ${e.message}`)
        .join("; ") || "Claim failed Availity 837P validation";
    return {
      ok: false,
      stage: "validation",
      message: summary,
      errors: validation.errors.map((e) => ({ field: e.field, message: e.message })),
    };
  }

  // 3. Build the X12 artifact.
  let built;
  try {
    built = generateAvaility837PBatch(generationInput);
  } catch (e) {
    return {
      ok: false,
      stage: "build",
      message: e instanceof Error ? e.message : "Failed to build 837P artifact",
    };
  }

  // 4. Persist as a new edi_batches row and link the claim.
  const nowIso = new Date().toISOString();
  const { data: batchRow, error: batchInsertErr } = await (supabase as any)
    .from("edi_batches")
    .insert({
      organization_id: organizationId,
      clearinghouse_connection_id: connection.id,
      transaction_type: "837P",
      mode: connection.mode,
      file_name: built.fileName,
      file_content: built.fileContent,
      isa_control_number: built.isaControlNumber,
      gs_control_number: built.gsControlNumber,
      st_control_number: built.stControlNumber,
      claim_count: built.claimCount,
      status: "generated",
      generated_at: nowIso,
      created_at: nowIso,
    })
    .select("id")
    .single();
  if (batchInsertErr || !batchRow) {
    return {
      ok: false,
      stage: "persistence",
      message: batchInsertErr?.message ?? "Failed to persist new 837P batch",
    };
  }
  const batchId = String((batchRow as DbRow).id);

  const { error: linkErr } = await (supabase as any).from("edi_batch_claims").insert({
    edi_batch_id: batchId,
    claim_id: claimId,
    created_at: nowIso,
  });
  if (linkErr) {
    return { ok: false, stage: "persistence", message: linkErr.message, batchId };
  }

  // Move the claim to `batched` so it reflects the freshly-built artifact.
  await (supabase as any)
    .from("professional_claims")
    .update({ claim_status: "batched", updated_at: nowIso })
    .eq("organization_id", organizationId)
    .eq("id", claimId);

  // Best-effort audit row.
  await (supabase as any)
    .from("claim_status_events")
    .insert({
      claim_id: claimId,
      source: "837p_batch",
      status: "batched",
      status_message: "Claim re-batched from 999 rejection workqueue",
      raw_payload: {
        transaction_type: "837P",
        status_code: "batched",
        status_description: "Claim re-batched from 999 rejection workqueue",
        batch_id: batchId,
        file_name: built.fileName,
        mode: built.mode,
      },
      created_at: nowIso,
    });

  const warnings = validation.warnings.map((w) => ({ field: w.field, message: w.message }));

  if (!submit) {
    return {
      ok: true,
      submitted: false,
      batchId,
      fileName: built.fileName,
      availityTransactionId: null,
      warnings,
    };
  }

  // 5. Resubmit — resolve the credential and POST the X12 to Availity.
  const credential = await resolveClearinghouseCredential({
    organizationId,
    vendor: "availity",
  });
  if (!credential) {
    return {
      ok: false,
      stage: "submission",
      message:
        "No Availity credential configured for this organization. Add an API key on /settings/clearinghouse before resubmitting.",
      batchId,
    };
  }

  const adapter = new AvailityJsonApiAdapter({
    apiKey: credential.apiKey,
    baseUrl: credential.baseUrl,
  });
  const idempotencyKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${batchId}-${Date.now()}`;

  try {
    const result = await adapter.submitProfessionalX12({
      organizationId,
      x12: built.fileContent,
      idempotencyKey,
    });
    const externalId = extractTransactionId(result.data);
    const submittedAt = new Date().toISOString();

    await (supabase as any)
      .from("edi_batches")
      .update({
        status: "submitted",
        submitted_at: submittedAt,
        availity_file_id: externalId,
      })
      .eq("id", batchId)
      .eq("organization_id", organizationId);

    await (supabase as any)
      .from("professional_claims")
      .update({ claim_status: "submitted", updated_at: submittedAt })
      .eq("organization_id", organizationId)
      .eq("id", claimId);

    return {
      ok: true,
      submitted: true,
      batchId,
      fileName: built.fileName,
      availityTransactionId: externalId,
      warnings,
    };
  } catch (transportError) {
    const message =
      transportError instanceof Error ? transportError.message : "Availity submission failed";
    const failedAt = new Date().toISOString();

    await (supabase as any)
      .from("edi_batches")
      .update({ status: "failed", submitted_at: failedAt })
      .eq("id", batchId)
      .eq("organization_id", organizationId);

    return { ok: false, stage: "submission", message, batchId };
  }
}
