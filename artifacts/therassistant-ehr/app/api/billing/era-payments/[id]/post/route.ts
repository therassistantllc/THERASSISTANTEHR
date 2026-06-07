import { NextResponse } from "next/server";
import { postSingleEra835ClaimPayment } from "@/lib/payments/era835PostingService";
import {
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
  requireAuthenticatedPaymentPoster,
} from "@/lib/payments/postingEngine";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

interface PostBody {
  organizationId?: string;
  overrides?: {
    paymentAmount?: number;
    patientResponsibility?: number;
  };
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePostingStatus(
  value: unknown,
): "ready" | "posted" | "blocked" | "skipped" {
  const status = String(value ?? "").trim();
  if (status === "posted") return "posted";
  if (status === "blocked" || status === "failed" || status === "needs_review")
    return "blocked";
  if (status === "skipped" || status === "ignored") return "skipped";
  return "ready";
}

function normalizeMatchStatus(
  value: unknown,
  claimId: unknown,
): "matched" | "unmatched" | "ambiguous" {
  const status = String(value ?? "").trim();
  if ((status === "matched" || status === "manual_matched") && text(claimId))
    return "matched";
  if (status === "ambiguous") return "ambiguous";
  return "unmatched";
}

function patientResponsibilityFromPayload(
  payload: Record<string, unknown>,
): number {
  return num(
    payload.patient_responsibility ??
      payload.patientResponsibility ??
      payload.patient_responsibility_amount ??
      payload.patientResponsibilityAmount,
  );
}

function claimStatusCodeFromPayload(
  payload: Record<string, unknown>,
): string | null {
  return text(
    payload.claim_status_code ??
      payload.claimStatusCode ??
      payload.clp02_claim_status_code,
  );
}

function claimRefFromPayload(
  payload: Record<string, unknown>,
  fallback: unknown,
): string {
  return (
    text(
      payload.claim_ref ??
        payload.claimReference ??
        payload.clp01_claim_control_number ??
        fallback,
    ) ?? "UNKNOWN"
  );
}

async function syncImporterItemToEraClaimPayment(args: {
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>;
  organizationId: string;
  itemId: string;
  overrides?: PostBody["overrides"];
}): Promise<
  | { ok: true; eraClaimPaymentId: string }
  | { ok: false; status: number; error: string }
> {
  const { supabase, organizationId, itemId, overrides } = args;
  const now = new Date().toISOString();

  const { data: importerRow, error: importerError } = await supabase
    .from("payment_import_items")
    .select(
      "id, organization_id, batch_id, claim_id, client_id, imported_item_ref, gross_amount, net_amount, adjustment_amount, payment_import_status, match_status, raw_item_payload",
    )
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (importerError)
    return { ok: false, status: 500, error: importerError.message };
  if (!importerRow)
    return { ok: false, status: 404, error: "ERA payment not found" };

  const payload =
    importerRow.raw_item_payload &&
    typeof importerRow.raw_item_payload === "object"
      ? { ...(importerRow.raw_item_payload as Record<string, unknown>) }
      : {};

  if (
    overrides &&
    typeof overrides.paymentAmount === "number" &&
    Number.isFinite(overrides.paymentAmount)
  ) {
    importerRow.net_amount = +overrides.paymentAmount.toFixed(2);
  }
  if (
    overrides &&
    typeof overrides.patientResponsibility === "number" &&
    Number.isFinite(overrides.patientResponsibility)
  ) {
    payload.patient_responsibility =
      +overrides.patientResponsibility.toFixed(2);
  }

  const patientResponsibility = patientResponsibilityFromPayload(payload);
  const casAdjustments = array(payload.adjustments ?? payload.cas_adjustments);
  const serviceLines = array(payload.service_lines ?? payload.serviceLines);
  const rawSegments = array(
    payload.raw_segments ?? payload.rawSegments ?? payload.raw_claim_payload,
  );
  const matchStatus = normalizeMatchStatus(
    importerRow.match_status,
    importerRow.claim_id,
  );
  const postingStatus = normalizePostingStatus(
    importerRow.payment_import_status,
  );

  const { data: importBatch } = await supabase
    .from("payment_import_batches")
    .select(
      "id, import_source, source_file_name, payment_import_status, total_item_count, total_amount, imported_at, created_at, updated_at",
    )
    .eq("id", importerRow.batch_id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const { error: batchMirrorError } = await supabase
    .from("era_import_batches")
    .upsert(
      {
        id: importerRow.batch_id,
        organization_id: organizationId,
        source: text(importBatch?.import_source) ?? "payment_import",
        file_name: text(importBatch?.source_file_name),
        raw_content: "",
        parsed_summary: {
          source: "payment_import_batches",
          paymentImportBatchId: importerRow.batch_id,
        },
        import_status:
          importBatch?.payment_import_status === "posted" ? "posted" : "parsed",
        total_claims: Number(importBatch?.total_item_count ?? 1) || 1,
        total_payment_amount: num(
          importBatch?.total_amount ?? importerRow.net_amount,
        ),
        total_patient_responsibility: patientResponsibility,
        imported_at: importBatch?.imported_at ?? now,
        created_at: importBatch?.created_at ?? now,
        updated_at: now,
      },
      { onConflict: "id" },
    );
  if (batchMirrorError)
    return { ok: false, status: 500, error: batchMirrorError.message };

  const eraPayload = {
    id: itemId,
    organization_id: organizationId,
    era_import_batch_id: importerRow.batch_id,
    professional_claim_id: text(importerRow.claim_id),
    client_id: text(importerRow.client_id),
    clp01_claim_control_number: claimRefFromPayload(
      payload,
      importerRow.imported_item_ref,
    ),
    clp02_claim_status_code: claimStatusCodeFromPayload(payload),
    clp03_total_charge: num(
      payload.total_charge_amount ??
        payload.totalChargeAmount ??
        importerRow.gross_amount,
    ),
    clp04_payment_amount: num(
      payload.paid_amount ?? payload.paidAmount ?? importerRow.net_amount,
    ),
    clp05_patient_responsibility: patientResponsibility,
    payer_claim_control_number: text(
      payload.payer_claim_control_number ?? payload.payerClaimControlNumber,
    ),
    claim_match_status: matchStatus,
    posting_status:
      postingStatus === "posted"
        ? "posted"
        : matchStatus === "matched"
          ? "ready"
          : postingStatus,
    cas_adjustments: casAdjustments,
    service_lines: serviceLines,
    raw_segments: rawSegments,
    check_eft_number: text(
      payload.check_or_eft_number ?? payload.checkOrEftNumber,
    ),
    payer_trace_number: text(payload.trace_number ?? payload.traceNumber),
    check_issue_date: text(payload.payment_date ?? payload.paymentDate),
    adjustment_amount: num(importerRow.adjustment_amount),
    updated_at: now,
  };

  const { error: upsertError } = await supabase
    .from("era_claim_payments")
    .upsert(eraPayload, { onConflict: "id" });
  if (upsertError)
    return { ok: false, status: 500, error: upsertError.message };

  const importerUpdate: Record<string, unknown> = {
    payment_import_status:
      eraPayload.posting_status === "ready"
        ? "ready_to_post"
        : importerRow.payment_import_status,
    posting_ready: eraPayload.posting_status === "ready",
    raw_item_payload: payload,
    updated_at: now,
  };
  if (
    overrides &&
    typeof overrides.paymentAmount === "number" &&
    Number.isFinite(overrides.paymentAmount)
  ) {
    importerUpdate.net_amount = eraPayload.clp04_payment_amount;
  }
  const { error: itemUpdateError } = await supabase
    .from("payment_import_items")
    .update(importerUpdate)
    .eq("id", itemId)
    .eq("organization_id", organizationId);
  if (itemUpdateError)
    return { ok: false, status: 500, error: itemUpdateError.message };

  return { ok: true, eraClaimPaymentId: itemId };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as PostBody;
    const organizationId = body.organizationId
      ? String(body.organizationId)
      : "";

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: "organizationId is required" },
        { status: 400 },
      );
    }
    if (!id) {
      return NextResponse.json(
        { success: false, error: "ERA payment id is required" },
        { status: 400 },
      );
    }

    const actor = await requireAuthenticatedPaymentPoster(organizationId);

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    // The ERA poster is backed by payment_import_items, while the posting
    // engine records ledger/audit effects from era_claim_payments. Keep the two
    // rows synchronized before committing so a biller can match/create a patient
    // in the poster and immediately post the payment to the matched claim.
    const synced = await syncImporterItemToEraClaimPayment({
      supabase,
      organizationId,
      itemId: id,
      overrides: body.overrides,
    });

    if (!synced.ok) {
      return NextResponse.json(
        { success: false, error: synced.error },
        { status: synced.status },
      );
    }

    const result = await postSingleEra835ClaimPayment({
      organizationId,
      eraClaimPaymentId: synced.eraClaimPaymentId,
      actor,
    });

    if (!result.ok) {
      const status = result.blocked ? 409 : 500;
      return NextResponse.json({ success: false, ...result }, { status });
    }

    await supabase
      .from("payment_import_items")
      .update({
        payment_import_status: "posted",
        posting_ready: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    return NextResponse.json({
      success: true,
      ...result,
      eraClaimPaymentId: synced.eraClaimPaymentId,
    });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 401 },
      );
    }
    if (error instanceof PaymentPostingForbiddenError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 },
      );
    }
    console.error("Post ERA payment API error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to post ERA payment",
      },
      { status: 500 },
    );
  }
}
