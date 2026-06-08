import { pickClaimStatusAdapter } from "@/lib/clearinghouse/pickClaimStatusAdapter";
import type {
  ClaimStatusRequestInput,
  ClaimStatusResponseNormalized,
  ClearinghouseConnection,
} from "@/types/clearinghouse";
import type { ClearinghouseAdapter } from "@/lib/clearinghouse/ClearinghouseAdapter";
import type { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type Sb = NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>;

export interface DispatchClaimStatusInquiryInput {
  supabase: Sb;
  organizationId: string;
  claimId: string;
  inquiryId: string;
  /**
   * Override the adapter used to send the 276 (primarily for tests).
   * Production callers should leave this undefined; the dispatcher
   * resolves the org's active `clearinghouse_connections` row and
   * routes through `pickClaimStatusAdapter` — vendor='availity' goes
   * to the real AvailityRealtimeAdapter (CAQH CORE SOAP 276/277),
   * everything else falls back to MockClearinghouseAdapter.
   */
  adapter?: ClearinghouseAdapter;
}

export interface DispatchClaimStatusInquiryResult {
  inquiryStatus: "received" | "failed";
  normalized: ClaimStatusResponseNormalized | null;
  controlNumber: string | null;
  correlationId: string | null;
  errorMessage: string | null;
}

interface ProfessionalClaimRow {
  id: string;
  organization_id: string;
  patient_id: string | null;
  encounter_id: string | null;
  payer_profile_id: string | null;
  claim_status: string;
  total_charge: number | string | null;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `csi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function resolveConnection(
  supabase: Sb,
  organizationId: string,
): Promise<ClearinghouseConnection> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };
  const { data } = await sb
    .from("clearinghouse_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return data as ClearinghouseConnection;
  return {
    id: uuid(),
    organization_id: organizationId,
    vendor: "mock",
    mode: "test",
    is_active: true,
  };
}

/**
 * Dispatch a queued `claim_status_inquiries` row:
 *  1) mark it `sent`
 *  2) build + send a real 276 via the clearinghouse adapter
 *  3) write the 276 and parsed 277 to `edi_transactions`
 *  4) update the SAME inquiry row in place with the normalized 277 info
 *     (`payer_status_code`, `payer_status_text`, `responded_at`,
 *     `inquiry_status='received'`, `response_summary`)
 *  5) insert a `claim_status_events` row so the Payer Received detail
 *     panel's 276/277 status history reflects the new event.
 *
 * On adapter failure the inquiry is flipped to `inquiry_status='failed'`
 * and a `claim_status_events` row with severity-equivalent status
 * `error` is written so the failure surfaces in the same history view.
 */
export async function dispatchClaimStatusInquiry(
  input: DispatchClaimStatusInquiryInput,
): Promise<DispatchClaimStatusInquiryResult> {
  const { supabase, organizationId, claimId, inquiryId } = input;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };

  // Mark the queued inquiry as sent before we hit the wire so concurrent
  // workers don't double-dispatch it.
  await sb
    .from("claim_status_inquiries")
    .update({ inquiry_status: "sent", updated_at: new Date().toISOString() })
    .eq("id", inquiryId)
    .eq("organization_id", organizationId);

  // Load enough claim/payer/policy context to build a valid 276.
  const { data: claimData, error: claimErr } = await sb
    .from("professional_claims")
    .select(
      "id, organization_id, patient_id, encounter_id, payer_profile_id, claim_status, total_charge",
    )
    .eq("id", claimId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (claimErr || !claimData) {
    return finishWithFailure({
      sb,
      organizationId,
      claimId,
      inquiryId,
      message: claimErr?.message ?? "Claim not found for status dispatch",
    });
  }
  const claim = claimData as ProfessionalClaimRow;

  const { data: payerData } = claim.payer_profile_id
    ? await sb
        .from("payer_profiles")
        .select("payer_name, availity_payer_id")
        .eq("id", claim.payer_profile_id)
        .maybeSingle()
    : { data: null };
  const { data: policyData } = claim.patient_id
    ? await sb
        .from("insurance_policies")
        .select("subscriber_id, policy_number")
        .eq("client_id", claim.patient_id)
        .eq("active_flag", true)
        .order("priority", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const payerRow = (payerData ?? null) as
    | { payer_name?: string | null; availity_payer_id?: string | null }
    | null;
  const policyRow = (policyData ?? null) as
    | { subscriber_id?: string | null; policy_number?: string | null }
    | null;

  const connection = await resolveConnection(supabase, organizationId);

  const chargeAmount =
    typeof claim.total_charge === "number"
      ? claim.total_charge
      : Number.parseFloat(String(claim.total_charge ?? "0")) || 0;

  const adapterInput: ClaimStatusRequestInput = {
    organizationId,
    claimId: claim.id,
    patientId: claim.patient_id,
    clearinghouseConnectionId: connection.id,
    payerId: payerRow?.availity_payer_id ?? null,
    payerName: payerRow?.payer_name ?? null,
    claimAmount: chargeAmount,
    memberId: policyRow?.subscriber_id ?? policyRow?.policy_number ?? null,
    currentClaimStatus: claim.claim_status,
    dateOfService: null,
  };

  // Persist the outbound 276 before sending so we have an audit trail
  // even if the round-trip fails mid-flight.
  const sentAt = new Date().toISOString();
  const outboundId = uuid();
  try {
    await sb.from("edi_transactions").insert({
      id: outboundId,
      organization_id: organizationId,
      client_id: claim.patient_id,
      encounter_id: claim.encounter_id,
      claim_id: claim.id,
      clearinghouse_connection_id: connection.id,
      transaction_type: "276",
      direction: "outbound",
      status: "created",
      request_payload: adapterInput as unknown as Record<string, unknown>,
      response_payload: {},
      parsed_summary: {},
      sent_at: sentAt,
      created_at: sentAt,
    });
  } catch (e) {
    // Don't abort the dispatch on audit-only failures — those rows
    // belong to the existing 276/277 trace surface; the inquiry row
    // is the source of truth the queue actually consumes.
    console.warn("claimStatusDispatcher: edi_transactions outbound insert failed:", e);
  }

  const adapter = input.adapter ?? pickClaimStatusAdapter(connection);

  let result: Awaited<ReturnType<ClearinghouseAdapter["runClaimStatus276"]>>;
  try {
    result = await adapter.runClaimStatus276(adapterInput);
  } catch (e) {
    return finishWithFailure({
      sb,
      organizationId,
      claimId,
      inquiryId,
      message: e instanceof Error ? e.message : "276/277 transport failed",
      outboundTransactionId: outboundId,
    });
  }

  // Persist the inbound 277.
  const receivedAt = new Date().toISOString();
  const inboundId = uuid();
  try {
    await sb.from("edi_transactions").insert({
      id: inboundId,
      organization_id: organizationId,
      client_id: claim.patient_id,
      encounter_id: claim.encounter_id,
      claim_id: claim.id,
      clearinghouse_connection_id: connection.id,
      transaction_type: "277",
      direction: "inbound",
      status: "parsed",
      control_number: result.controlNumber,
      correlation_id: result.correlationId,
      request_payload: adapterInput as unknown as Record<string, unknown>,
      response_payload: (result.normalized.rawStatus ?? {}) as Record<string, unknown>,
      raw_request: result.rawRequest,
      raw_response: result.rawResponse,
      parsed_summary: result.normalized as unknown as Record<string, unknown>,
      sent_at: sentAt,
      received_at: receivedAt,
      created_at: receivedAt,
    });
    await sb
      .from("edi_transactions")
      .update({
        control_number: result.controlNumber,
        correlation_id: result.correlationId,
        raw_request: result.rawRequest,
        status: "sent",
      })
      .eq("id", outboundId);
  } catch (e) {
    console.warn("claimStatusDispatcher: edi_transactions inbound insert failed:", e);
  }

  // Update the SAME queued inquiry row in place so the Payer Received
  // history view sees the original "Check payer status" request come
  // back with the payer's answer instead of growing a second row.
  const payerStatusCode = result.normalized.statusCode ?? null;
  const payerStatusText = result.normalized.payerMessage ?? null;
  const { error: updateErr } = await sb
    .from("claim_status_inquiries")
    .update({
      inquiry_status: "received",
      payer_status_code: payerStatusCode,
      payer_status_text: payerStatusText,
      responded_at: receivedAt,
      response_summary: {
        status: result.normalized.status,
        statusCategoryCode: result.normalized.statusCategoryCode ?? null,
        statusCode: payerStatusCode,
        payerMessage: payerStatusText,
        controlNumber: result.controlNumber,
        correlationId: result.correlationId,
      },
      updated_at: receivedAt,
    })
    .eq("id", inquiryId)
    .eq("organization_id", organizationId);

  if (updateErr) {
    return finishWithFailure({
      sb,
      organizationId,
      claimId,
      inquiryId,
      message: updateErr.message ?? "Failed to record payer 277 response",
      outboundTransactionId: outboundId,
      inboundTransactionId: inboundId,
    });
  }

  // Mirror the inquiry update into claim_status_events so the Payer
  // Received detail panel's 276/277 history reflects the new event.
  try {
    await sb.from("claim_status_events").insert({
      claim_id: claim.id,
      source: "clearinghouse",
      status:
        result.normalized.status === "accepted"
          ? "accepted_payer"
          : result.normalized.status,
      status_message:
        payerStatusText ?? `Clearinghouse returned status "${result.normalized.status}".`,
      payer_reference_id: result.correlationId,
      raw_payload: {
        source: "payer_received_dispatcher",
        organization_id: organizationId,
        inquiry_id: inquiryId,
        normalized: result.normalized,
        transaction_ids: {
          edi_276: outboundId,
          edi_277: inboundId,
        },
        control_number: result.controlNumber,
        correlation_id: result.correlationId,
      },
    });
  } catch (e) {
    console.warn("claimStatusDispatcher: claim_status_events insert failed:", e);
  }

  return {
    inquiryStatus: "received",
    normalized: result.normalized,
    controlNumber: result.controlNumber,
    correlationId: result.correlationId,
    errorMessage: null,
  };
}

async function finishWithFailure(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: { from: (t: string) => any };
  organizationId: string;
  claimId: string;
  inquiryId: string;
  message: string;
  outboundTransactionId?: string;
  inboundTransactionId?: string;
}): Promise<DispatchClaimStatusInquiryResult> {
  const { sb, organizationId, claimId, inquiryId, message } = args;
  const failedAt = new Date().toISOString();
  try {
    await sb
      .from("claim_status_inquiries")
      .update({
        inquiry_status: "failed",
        responded_at: failedAt,
        response_summary: { error: message },
        updated_at: failedAt,
      })
      .eq("id", inquiryId)
      .eq("organization_id", organizationId);
  } catch (e) {
    console.warn("claimStatusDispatcher: failure update failed:", e);
  }
  try {
    await sb.from("claim_status_events").insert({
      claim_id: claimId,
      source: "clearinghouse",
      status: "error",
      status_message: message,
      raw_payload: {
        source: "payer_received_dispatcher",
        organization_id: organizationId,
        inquiry_id: inquiryId,
        error: message,
        transaction_ids: {
          edi_276: args.outboundTransactionId ?? null,
          edi_277: args.inboundTransactionId ?? null,
        },
      },
    });
  } catch (e) {
    console.warn("claimStatusDispatcher: failure event insert failed:", e);
  }
  return {
    inquiryStatus: "failed",
    normalized: null,
    controlNumber: null,
    correlationId: null,
    errorMessage: message,
  };
}
