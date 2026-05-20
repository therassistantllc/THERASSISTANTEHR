import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type SupabaseAdmin = ReturnType<typeof createServerSupabaseAdminClient>;

async function countRows(
  supabase: NonNullable<SupabaseAdmin>,
  table: string,
  filters: Record<string, string>,
) {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [field, value] of Object.entries(filters)) {
    query = query.eq(field, value);
  }
  const { count, error } = await query;
  if (error) {
    console.error(`countRows failed for ${table}`, filters, error);
    return 0;
  }
  return count ?? 0;
}

async function countWorkqueue(
  supabase: NonNullable<SupabaseAdmin>,
  organizationId: string,
  workType: string,
) {
  const { count, error } = await supabase
    .from("workqueue_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("work_type", workType)
    .in("status", ["open", "in_progress", "blocked"])
    .is("archived_at", null);

  if (error) {
    console.error(`countWorkqueue failed for ${workType}`, error);
    return 0;
  }
  return count ?? 0;
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await fn(), error: null };
  } catch (error) {
    console.error(`billing dashboard widget '${label}' failed:`, error);
    return { value: fallback, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const claimStatuses = [
      "ready_for_validation",
      "validation_failed",
      "ready_for_batch",
      "batched",
      "submitted",
      "accepted_oa",
      "rejected_oa",
      "accepted_payer",
      "rejected_payer",
      "paid",
      "denied",
    ] as const;

    const batchStatuses = [
      "generated",
      "submitted",
      "accepted_999",
      "rejected_999",
      "accepted_277ca",
      "rejected_277ca",
      "partially_accepted",
      "failed",
    ] as const;

    const eraImportStatuses = ["uploaded", "parsed", "matched", "posted", "blocked", "failed"] as const;
    const eraMatchStatuses = ["matched", "unmatched", "ambiguous"] as const;
    const eraPostingStatuses = ["ready", "posted", "blocked", "skipped"] as const;
    const invoiceStatuses = ["draft", "open", "sent", "paid", "voided", "collections"] as const;
    const chargeStatuses = ["draft", "blocked", "ready_for_claim", "claim_created", "voided"] as const;

    const claimCountsResult = await safe(
      "claimCounts",
      async () => {
        const entries = await Promise.all(
          claimStatuses.map(async (status) => [
            status,
            await countRows(supabase, "professional_claims", { organization_id: organizationId, claim_status: status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof claimStatuses)[number], number>;
      },
      Object.fromEntries(claimStatuses.map((s) => [s, 0])) as Record<(typeof claimStatuses)[number], number>,
    );

    const batchCountsResult = await safe(
      "batchCounts",
      async () => {
        const entries = await Promise.all(
          batchStatuses.map(async (status) => [
            status,
            await countRows(supabase, "edi_batches", { organization_id: organizationId, status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof batchStatuses)[number], number>;
      },
      Object.fromEntries(batchStatuses.map((s) => [s, 0])) as Record<(typeof batchStatuses)[number], number>,
    );

    const eraImportCountsResult = await safe(
      "eraImportCounts",
      async () => {
        const entries = await Promise.all(
          eraImportStatuses.map(async (status) => [
            status,
            await countRows(supabase, "era_import_batches", { organization_id: organizationId, import_status: status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof eraImportStatuses)[number], number>;
      },
      Object.fromEntries(eraImportStatuses.map((s) => [s, 0])) as Record<(typeof eraImportStatuses)[number], number>,
    );

    const eraMatchCountsResult = await safe(
      "eraMatchCounts",
      async () => {
        const entries = await Promise.all(
          eraMatchStatuses.map(async (status) => [
            status,
            await countRows(supabase, "era_claim_payments", { organization_id: organizationId, claim_match_status: status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof eraMatchStatuses)[number], number>;
      },
      Object.fromEntries(eraMatchStatuses.map((s) => [s, 0])) as Record<(typeof eraMatchStatuses)[number], number>,
    );

    const eraPostingCountsResult = await safe(
      "eraPostingCounts",
      async () => {
        const entries = await Promise.all(
          eraPostingStatuses.map(async (status) => [
            status,
            await countRows(supabase, "era_claim_payments", { organization_id: organizationId, posting_status: status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof eraPostingStatuses)[number], number>;
      },
      Object.fromEntries(eraPostingStatuses.map((s) => [s, 0])) as Record<(typeof eraPostingStatuses)[number], number>,
    );

    const patientInvoiceCountsResult = await safe(
      "patientInvoiceCounts",
      async () => {
        const entries = await Promise.all(
          invoiceStatuses.map(async (status) => [
            status,
            await countRows(supabase, "patient_invoices", { organization_id: organizationId, invoice_status: status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof invoiceStatuses)[number], number>;
      },
      Object.fromEntries(invoiceStatuses.map((s) => [s, 0])) as Record<(typeof invoiceStatuses)[number], number>,
    );

    const chargeCaptureCountsResult = await safe(
      "chargeCaptureCounts",
      async () => {
        const entries = await Promise.all(
          chargeStatuses.map(async (status) => [
            status,
            await countRows(supabase, "charge_capture_items", { organization_id: organizationId, charge_status: status }),
          ] as const),
        );
        return Object.fromEntries(entries) as Record<(typeof chargeStatuses)[number], number>;
      },
      Object.fromEntries(chargeStatuses.map((s) => [s, 0])) as Record<(typeof chargeStatuses)[number], number>,
    );

    const workqueueCountsResult = await safe(
      "workqueueCounts",
      async () => ({
        no_response: await countWorkqueue(supabase, organizationId, "no_response"),
        clearinghouse_rejection: await countWorkqueue(supabase, organizationId, "clearinghouse_rejection"),
        payer_rejection: await countWorkqueue(supabase, organizationId, "payer_rejection"),
        eligibility_needed: await countWorkqueue(supabase, organizationId, "eligibility_needed"),
        payment_posting_needed: await countWorkqueue(supabase, organizationId, "payment_posting_needed"),
      }),
      {
        no_response: 0,
        clearinghouse_rejection: 0,
        payer_rejection: 0,
        eligibility_needed: 0,
        payment_posting_needed: 0,
      },
    );

    const claimCounts = claimCountsResult.value;
    const batchCounts = batchCountsResult.value;
    const eraImportCounts = eraImportCountsResult.value;
    const eraMatchCounts = eraMatchCountsResult.value;
    const eraPostingCounts = eraPostingCountsResult.value;
    const patientInvoiceCounts = patientInvoiceCountsResult.value;
    const chargeCaptureCounts = chargeCaptureCountsResult.value;
    const workqueueCounts = workqueueCountsResult.value;

    const widgets = {
      chargeCapture: {
        error: chargeCaptureCountsResult.error,
        total:
          chargeCaptureCounts.draft +
          chargeCaptureCounts.blocked +
          chargeCaptureCounts.ready_for_claim +
          chargeCaptureCounts.claim_created,
        blocked: chargeCaptureCounts.blocked,
        readyForClaim: chargeCaptureCounts.ready_for_claim,
        claimCreated: chargeCaptureCounts.claim_created,
      },
      claimReadiness: {
        error: claimCountsResult.error,
        validationFailed: claimCounts.validation_failed,
        readyForBatch: claimCounts.ready_for_batch,
        batched: claimCounts.batched + batchCounts.generated + batchCounts.submitted,
      },
      denials: {
        error: claimCountsResult.error,
        denied: claimCounts.denied,
        rejectedPayer: claimCounts.rejected_payer,
        rejectedOa: claimCounts.rejected_oa,
        total: claimCounts.denied + claimCounts.rejected_payer + claimCounts.rejected_oa,
      },
      eraPayments: {
        error: eraImportCountsResult.error || eraMatchCountsResult.error || eraPostingCountsResult.error,
        imports: eraImportCounts.uploaded + eraImportCounts.parsed,
        unmatched: eraMatchCounts.unmatched + eraMatchCounts.ambiguous,
        readyToPost: eraPostingCounts.ready,
        blocked: eraPostingCounts.blocked,
      },
      workqueue: {
        error: workqueueCountsResult.error,
        total:
          workqueueCounts.no_response +
          workqueueCounts.clearinghouse_rejection +
          workqueueCounts.payer_rejection +
          workqueueCounts.eligibility_needed +
          workqueueCounts.payment_posting_needed,
        ...workqueueCounts,
      },
      patientInvoices: {
        error: patientInvoiceCountsResult.error,
        open: patientInvoiceCounts.open + patientInvoiceCounts.sent + patientInvoiceCounts.collections,
        draft: patientInvoiceCounts.draft,
        paid: patientInvoiceCounts.paid,
      },
    };

    return NextResponse.json({
      success: true,
      organizationId,
      claimCounts,
      batchCounts,
      eraImportCounts,
      eraMatchCounts,
      eraPostingCounts,
      patientInvoiceCounts,
      chargeCaptureCounts,
      workqueueCounts,
      widgets,
      totals: {
        needsBillingAction:
          claimCounts.validation_failed +
          claimCounts.rejected_oa +
          claimCounts.rejected_payer +
          eraMatchCounts.unmatched +
          eraMatchCounts.ambiguous +
          eraPostingCounts.blocked +
          workqueueCounts.no_response +
          workqueueCounts.clearinghouse_rejection +
          workqueueCounts.payer_rejection,
        readyToSend: claimCounts.ready_for_batch,
        waitingForResponse: claimCounts.submitted + claimCounts.accepted_oa,
        payerAccepted: claimCounts.accepted_payer,
        eraNeedsPosting: eraPostingCounts.ready,
        openPatientInvoices: patientInvoiceCounts.open + patientInvoiceCounts.sent + patientInvoiceCounts.collections,
      },
    });
  } catch (error) {
    console.error("Billing workflow dashboard API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Billing workflow dashboard failed" },
      { status: 500 },
    );
  }
}
