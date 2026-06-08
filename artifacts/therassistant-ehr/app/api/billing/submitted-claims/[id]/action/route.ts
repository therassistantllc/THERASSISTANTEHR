import { NextResponse } from "next/server";
import { MockClearinghouseAdapter } from "@/lib/clearinghouse/MockClearinghouseAdapter";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import type {
  ClaimStatusRequestInput,
  ClaimStatusResponseNormalized,
  ClearinghouseConnection,
} from "@/types/clearinghouse";

type ActionName =
  | "check_status"
  | "request_update"
  | "move_to_no_response"
  | "add_note"
  | "resubmit";

interface ActionBody {
  organizationId?: string;
  action?: ActionName;
  note?: string | null;
}

const VALID_ACTIONS: ActionName[] = [
  "check_status",
  "request_update",
  "move_to_no_response",
  "add_note",
  "resubmit",
];

type Sb = NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Map the normalized 277 status onto a `professional_claims.claim_status`
 * value. Only return a NEW status when the 277 actually moves the claim
 * forward — keep the existing status otherwise so a benign "accepted"
 * doesn't downgrade a paid claim, and so an "error" response doesn't
 * regress to draft.
 */
function nextClaimStatusFor(
  current: string,
  normalized: ClaimStatusResponseNormalized["status"],
): string | null {
  switch (normalized) {
    case "paid":
      return current === "paid" ? null : "paid";
    case "denied":
      return current === "denied" ? null : "denied";
    case "rejected":
      // Mid-pipeline rejection — surface as payer-side rejection.
      return current === "rejected_payer" || current === "rejected_oa"
        ? null
        : "rejected_payer";
    case "accepted":
      // Move out of "Awaiting 277CA" once the payer confirms receipt.
      if (current === "batched" || current === "submitted" || current === "accepted_oa") {
        return "accepted_payer";
      }
      return null;
    case "pending":
    case "needs_info":
    case "not_found":
    case "error":
    case "unknown":
    default:
      return null;
  }
}

/**
 * Fetch the active clearinghouse connection for the org, or a synthetic
 * "mock" connection so demo orgs (and any tenant that hasn't wired up a
 * vendor yet) still get a real round-trip through the adapter.
 */
async function resolveConnection(
  supabase: Sb,
  organizationId: string,
): Promise<ClearinghouseConnection> {
  const { data } = await supabase
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

interface ProfessionalClaimRow {
  id: string;
  organization_id: string;
  patient_id: string | null;
  encounter_id: string | null;
  payer_profile_id: string | null;
  claim_number: string | null;
  claim_status: string;
  total_charge: number | string | null;
  submitted_at: string | null;
}

/**
 * Fire a 276 inquiry for a `professional_claims` row, then persist the
 * 276/277 EDI transactions, a `claim_status_inquiries` row, a
 * `claim_status_events` audit-trail entry, and (when appropriate) bump
 * `professional_claims.claim_status` so tab bucketing reflects reality.
 */
async function runProfessionalClaimStatusCheck(
  supabase: Sb,
  args: {
    claim: ProfessionalClaimRow;
    actorUserId: string | null;
  },
): Promise<{
  normalized: ClaimStatusResponseNormalized;
  newClaimStatus: string;
  inquiryId: string;
  eventMessage: string;
}> {
  const { claim, actorUserId } = args;
  const organizationId = claim.organization_id;
  const connection = await resolveConnection(supabase, organizationId);

  // Payer + member context — best-effort; the adapter input is permissive.
  const { data: payer } = claim.payer_profile_id
    ? await supabase
        .from("payer_profiles")
        .select("payer_name, availity_payer_id")
        .eq("id", claim.payer_profile_id)
        .maybeSingle()
    : { data: null as Record<string, unknown> | null };
  const { data: policy } = claim.patient_id
    ? await supabase
        .from("insurance_policies")
        .select("subscriber_id, policy_number")
        .eq("client_id", claim.patient_id)
        .eq("active_flag", true)
        .order("priority", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null as Record<string, unknown> | null };

  const payerRow = payer as { payer_name?: string | null; availity_payer_id?: string | null } | null;
  const policyRow = policy as { subscriber_id?: string | null; policy_number?: string | null } | null;

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

  // ── 1. Outbound 276 transaction (persist before send for audit trail).
  const sentAt = new Date().toISOString();
  const outboundId = uuid();
  await supabase.from("edi_transactions").insert({
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

  // ── 2. Call the clearinghouse adapter (mock today; real adapters route
  //       through the same shape so this code path is transport-agnostic).
  const adapter = new MockClearinghouseAdapter();
  const result = await adapter.runClaimStatus276(adapterInput);

  // ── 3. Inbound 277 transaction.
  const receivedAt = new Date().toISOString();
  const inboundId = uuid();
  await supabase.from("edi_transactions").insert({
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

  await supabase
    .from("edi_transactions")
    .update({
      control_number: result.controlNumber,
      correlation_id: result.correlationId,
      raw_request: result.rawRequest,
      status: "sent",
    })
    .eq("id", outboundId);

  // ── 4. Persist the normalized claim-status inquiry so the Payer Received /
  //       claim-detail views can surface 276/277 history alongside any
  //       queued requests.
  const inquiryId = uuid();
  await supabase.from("claim_status_inquiries").insert({
    id: inquiryId,
    organization_id: organizationId,
    claim_id: claim.id,
    patient_id: claim.patient_id,
    clearinghouse_connection_id: connection.id,
    edi_276_transaction_id: outboundId,
    edi_277_transaction_id: inboundId,
    payer_name: result.normalized.payerName ?? null,
    payer_id: result.normalized.payerId ?? null,
    inquiry_status: result.normalized.status,
    status: result.normalized.status,
    status_category_code: result.normalized.statusCategoryCode ?? null,
    status_code: result.normalized.statusCode ?? null,
    entity_code: result.normalized.entityCode ?? null,
    billed_amount: result.normalized.billedAmount ?? null,
    paid_amount: result.normalized.paidAmount ?? null,
    check_eft_number: result.normalized.checkEftNumber ?? null,
    finalized_date: result.normalized.finalizedDate ?? null,
    payer_status_code: result.normalized.statusCode ?? null,
    payer_status_text: result.normalized.payerMessage ?? null,
    requested_at: sentAt,
    received_at: receivedAt,
    raw_status: (result.normalized.rawStatus ?? {}) as Record<string, unknown>,
  });

  // ── 5. Bump professional_claims.claim_status when the 277 moves the
  //       claim forward (so Submitted Claims tab bucketing reflects the
  //       new state — e.g. accepted_oa → accepted_payer leaves the
  //       "Awaiting 277CA" tab).
  const next = nextClaimStatusFor(claim.claim_status, result.normalized.status);
  if (next) {
    await supabase
      .from("professional_claims")
      .update({ claim_status: next, updated_at: new Date().toISOString() })
      .eq("id", claim.id)
      .eq("organization_id", organizationId);
  }

  // ── 6. Audit-trail event for the Submission history detail tab.
  const eventStatus =
    result.normalized.status === "accepted"
      ? "accepted_payer"
      : result.normalized.status;
  const eventMessage =
    result.normalized.payerMessage ??
    `Clearinghouse returned status "${result.normalized.status}".`;
  await supabase.from("claim_status_events").insert({
    claim_id: claim.id,
    source: "clearinghouse",
    status: eventStatus,
    status_message: eventMessage,
    payer_reference_id: result.correlationId,
    raw_payload: {
      action: "check_status",
      organization_id: organizationId,
      actor_user_id: actorUserId,
      previous_status: claim.claim_status,
      new_status: next ?? claim.claim_status,
      normalized: result.normalized,
      transaction_ids: {
        edi_276: outboundId,
        edi_277: inboundId,
        claim_status_inquiry: inquiryId,
      },
      control_number: result.controlNumber,
      correlation_id: result.correlationId,
    },
  });

  return {
    normalized: result.normalized,
    newClaimStatus: next ?? claim.claim_status,
    inquiryId,
    eventMessage,
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const body = ((await request.json().catch(() => ({}))) as ActionBody) || {};
    const { id: claimId } = await ctx.params;
    const action = body.action;
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing `action`" },
        { status: 400 },
      );
    }

    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // Verify the claim belongs to this org.
    const { data: claim, error: claimErr } = await supabase
      .from("professional_claims")
      .select(
        "id, organization_id, patient_id, encounter_id, payer_profile_id, claim_number, claim_status, total_charge, submitted_at",
      )
      .eq("id", claimId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (claimErr) {
      return NextResponse.json({ success: false, error: claimErr.message }, { status: 422 });
    }
    if (!claim) {
      return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
    }
    const claimRow = claim as ProfessionalClaimRow;

    const nowIso = new Date().toISOString();
    const note = (body.note ?? "").trim() || null;
    let newClaimStatus: string | null = null;
    let eventStatus = "manual_action";
    let eventMessage = "";

    switch (action) {
      case "check_status": {
        // Fire a real 276 status inquiry, parse the 277, persist everything,
        // and roll the claim_status forward when the 277 says so.
        const outcome = await runProfessionalClaimStatusCheck(supabase, {
          claim: claimRow,
          actorUserId: guard.userId ?? null,
        });
        // The 276/277 round-trip already wrote its own claim_status_events
        // row (source=clearinghouse) and updated professional_claims when
        // appropriate — return early so we don't double-log a generic
        // "biller requested" event on top of the real payer response.
        return NextResponse.json({
          success: true,
          claimId,
          action,
          newClaimStatus: outcome.newClaimStatus,
          inquiryId: outcome.inquiryId,
          normalized: outcome.normalized,
          message: outcome.eventMessage,
        });
      }
      case "request_update":
        eventStatus = "update_requested";
        eventMessage = note ?? "Biller requested an update from the payer/clearinghouse.";
        break;
      case "move_to_no_response":
        eventStatus = "no_response_risk";
        eventMessage = note ?? "Moved to No Response Risk queue.";
        break;
      case "add_note":
        if (!note) {
          return NextResponse.json(
            { success: false, error: "`note` is required for add_note" },
            { status: 400 },
          );
        }
        eventStatus = "note";
        eventMessage = note;
        break;
      case "resubmit":
        // Send the claim back through validation so the next batch picks it up.
        newClaimStatus = "ready_for_validation";
        eventStatus = "resubmit_requested";
        eventMessage = note ?? "Biller marked the claim for resubmission.";
        break;
    }

    // Apply claim status change if applicable.
    if (newClaimStatus) {
      const { error: updateErr } = await supabase
        .from("professional_claims")
        .update({ claim_status: newClaimStatus, updated_at: nowIso })
        .eq("id", claimId)
        .eq("organization_id", organizationId);
      if (updateErr) {
        return NextResponse.json({ success: false, error: updateErr.message }, { status: 422 });
      }
    }

    // Always log an audit-trail event.
    const { error: eventErr } = await supabase.from("claim_status_events").insert({
      claim_id: claimId,
      source: "biller",
      status: eventStatus,
      status_message: eventMessage,
      raw_payload: {
        action,
        organization_id: organizationId,
        actor_user_id: guard.userId ?? null,
        previous_status: claimRow.claim_status,
        new_status: newClaimStatus ?? claimRow.claim_status,
      },
    });
    if (eventErr) {
      return NextResponse.json({ success: false, error: eventErr.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      claimId,
      action,
      newClaimStatus: newClaimStatus ?? claimRow.claim_status,
      message: eventMessage,
    });
  } catch (error) {
    console.error("submitted-claims action error", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Action failed",
      },
      { status: 500 },
    );
  }
}
