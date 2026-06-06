/**
 * Payment Posting Engine — `commitPosting` entrypoint.
 *
 * Single chokepoint for every ledger write. Wraps:
 *   1. Validation (blocking → return; warning → log + continue)
 *   2. Idempotency (already-posted replay)
 *   3. Ledger writes (era_posting_ledger_entries)
 *   4. Parent updates (era_claim_payments.posting_status,
 *      professional_claims.claim_status)
 *   5. Client invoice creation (when PR > 0 and client linked)
 *   6. Workqueue closeout (era_mismatch / era_835_exception items)
 *   7. Audit log emission for every meaningful step
 *
 * Phase 1 (Task #107) implements the `era_835` source only. Sources
 * `manual_insurance`, `patient_payment`, `recoupment`, `refund`, and
 * `reversal` are stubbed and return a clear "not implemented in
 * Foundation phase" error — Tasks #109 and #110 fill them in.
 *
 * Backwards compatibility:
 *   `era835PostingService.postSingleEra835ClaimPayment` delegates here.
 *   `postEra835Batch` iterates and calls this per claim.
 */

import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { UNIQUE_VIOLATION } from "@/lib/db/findOrCreate";
import { writePaymentAuditLog } from "./audit";
import { validateEra835Posting, isAlreadyPosted } from "./validation";
import type {
  CommitPostingInput,
  CommitPostingResult,
  EraClaimPaymentRow,
  PostingActor,
  PostingLedgerEffect,
} from "./types";

export * from "./types";
export * from "./roleGuard";
export { validateEra835Posting } from "./validation";
export {
  commitPatientPayment,
  applyClientCredit,
  type PatientPaymentApplyTo,
  type PatientPaymentMethod,
} from "./patientPayment";
export {
  reversePostedPayment,
  voidPostedPayment,
  recordRecoupment,
  recordInsuranceRefund,
  recordPatientRefund,
  confirmInsuranceRefund,
  confirmPatientRefund,
  cancelPendingRefund,
  type PostedPaymentKind,
} from "./reversal";

/** Default actor used when an internal service caller doesn't supply one. */
const SYSTEM_ACTOR: PostingActor = {
  staffId: null,
  userId: null,
  role: "system",
  source: "service:internal",
};

type CasAdjustmentLike = EraClaimPaymentRow["cas_adjustments"][number];

interface NormalizedCasAdjustment {
  index: number;
  groupCode: string | null;
  reasonCode: string | null;
  amount: number;
  sourceSegment: string;
  descriptionPrefix: string;
  lineNumber?: number | null;
  procedureCode?: string | null;
  serviceDate?: string | null;
}

function casGroupCode(adj: CasAdjustmentLike) {
  return (adj.groupCode ?? adj.group_code ?? "").toString().toUpperCase();
}

function casReasonCode(adj: CasAdjustmentLike) {
  return (adj.reasonCode ?? adj.reason_code ?? "").toString().trim();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizedCasAdjustments(
  adjustments: CasAdjustmentLike[],
  sourcePrefix = "CAS",
  descriptionPrefix = "ERA 835 CAS",
  extra: Pick<
    NormalizedCasAdjustment,
    "lineNumber" | "procedureCode" | "serviceDate"
  > = {},
): NormalizedCasAdjustment[] {
  return (adjustments ?? [])
    .map((adj, index) => ({
      index,
      groupCode: casGroupCode(adj) || null,
      reasonCode: casReasonCode(adj) || null,
      amount: round2(Number(adj.amount ?? 0)),
      sourceSegment: `${sourcePrefix}:${index}`,
      descriptionPrefix,
      ...extra,
    }))
    .filter((adj) => adj.amount !== 0);
}

function normalizedEraCasAdjustments(
  row: EraClaimPaymentRow,
): NormalizedCasAdjustment[] {
  const claimLevel = normalizedCasAdjustments(row.cas_adjustments ?? []);
  const serviceLineLevel = (row.service_lines ?? []).flatMap(
    (line, lineIndex) => {
      const adjustments = Array.isArray(line.adjustments)
        ? line.adjustments
        : Array.isArray(line.cas_adjustments)
          ? line.cas_adjustments
          : [];
      const procedureCode =
        String(line.procedureCode ?? line.procedure_code ?? "").trim() || null;
      const serviceDate =
        String(
          line.serviceDate ??
            line.service_date ??
            line.serviceDateFrom ??
            line.service_date_from ??
            "",
        ).trim() || null;
      return normalizedCasAdjustments(
        adjustments,
        `SVC:${lineIndex}:CAS`,
        `ERA 835 service line ${lineIndex + 1} CAS`,
        { lineNumber: lineIndex + 1, procedureCode, serviceDate },
      );
    },
  );
  return [...claimLevel, ...serviceLineLevel];
}

function postingEntryTypeForCas(
  adj: NormalizedCasAdjustment,
): PostingLedgerEffect["entryType"] {
  if (adj.groupCode === "CO") return "contractual_adjustment";
  if (adj.groupCode === "PR") return "patient_responsibility";
  return "other_adjustment";
}

function nonPatientAdjustmentTotal(adjustments: NormalizedCasAdjustment[]) {
  return round2(
    adjustments
      .filter((adj) => adj.groupCode !== "PR")
      .reduce((sum, adj) => sum + Number(adj.amount ?? 0), 0),
  );
}

function invoiceNumber(paymentId: string) {
  return `INV-${paymentId.slice(0, 8).toUpperCase()}`;
}

function emptyResult(): CommitPostingResult {
  return {
    ok: false,
    posted: false,
    blocked: false,
    alreadyPosted: false,
    validation: { blocking: [], warning: [] },
    effects: [],
    patientInvoiceCreated: false,
    workqueueItemsClosed: 0,
    auditLogIds: [],
    errors: [],
  };
}

export async function commitPosting(
  input: CommitPostingInput,
  injectedSupabase?: NonNullable<
    ReturnType<typeof createServerSupabaseAdminClient>
  >,
): Promise<CommitPostingResult> {
  const actor = input.actor ?? SYSTEM_ACTOR;
  if (input.source.type === "era_835") {
    return commitEra835Posting(input, input.source.eraClaimPaymentId);
  }
  if (input.source.type === "manual_insurance") {
    const { commitManualInsurancePosting } = await import("./manualInsurance");
    return commitManualInsurancePosting(
      input.organizationId,
      input.source,
      actor,
      input.dryRun,
    );
  }
  if (input.source.type === "patient_payment") {
    const { commitPatientPayment } = await import("./patientPayment");
    const r = await commitPatientPayment({
      organizationId: input.organizationId,
      clientId: input.source.clientId,
      amount: input.source.amount,
      method: input.source.method as never,
      applyTo: input.source.patientInvoiceId
        ? { kind: "invoice", patientInvoiceId: input.source.patientInvoiceId }
        : { kind: "none" },
      referenceNumber: input.source.reference ?? null,
      paymentDate: input.source.paymentDate,
      actor,
      dryRun: input.dryRun,
    });
    return r;
  }
  if (input.source.type === "refund") {
    // PP-4: dispatch to the proper insurance/patient refund recorder so
    // we get atomic ledger compensation, optional Stripe issuance, and
    // workqueue follow-up — never a flat negative entry.
    const { recordInsuranceRefund, recordPatientRefund } =
      await import("./reversal");
    const refundType =
      input.source.refundType ??
      (input.source.target.kind === "client_payment" ? "client" : "insurance");
    const fn =
      refundType === "client" ? recordPatientRefund : recordInsuranceRefund;
    const r = await fn(
      {
        organizationId: input.organizationId,
        target: input.source.target,
        amount: input.source.amount,
        reason: input.source.reason,
        stripeRefundId: input.source.stripeRefundId ?? null,
        alreadyIssued: input.source.alreadyIssued === true,
        actor,
        dryRun: input.dryRun,
      },
      injectedSupabase,
    );
    return refundResultToCommitResult(r);
  }
  if (input.source.type === "recoupment") {
    // PP-5: payer takeback. Route through recordRecoupment for atomic
    // ledger compensation (negative entry), workqueue follow-up, and
    // audit linkage back to the original posted payment. Task #172 threads
    // dryRun through so billers see a real preview (remaining balance,
    // compensating ledger row, workqueue item) before the takeback posts.
    const { recordRecoupment } = await import("./reversal");
    const r = await recordRecoupment(
      {
        organizationId: input.organizationId,
        target: input.source.target,
        amount: input.source.amount,
        reason: input.source.reason,
        reasonCode: input.source.reasonCode ?? null,
        offsetEraClaimPaymentId: input.source.offsetEraClaimPaymentId ?? null,
        actor,
        dryRun: input.dryRun,
      },
      injectedSupabase,
    );
    return recoupmentResultToCommitResult(r);
  }
  if (input.source.type === "reversal") {
    const { reversePostedPayment } = await import("./reversal");
    const r = await reversePostedPayment(
      {
        organizationId: input.organizationId,
        target: input.source.target,
        reason: input.source.reason,
        actor,
        dryRun: input.dryRun,
      },
      injectedSupabase,
    );
    return reversalResultToCommitResult(r);
  }
  // All PostingSource variants are handled above; this is exhaustiveness
  // insurance for any future variant added to the union without a branch.
  const exhausted: never = input.source;
  const result = emptyResult();
  result.errors.push({
    field: "source.type",
    message: `Posting source "${(exhausted as { type?: string }).type ?? "unknown"}" is not implemented.`,
  });
  return result;
}

function refundResultToCommitResult(
  r: Awaited<ReturnType<typeof import("./reversal").recordPatientRefund>>,
): CommitPostingResult {
  // CommitPostingResult.posted means "any rows written" — a refund row
  // inserted in 'pending' state still counts as a write (Stripe issuance
  // can flip it to 'issued' later). Preserve refundId/status/workqueue
  // via the optional `refund` field so dashboard callers don't need to
  // re-query.
  const out = emptyResult();
  out.ok = r.ok;
  out.posted = r.ok && !!r.refundId;
  out.auditLogIds = r.auditLogIds;
  out.errors = r.errors;
  // Dry-run path (no refund row written): expose the preview separately
  // and leave `out.refund` undefined so dashboard callers can distinguish
  // "would refund" from "did refund" by presence of `out.refund` alone.
  if (r.refundId == null && r.preview) {
    out.refundPreview = r.preview;
  } else {
    out.refund = {
      refundId: r.refundId,
      refundStatus: r.refundStatus,
      workqueueItemId: r.workqueueItemId,
      preview: r.preview,
    };
  }
  // Dry-run: surface compensating-ledger preview as `effects` so existing
  // UI that already iterates result.effects "just works" for the confirm
  // modal (insurance refunds only — client refunds reduce invoice paid
  // amount instead of writing a ledger row).
  if (r.preview?.compensatingLedgerEntry) {
    const e = r.preview.compensatingLedgerEntry;
    out.effects = [
      {
        // entryType is a discriminated union in the engine, but the
        // refund-compensation row is written with entry_type='payment'
        // which is outside that union. Cast to keep types honest.
        entryType: e.entryType as never,
        amount: e.amount,
        description: e.description,
      },
    ];
  }
  return out;
}

function recoupmentResultToCommitResult(
  r: Awaited<ReturnType<typeof import("./reversal").recordRecoupment>>,
): CommitPostingResult {
  // CommitPostingResult.posted means "any rows written" — a recoupment row
  // plus its paired negative ledger entry both count. Surface the linked
  // recoupment/ledger/workqueue ids via the optional `recoupment` field so
  // dashboard callers don't have to re-query reversal.ts directly.
  const out = emptyResult();
  out.ok = r.ok;
  out.posted = r.ok && !!r.recoupmentId;
  out.auditLogIds = r.auditLogIds;
  out.errors = r.errors;
  out.recoupment = {
    recoupmentId: r.recoupmentId,
    ledgerEntryId: r.ledgerEntryId,
    workqueueItemId: r.workqueueItemId,
    preview: r.preview,
  };
  // Dry-run: surface the compensating negative ledger entry as `effects`
  // so existing UI iterating result.effects in its preview modal renders
  // the takeback row without a special-case branch.
  if (r.preview) {
    const e = r.preview.ledgerEntry;
    out.effects = [
      {
        // entry_type is 'insurance_payment' (a member of the union) but
        // the negative-amount recoupment row is outside the engine's
        // happy-path discriminator. Cast to keep types honest.
        entryType: e.entryType as never,
        amount: e.amount,
        groupCode: e.groupCode,
        reasonCode: e.reasonCode,
        description: e.description,
      },
    ];
  }
  return out;
}

function reversalResultToCommitResult(
  r: Awaited<ReturnType<typeof import("./reversal").reversePostedPayment>>,
): CommitPostingResult {
  const out = emptyResult();
  out.ok = r.ok;
  out.posted = r.reversed;
  out.alreadyReversed = r.alreadyReversed;
  out.workqueueItemsClosed = r.workqueueItemsClosed;
  out.auditLogIds = r.auditLogIds;
  out.errors = r.errors;
  if (r.preview) {
    out.reversalPreview = r.preview;
    // Surface the paired negative ledger entries as `effects` so callers
    // that render result.effects in their preview UI need no special-case.
    out.effects = r.preview.ledgerReversalEntries.map((entry) => ({
      entryType: entry.entryType as never,
      amount: entry.amount,
      groupCode: entry.groupCode,
      reasonCode: entry.reasonCode,
      description: entry.description,
    }));
  }
  return out;
}

async function commitEra835Posting(
  input: CommitPostingInput,
  eraClaimPaymentId: string,
): Promise<CommitPostingResult> {
  const result = emptyResult();
  const actor = input.actor ?? SYSTEM_ACTOR;

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    result.errors.push({
      field: "system",
      message: "Database connection not available",
    });
    return result;
  }

  // ── 1. Hydrate ────────────────────────────────────────────────────────────
  const { data: paymentRow, error: paymentError } = await supabase
    .from("era_claim_payments")
    .select(
      "id, professional_claim_id, client_id, clp01_claim_control_number, clp03_total_charge, clp04_payment_amount, clp05_patient_responsibility, cas_adjustments, service_lines, claim_match_status, posting_status",
    )
    .eq("organization_id", input.organizationId)
    .eq("id", eraClaimPaymentId)
    .is("archived_at", null)
    .maybeSingle();

  if (paymentError) {
    result.errors.push({
      field: "era_claim_payments",
      message: paymentError.message,
    });
    return result;
  }
  if (!paymentRow) {
    result.errors.push({
      field: "era_claim_payments",
      message: "ERA claim payment not found",
    });
    return result;
  }

  const row = paymentRow as EraClaimPaymentRow;

  // ── 2. Idempotency replay ────────────────────────────────────────────────
  if (isAlreadyPosted(row)) {
    result.ok = true;
    result.alreadyPosted = true;
    return result;
  }

  // ── 3. Validation ────────────────────────────────────────────────────────
  result.validation = validateEra835Posting(row);
  if (result.validation.blocking.length > 0) {
    result.blocked = true;
    result.errors.push(
      ...result.validation.blocking.map((issue) => ({
        field: issue.field,
        message: issue.message,
      })),
    );
    return result;
  }

  // ── 4. Dry-run short-circuit ─────────────────────────────────────────────
  if (input.dryRun) {
    result.ok = true;
    return result;
  }

  // ── 5. Commit ledger effects + parent updates ────────────────────────────
  const now = new Date().toISOString();
  const totalCharge = round2(Number(row.clp03_total_charge ?? 0));
  const insurancePayment = round2(Number(row.clp04_payment_amount ?? 0));
  const casAdjustments = normalizedEraCasAdjustments(row);
  const contractualAdjustment = round2(
    casAdjustments
      .filter((adj) => adj.groupCode === "CO")
      .reduce((sum, adj) => sum + Number(adj.amount ?? 0), 0),
  );
  const patientResponsibility = round2(
    Number(row.clp05_patient_responsibility ?? 0),
  );

  try {
    if (totalCharge > 0) {
      await createLedgerEntry(supabase, input.organizationId, row, {
        entryType: "charge",
        amount: totalCharge,
        description: "Total charge logged from ERA 835 CLP03",
        sourceSegment: "CLP03",
      });
      result.effects.push({
        entryType: "charge",
        amount: totalCharge,
        description: "Total charge logged from ERA 835 CLP03",
      });
    }

    if (insurancePayment > 0) {
      await createLedgerEntry(supabase, input.organizationId, row, {
        entryType: "insurance_payment",
        amount: insurancePayment,
        description: "Insurance payment posted from ERA 835 CLP04",
        sourceSegment: "CLP04",
      });
      result.effects.push({
        entryType: "insurance_payment",
        amount: insurancePayment,
        description: "Insurance payment posted from ERA 835 CLP04",
      });
    }

    for (const adj of casAdjustments) {
      const entryType = postingEntryTypeForCas(adj);
      const code = [adj.groupCode, adj.reasonCode].filter(Boolean).join("-");
      await createLedgerEntry(supabase, input.organizationId, row, {
        entryType,
        amount: adj.amount,
        groupCode: adj.groupCode,
        reasonCode: adj.reasonCode,
        description: code
          ? `${adj.descriptionPrefix} ${code} adjustment`
          : `${adj.descriptionPrefix} adjustment ${adj.index + 1}`,
        sourceSegment: adj.sourceSegment,
      });
      result.effects.push({
        entryType,
        amount: adj.amount,
        groupCode: adj.groupCode,
        reasonCode: adj.reasonCode,
        description: code
          ? `${adj.descriptionPrefix} ${code} adjustment`
          : `${adj.descriptionPrefix} adjustment ${adj.index + 1}`,
        sourceSegment: adj.sourceSegment,
      });
    }

    let patientInvoiceCreated = false;
    if (patientResponsibility > 0) {
      await createLedgerEntry(supabase, input.organizationId, row, {
        entryType: "patient_responsibility",
        amount: patientResponsibility,
        groupCode: "PR",
        description: "Client responsibility transferred from ERA 835 CLP05",
        sourceSegment: "CLP05",
      });
      result.effects.push({
        entryType: "patient_responsibility",
        amount: patientResponsibility,
        groupCode: "PR",
        description: "Client responsibility transferred from ERA 835 CLP05",
      });

      patientInvoiceCreated = await createPatientInvoiceIfNeeded(
        supabase,
        input.organizationId,
        row,
        actor,
        result.auditLogIds,
      );
      result.patientInvoiceCreated = patientInvoiceCreated;
    }

    if (row.client_id && !row.professional_claim_id) {
      await createClaimlessClientLedgerEntries(
        supabase,
        input.organizationId,
        row,
        {
          totalCharge,
          insurancePayment,
          patientResponsibility,
          casAdjustments,
          now,
        },
      );
      try {
        const { recalculatePatientBalance } =
          await import("@/lib/billing/recalculatePatientBalance");
        await recalculatePatientBalance({
          supabase,
          organizationId: input.organizationId,
          clientId: row.client_id,
        });
      } catch (balanceError) {
        console.warn(
          "[postingEngine] claimless balance recalculation failed (non-fatal)",
          balanceError instanceof Error ? balanceError.message : balanceError,
        );
      }
    }

    const { error: updateError } = await supabase
      .from("era_claim_payments")
      .update({ posting_status: "posted", updated_at: now })
      .eq("id", row.id)
      .eq("organization_id", input.organizationId);
    if (updateError) throw new Error(updateError.message);

    const newClaimStatus =
      insurancePayment > 0 || patientResponsibility > 0 ? "paid" : "denied";
    if (row.professional_claim_id) {
      const { error: claimUpdateError } = await supabase
        .from("professional_claims")
        .update({ claim_status: newClaimStatus, updated_at: now })
        .eq("id", row.professional_claim_id)
        .eq("organization_id", input.organizationId);
      if (claimUpdateError) throw new Error(claimUpdateError.message);
    }

    try {
      result.workqueueItemsClosed = await closeRelatedEraWorkqueueItems(
        supabase,
        input.organizationId,
        row.id,
        now,
      );
    } catch (workqueueError) {
      console.warn(
        "[postingEngine] failed to close related workqueue items",
        workqueueError instanceof Error
          ? workqueueError.message
          : workqueueError,
      );
    }

    // ── 5b. Auto-generate workqueue items per PP-5 rules ─────────────────
    try {
      const { applyWorkqueueRules } = await import("./workqueueRules");
      const allowed =
        Number(row.clp03_total_charge ?? 0) - contractualAdjustment;
      // Resolve the payer we posted under so cob_issue + eligibility_issue
      // rules can fire on ERA posts (those rules require postedPayerProfileId).
      // The claim's billing payer is the canonical "posted under" payer.
      let postedPayerProfileId: string | null = null;
      if (row.professional_claim_id) {
        try {
          const { data: claim } = await supabase
            .from("professional_claims")
            .select("payer_profile_id")
            .eq("id", row.professional_claim_id)
            .eq("organization_id", input.organizationId)
            .maybeSingle();
          postedPayerProfileId =
            (claim as { payer_profile_id: string | null } | null)
              ?.payer_profile_id ?? null;
        } catch {
          // best-effort; rule engine still runs without payer-scoped rules.
        }
      }
      await applyWorkqueueRules(supabase, {
        organizationId: input.organizationId,
        sourceObjectType: "era_claim_payment",
        sourceObjectId: row.id,
        professionalClaimId: row.professional_claim_id,
        clientId: row.client_id,
        insurancePaymentAmount: insurancePayment,
        allowedAmount: allowed > 0 ? allowed : null,
        totalChargeAmount: Number(row.clp03_total_charge ?? 0),
        casAdjustments: row.cas_adjustments,
        claimMatchStatus: row.claim_match_status,
        sourceKind: "era_835",
        postedPayerProfileId,
        actor,
      });
    } catch (ruleErr) {
      console.warn(
        "[postingEngine] applyWorkqueueRules failed (non-fatal)",
        ruleErr instanceof Error ? ruleErr.message : ruleErr,
      );
    }

    // ── 5c. Seed claim_workqueue_items 'partial_payment' (Task #485) ─────
    // When the payer paid > 0 but < billed, drop a persistent row into
    // claim_workqueue_items so the Partial Payments queue can track
    // assignment / deferral / days_in_ar per row instead of recomputing
    // on every page load. The GET route still falls back to a live ERA
    // scan for backfill where no row exists.
    try {
      const totalCharge = Number(row.clp03_total_charge ?? 0);
      if (
        row.professional_claim_id &&
        insurancePayment > 0 &&
        totalCharge > 0 &&
        insurancePayment < totalCharge
      ) {
        await seedPartialPaymentWqItem(supabase, {
          organizationId: input.organizationId,
          claimId: row.professional_claim_id,
          clientId: row.client_id,
          eraClaimPaymentId: row.id,
          billed: totalCharge,
          paid: insurancePayment,
        });
      }
    } catch (wqErr) {
      console.warn(
        "[postingEngine] seedPartialPaymentWqItem failed (non-fatal)",
        wqErr instanceof Error ? wqErr.message : wqErr,
      );
    }

    // ── 6. Audit ──────────────────────────────────────────────────────────
    const auditLog = await writePaymentAuditLog(supabase, {
      organizationId: input.organizationId,
      actor,
      action: "payment_posted",
      objectType: "era_claim_payment",
      objectId: row.id,
      claimId: row.professional_claim_id,
      beforeValue: { posting_status: row.posting_status, claim_status: null },
      afterValue: {
        posting_status: "posted",
        claim_status: row.professional_claim_id ? newClaimStatus : null,
        total_charge: totalCharge,
        insurance_payment: insurancePayment,
        contractual_adjustment: contractualAdjustment,
        patient_responsibility: patientResponsibility,
        cas_adjustments: casAdjustments.map((adj) => ({
          group_code: adj.groupCode,
          reason_code: adj.reasonCode,
          amount: adj.amount,
          source_segment: adj.sourceSegment,
          line_number: adj.lineNumber ?? null,
          procedure_code: adj.procedureCode ?? null,
          service_date: adj.serviceDate ?? null,
        })),
      },
      summary: `Posted ERA 835 claim ${row.clp01_claim_control_number}: ${result.effects.length} ledger entr${result.effects.length === 1 ? "y" : "ies"}.`,
      metadata: {
        source: "era_835",
        clp01: row.clp01_claim_control_number,
        warnings: result.validation.warning.map((w) => w.code),
      },
    });
    if (auditLog) result.auditLogIds.push(auditLog.id);

    result.ok = true;
    result.posted = true;
    return result;
  } catch (error) {
    result.errors.push({
      field: row.clp01_claim_control_number,
      message:
        error instanceof Error
          ? error.message
          : "Failed to post ERA claim payment",
    });
    return result;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function createLedgerEntry(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  payment: EraClaimPaymentRow,
  effect: PostingLedgerEffect,
) {
  let existingQuery = supabase
    .from("era_posting_ledger_entries")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("era_claim_payment_id", payment.id)
    .eq("entry_type", effect.entryType)
    .is("archived_at", null)
    .limit(1);
  if (effect.sourceSegment) {
    existingQuery = existingQuery.eq("source_segment", effect.sourceSegment);
  } else {
    existingQuery = existingQuery.is("source_segment", null);
  }
  const { data: existing, error: existingError } =
    await existingQuery.maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return;

  const { error } = await supabase.from("era_posting_ledger_entries").insert({
    organization_id: organizationId,
    era_claim_payment_id: payment.id,
    source_type: "era_835",
    source_id: payment.id,
    professional_claim_id: payment.professional_claim_id,
    client_id: payment.client_id,
    entry_type: effect.entryType,
    amount: effect.amount,
    group_code: effect.groupCode ?? null,
    reason_code: effect.reasonCode ?? null,
    description: effect.description,
    source_segment: effect.sourceSegment ?? null,
  });
  if (error) {
    // Race (Task #184): partial unique index
    // idx_era_posting_ledger_entries_unique_active on
    // (organization_id, era_claim_payment_id, entry_type, source_segment) raised 23505.
    // Another concurrent posting attempt wrote the same ledger row between
    // our SELECT and INSERT. Treat as already-posted and return — the
    // winner's row is the canonical one.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return;
    throw new Error(error.message);
  }
}

interface ClaimlessClientLedgerArgs {
  totalCharge: number;
  insurancePayment: number;
  patientResponsibility: number;
  casAdjustments: NormalizedCasAdjustment[];
  now: string;
}

interface ClientLedgerEntryEffect {
  referenceSuffix: string;
  entryType: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  balanceEffect: number;
  groupCode?: string | null;
  reasonCode?: string | null;
  sourceSegment?: string | null;
  serviceDate?: string | null;
  metadata?: Record<string, unknown>;
}

async function createClaimlessClientLedgerEntries(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  payment: EraClaimPaymentRow,
  args: ClaimlessClientLedgerArgs,
) {
  if (!payment.client_id) return;
  const payerAdjustmentTotal = nonPatientAdjustmentTotal(args.casAdjustments);
  const computedResidual = round2(
    args.totalCharge - args.insurancePayment - payerAdjustmentTotal,
  );
  const commonMetadata = {
    clp01_claim_control_number: payment.clp01_claim_control_number,
    claimless_post: true,
    clp03_total_charge: args.totalCharge,
    clp04_payment_amount: args.insurancePayment,
    clp05_patient_responsibility: args.patientResponsibility,
  };

  const entries: ClientLedgerEntryEffect[] = [];
  if (args.totalCharge > 0) {
    entries.push({
      referenceSuffix: "charge",
      entryType: "charge",
      description: "Total charge logged from claimless ERA",
      debitAmount: args.totalCharge,
      creditAmount: 0,
      balanceEffect: args.totalCharge,
      sourceSegment: "CLP03",
      metadata: commonMetadata,
    });
  }
  for (const adj of args.casAdjustments) {
    const entryType = postingEntryTypeForCas(adj);
    const code = [adj.groupCode, adj.reasonCode].filter(Boolean).join("-");
    const amount = Math.abs(adj.amount);
    const isPatientResponsibility = adj.groupCode === "PR";
    entries.push({
      referenceSuffix: adj.sourceSegment
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
      entryType,
      description: code
        ? `${adj.descriptionPrefix} ${code} adjustment`
        : `${adj.descriptionPrefix} adjustment ${adj.index + 1}`,
      debitAmount: !isPatientResponsibility && adj.amount < 0 ? amount : 0,
      creditAmount: !isPatientResponsibility && adj.amount > 0 ? amount : 0,
      balanceEffect: isPatientResponsibility
        ? 0
        : adj.amount < 0
          ? amount
          : -amount,
      groupCode: adj.groupCode,
      reasonCode: adj.reasonCode,
      sourceSegment: adj.sourceSegment,
      serviceDate: adj.serviceDate,
      metadata: {
        ...commonMetadata,
        line_number: adj.lineNumber ?? null,
        procedure_code: adj.procedureCode ?? null,
        service_date: adj.serviceDate ?? null,
      },
    });
  }
  if (args.insurancePayment > 0) {
    entries.push({
      referenceSuffix: "payment",
      entryType: "insurance_payment",
      description: "Insurance payment logged from claimless ERA",
      debitAmount: 0,
      creditAmount: args.insurancePayment,
      balanceEffect: -args.insurancePayment,
      sourceSegment: "CLP04",
      metadata: commonMetadata,
    });
  }
  if (args.patientResponsibility > 0) {
    entries.push({
      referenceSuffix: "patient-responsibility",
      entryType: "patient_responsibility",
      description:
        "Patient responsibility retained as the remaining account balance",
      debitAmount: 0,
      creditAmount: 0,
      balanceEffect: 0,
      groupCode: "PR",
      sourceSegment: "CLP05",
      metadata: {
        ...commonMetadata,
        computed_residual_balance: computedResidual,
      },
    });
  }

  for (const entry of entries) {
    await createClientLedgerEntry(
      supabase,
      organizationId,
      payment,
      entry,
      args.now,
    );
  }
}

async function createClientLedgerEntry(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  payment: EraClaimPaymentRow,
  entry: ClientLedgerEntryEffect,
  now: string,
) {
  if (!payment.client_id) return;
  const referenceNumber = `${payment.id}:${entry.referenceSuffix}`;
  const { data: existing, error: existingError } = await supabase
    .from("client_ledger_entries")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source_type", "era_payment")
    .eq("reference_number", referenceNumber)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return;

  const { error } = await supabase.from("client_ledger_entries").insert({
    organization_id: organizationId,
    client_id: payment.client_id,
    professional_claim_id: null,
    era_claim_payment_id: payment.id,
    source_type: "era_payment",
    source_id: payment.id,
    entry_type: entry.entryType,
    description: entry.description,
    debit_amount: entry.debitAmount,
    credit_amount: entry.creditAmount,
    balance_effect: entry.balanceEffect,
    group_code: entry.groupCode ?? null,
    reason_code: entry.reasonCode ?? null,
    source_segment: entry.sourceSegment ?? null,
    service_date: entry.serviceDate ?? null,
    posting_date: now.slice(0, 10),
    reference_number: referenceNumber,
    metadata: entry.metadata ?? {},
    created_at: now,
    updated_at: now,
  });
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return;
    throw new Error(error.message);
  }
}

async function createPatientInvoiceIfNeeded(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  payment: EraClaimPaymentRow,
  actor: PostingActor,
  auditSink: string[],
): Promise<boolean> {
  const responsibility = Number(payment.clp05_patient_responsibility ?? 0);
  if (
    responsibility <= 0 ||
    !payment.client_id ||
    !payment.professional_claim_id
  )
    return false;

  const { data: existing } = await supabase
    .from("patient_invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("era_claim_payment_id", payment.id)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return false;

  const { data: inserted, error } = await supabase
    .from("patient_invoices")
    .insert({
      organization_id: organizationId,
      client_id: payment.client_id,
      professional_claim_id: payment.professional_claim_id,
      era_claim_payment_id: payment.id,
      invoice_status: "open",
      invoice_number: invoiceNumber(payment.id),
      patient_responsibility_amount: responsibility,
      paid_amount: 0,
      balance_amount: responsibility,
      source: "era_pr",
    })
    .select("id")
    .single();

  if (error) {
    // Race (Task #184): partial unique index
    // idx_patient_invoices_unique_active_era_payment on
    // (organization_id, era_claim_payment_id) raised 23505. Another
    // concurrent posting attempt already created the invoice — treat as
    // "no new invoice from this caller" rather than failing the post.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return false;
    throw new Error(error.message);
  }
  if (!inserted) return false;

  const audit = await writePaymentAuditLog(supabase, {
    organizationId,
    actor,
    action: "patient_invoice_created",
    objectType: "patient_invoice",
    objectId: String((inserted as { id: string }).id),
    claimId: payment.professional_claim_id,
    afterValue: {
      patient_responsibility_amount: responsibility,
      invoice_number: invoiceNumber(payment.id),
      source: "era_pr",
    },
    summary: `Client invoice ${invoiceNumber(payment.id)} created from ERA PR balance ${responsibility.toFixed(2)}`,
  });
  if (audit) auditSink.push(audit.id);

  // Best-effort autopay: if the client has autopay on with a saved
  // card, charge the freshly-created invoice's PR balance immediately.
  try {
    const { attemptAutopayForInvoice } =
      await import("@/lib/payments/autopayService");
    await attemptAutopayForInvoice({
      organizationId,
      patientInvoiceId: String((inserted as { id: string }).id),
      supabase,
    });
  } catch (autopayErr) {
    console.warn(
      "[postingEngine] autopay attempt failed (non-fatal)",
      autopayErr instanceof Error ? autopayErr.message : autopayErr,
    );
  }

  return true;
}

async function closeRelatedEraWorkqueueItems(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  organizationId: string,
  eraClaimPaymentId: string,
  now: string,
): Promise<number> {
  // Schema invariant (.agents/memory/workqueue-items-schema.md):
  // workqueue_items.source_object_type is a Postgres ENUM that does NOT
  // include `era_claim_payment`. The insert path in workqueueRules.ts
  // stores rows as source_object_type='payment_posting' with the original
  // logical kind stashed in context_payload.logical_source_object_type.
  // Filtering by the old logical literal would silently return zero rows
  // and leave the ERA sweeps unable to close anything.
  const { data, error } = await supabase
    .from("workqueue_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source_object_type", "payment_posting")
    .eq("source_object_id", eraClaimPaymentId)
    .contains("context_payload", {
      logical_source_object_type: "era_claim_payment",
    })
    .in("work_type", ["era_mismatch", "era_835_exception"])
    .in("status", ["open", "in_progress", "blocked"])
    .is("archived_at", null);
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;

  const { error: updateError } = await supabase
    .from("workqueue_items")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .in("id", ids);
  if (updateError) throw new Error(updateError.message);
  return ids.length;
}

interface SeedPartialPaymentArgs {
  organizationId: string;
  claimId: string;
  clientId: string | null;
  eraClaimPaymentId: string;
  billed: number;
  paid: number;
}

/**
 * Idempotently upsert a `claim_workqueue_items` row tagged
 * item_status='partial_payment' for the given claim. Priority is derived
 * from the remaining balance (≥1000 → urgent, ≥300 → high, else normal)
 * so freshly-posted partials surface at the top of the queue. If a non-
 * partial row already exists for this claim (e.g. denial follow-up), we
 * leave it alone — the action route will resolve only rows tagged
 * partial_payment to avoid clobbering unrelated work.
 */
async function seedPartialPaymentWqItem(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>,
  args: SeedPartialPaymentArgs,
): Promise<void> {
  const remaining = Math.max(0, args.billed - args.paid);
  const priority: "low" | "normal" | "high" | "urgent" =
    remaining >= 1000 ? "urgent" : remaining >= 300 ? "high" : "normal";

  const { data: existing, error: existingErr } = await supabase
    .from("claim_workqueue_items")
    .select("id, item_status")
    .eq("organization_id", args.organizationId)
    .eq("claim_id", args.claimId)
    .eq("item_status", "partial_payment")
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  const nowIso = new Date().toISOString();
  if (existing?.id) {
    const { error } = await supabase
      .from("claim_workqueue_items")
      .update({
        era_claim_payment_id: args.eraClaimPaymentId,
        priority,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("claim_workqueue_items").insert({
    organization_id: args.organizationId,
    claim_id: args.claimId,
    client_id: args.clientId,
    era_claim_payment_id: args.eraClaimPaymentId,
    item_status: "partial_payment",
    priority,
  });
  if (error) {
    // 23505 = race on a concurrent insert; treat as success.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return;
    throw new Error(error.message);
  }
}
