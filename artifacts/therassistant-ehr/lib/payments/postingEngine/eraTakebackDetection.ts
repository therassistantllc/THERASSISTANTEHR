/**
 * ERA take-back auto-detection (Task #470).
 *
 * Scans a freshly-imported ERA 835 batch for payer take-backs and seeds
 * the Recoupments / Takebacks queue (`/billing/recoupments`) without
 * waiting for a biller to enter them by hand.
 *
 * Two signal classes are recognised:
 *
 *  1. Negative claim-level payment (CLP04 < 0, often paired with
 *     `CLP02='22'` — Reversal of Previous Payment). The CURRENT ERA row
 *     represents the take-back; the ORIGINAL posted payment is the
 *     `source_era_claim_payment_id`. We look up that original by the
 *     payer-claim-control-number (CLP07) — failing that, the
 *     provider-side claim control number (CLP01).
 *
 *  2. PLB segments with recoupment-class adjustment reason codes:
 *       - WO — Overpayment Recovery (most common take-back)
 *       - FB — Forwarding Balance
 *       - J1 — Nonreimbursable adjustment
 *       - 72 — Authorised return
 *     PLB04 is signed: POSITIVE = money pulled back from the provider
 *     (a take-back), negative = money returned. We only seed for the
 *     positive-magnitude case. PLB03's reference identifier (right-half
 *     of the composite) points at the original payer claim control
 *     number being recouped.
 *
 * For both signal classes the `offset_era_claim_payment_id` is set to one
 * of the positive-pay era_claim_payments in the CURRENT batch when the
 * net check is positive — that's what makes the row land in the
 * "Offset Against Future Payments" tab. When the current batch's net is
 * zero/negative (a refund-due scenario), the offset is left null.
 *
 * We INSERT directly rather than going through `recordRecoupment` because
 * that engine path requires the source payment's `posting_status === 'posted'`
 * (a biller-initiated guardrail). Auto-ingest can fire before or after
 * the source's posting flow has run, and we don't want a stuck posting
 * status to drop a take-back signal on the floor.
 *
 * Idempotency: re-running detection on the same batch must not double-seed.
 * We dedupe on `(organization_id, source_era_claim_payment_id,
 * offset_era_claim_payment_id, amount, reason_code)`, mirroring the natural
 * "one take-back per payer event per source check" invariant.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Era835ParsedFile,
  Era835ClaimPayment,
  Era835ProviderAdjustment,
} from "@/lib/payments/era835Parser";
import { applyWorkqueueRules } from "./workqueueRules";
import type { PostingActor } from "./types";

/** PLB adjustment reason codes that represent a payer take-back. */
const RECOUPMENT_PLB_CODES = new Set(["WO", "FB", "J1", "72"]);

/**
 * CLP02 claim status codes that mean "this is a reversal of a previously
 * paid claim" — usually paired with a negative CLP04. We treat either
 * signal (status=22 OR clp04 < 0) as enough on its own.
 */
const REVERSAL_CLP_STATUS_CODES = new Set(["22"]);

const SYSTEM_ACTOR: PostingActor = {
  staffId: null,
  userId: null,
  role: "system",
  source: "service:era-takeback-detection",
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function isClaimTakeback(claim: Era835ClaimPayment): boolean {
  if (Number(claim.clp04PaymentAmount) < 0) return true;
  if (claim.clp02ClaimStatusCode &&
      REVERSAL_CLP_STATUS_CODES.has(text(claim.clp02ClaimStatusCode))) {
    return true;
  }
  return false;
}

function isPlbTakeback(adj: Era835ProviderAdjustment): boolean {
  return RECOUPMENT_PLB_CODES.has(adj.adjustmentReasonCode) && Number(adj.amount) > 0;
}

export interface DetectAndSeedTakebacksInput {
  organizationId: string;
  /** Batch we just imported. */
  eraImportBatchId: string;
  /** Output of parseEra835 for the same raw content. */
  parsed: Era835ParsedFile;
  actor?: PostingActor;
}

export interface DetectedTakeback {
  /** 'clp_reversal' (negative-pay claim) or 'plb' (provider-level adjustment). */
  kind: "clp_reversal" | "plb";
  /** Amount taken back (always positive). */
  amount: number;
  /** Adjustment reason code (e.g. WO/FB/J1/72) or CLP02 for clp_reversal. */
  reasonCode: string | null;
  /** Original payer claim control number used to match the source payment. */
  payerClaimControlNumber: string | null;
  /** Original provider-side claim control number used as a fallback match. */
  providerClaimControlNumber: string | null;
  /** Resolved source era_claim_payments.id, or null if no match. */
  sourceEraClaimPaymentId: string | null;
  /** Offset era_claim_payments.id within the CURRENT batch, or null. */
  offsetEraClaimPaymentId: string | null;
  /** Inserted payment_recoupments.id, or null on dedupe / matching failure. */
  recoupmentId: string | null;
  /** Inserted workqueue_items.id, or null when dedupe skipped the rule run. */
  workqueueItemId: string | null;
  /** True when an existing recoupment with the same dedupe key was found. */
  deduped: boolean;
}

export interface DetectAndSeedTakebacksResult {
  detected: DetectedTakeback[];
  /** Rows inserted (excluding deduped). */
  recoupmentsCreated: number;
  workqueueItemsCreated: number;
  errors: Array<{ field: string; message: string }>;
}

/**
 * Detect take-backs in `parsed` and seed payment_recoupments rows.
 * Safe to call multiple times for the same batch; dedupes on natural key.
 */
export async function detectAndSeedTakebacks(
  supabase: SupabaseClient,
  input: DetectAndSeedTakebacksInput,
): Promise<DetectAndSeedTakebacksResult> {
  const actor = input.actor ?? SYSTEM_ACTOR;
  const result: DetectAndSeedTakebacksResult = {
    detected: [],
    recoupmentsCreated: 0,
    workqueueItemsCreated: 0,
    errors: [],
  };

  // ── 1. Collect take-back signals from the parsed ERA ──────────────────────
  type Signal = {
    kind: "clp_reversal" | "plb";
    amount: number;
    reasonCode: string | null;
    payerClaimControlNumber: string | null;
    providerClaimControlNumber: string | null;
    /** Human-readable description for the recoupment row. */
    description: string;
  };
  const signals: Signal[] = [];

  for (const claim of input.parsed.claims) {
    if (!isClaimTakeback(claim)) continue;
    const amount = round2(Math.abs(Number(claim.clp04PaymentAmount)));
    if (amount <= 0) continue;
    signals.push({
      kind: "clp_reversal",
      amount,
      reasonCode: text(claim.clp02ClaimStatusCode) || null,
      payerClaimControlNumber: claim.payerClaimControlNumber,
      providerClaimControlNumber: claim.clp01ClaimControlNumber,
      description: `Payer reversal (CLP02=${text(claim.clp02ClaimStatusCode) || "n/a"}) of claim ${claim.payerClaimControlNumber ?? claim.clp01ClaimControlNumber}`,
    });
  }

  for (const adj of input.parsed.providerAdjustments) {
    if (!isPlbTakeback(adj)) continue;
    signals.push({
      kind: "plb",
      amount: round2(Math.abs(Number(adj.amount))),
      reasonCode: adj.adjustmentReasonCode,
      payerClaimControlNumber: adj.referenceIdentifier,
      providerClaimControlNumber: null,
      description: `Provider-level take-back (PLB ${adj.adjustmentReasonCode}${adj.referenceIdentifier ? ` ref ${adj.referenceIdentifier}` : ""})`,
    });
  }

  if (signals.length === 0) return result;

  // ── 2. Pull the rows we just inserted for THIS batch (offset candidates) ──
  const { data: batchRowsRaw, error: batchErr } = await supabase
    .from("era_claim_payments")
    .select(
      "id, clp01_claim_control_number, payer_claim_control_number, clp04_payment_amount, professional_claim_id, client_id",
    )
    .eq("organization_id", input.organizationId)
    .eq("era_import_batch_id", input.eraImportBatchId)
    .is("archived_at", null);
  if (batchErr) {
    result.errors.push({ field: "era_claim_payments", message: batchErr.message });
    return result;
  }
  const batchRows = (batchRowsRaw ?? []) as Array<Record<string, unknown>>;

  // Pick the largest positive-pay row in this batch as the canonical
  // "this is the check that nets the take-back out" link target. Falls
  // back to null when the batch has no positive pays (refund-due case).
  const positivePayRows = batchRows
    .filter((r) => Number(r.clp04_payment_amount ?? 0) > 0)
    .sort(
      (a, b) =>
        Number(b.clp04_payment_amount ?? 0) - Number(a.clp04_payment_amount ?? 0),
    );
  const defaultOffsetId =
    positivePayRows.length > 0 ? text(positivePayRows[0].id) : null;

  // Index THIS batch by payer-claim-control-number so the negative-pay
  // "reversal" CLP row can identify itself as the take-back row (so we
  // never set source = offset = same row).
  const batchByPayerCcn = new Map<string, Record<string, unknown>>();
  const batchByProviderCcn = new Map<string, Record<string, unknown>>();
  for (const r of batchRows) {
    const payerCcn = text(r.payer_claim_control_number);
    const providerCcn = text(r.clp01_claim_control_number);
    if (payerCcn && !batchByPayerCcn.has(payerCcn)) batchByPayerCcn.set(payerCcn, r);
    if (providerCcn && !batchByProviderCcn.has(providerCcn)) {
      batchByProviderCcn.set(providerCcn, r);
    }
  }

  // ── 3. For each signal, resolve source + offset, dedupe, insert ───────────
  for (const sig of signals) {
    const detected: DetectedTakeback = {
      kind: sig.kind,
      amount: sig.amount,
      reasonCode: sig.reasonCode,
      payerClaimControlNumber: sig.payerClaimControlNumber,
      providerClaimControlNumber: sig.providerClaimControlNumber,
      sourceEraClaimPaymentId: null,
      offsetEraClaimPaymentId: null,
      recoupmentId: null,
      workqueueItemId: null,
      deduped: false,
    };

    // 3a. Look up the ORIGINAL posted ERA payment that this take-back recoups.
    let sourceRow: Record<string, unknown> | null = null;
    if (sig.payerClaimControlNumber) {
      const { data } = await supabase
        .from("era_claim_payments")
        .select(
          "id, era_import_batch_id, professional_claim_id, client_id, payer_claim_control_number, clp01_claim_control_number",
        )
        .eq("organization_id", input.organizationId)
        .eq("payer_claim_control_number", sig.payerClaimControlNumber)
        .neq("era_import_batch_id", input.eraImportBatchId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sourceRow = (data as Record<string, unknown> | null) ?? null;
    }
    if (!sourceRow && sig.providerClaimControlNumber) {
      const { data } = await supabase
        .from("era_claim_payments")
        .select(
          "id, era_import_batch_id, professional_claim_id, client_id, payer_claim_control_number, clp01_claim_control_number",
        )
        .eq("organization_id", input.organizationId)
        .eq("clp01_claim_control_number", sig.providerClaimControlNumber)
        .neq("era_import_batch_id", input.eraImportBatchId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sourceRow = (data as Record<string, unknown> | null) ?? null;
    }

    // If we found no historical match, fall back to the CURRENT batch's
    // matching row — that's the case where a payer sends both the
    // reversal entry AND the original payment in the same ERA (or where
    // the prior payment was never imported). Better to anchor the
    // recoupment to *something* than to lose the signal entirely.
    if (!sourceRow) {
      if (sig.payerClaimControlNumber) {
        sourceRow = batchByPayerCcn.get(sig.payerClaimControlNumber) ?? null;
      }
      if (!sourceRow && sig.providerClaimControlNumber) {
        sourceRow = batchByProviderCcn.get(sig.providerClaimControlNumber) ?? null;
      }
    }

    detected.sourceEraClaimPaymentId = sourceRow ? text(sourceRow.id) || null : null;

    // 3b. Offset = a positive-pay row in THIS batch ≠ the source row.
    if (defaultOffsetId && detected.sourceEraClaimPaymentId !== defaultOffsetId) {
      detected.offsetEraClaimPaymentId = defaultOffsetId;
    } else if (positivePayRows.length > 0) {
      const alt = positivePayRows.find(
        (r) => text(r.id) !== detected.sourceEraClaimPaymentId,
      );
      detected.offsetEraClaimPaymentId = alt ? text(alt.id) : null;
    }

    if (!detected.sourceEraClaimPaymentId) {
      // No way to anchor the recoupment to a source ERA payment; skip
      // and surface as a parse-time anomaly the importer can review.
      result.errors.push({
        field: sig.kind,
        message: `Take-back signal (${sig.reasonCode ?? sig.kind}, ${sig.amount.toFixed(2)}) could not be matched to a source ERA payment (ref ${sig.payerClaimControlNumber ?? sig.providerClaimControlNumber ?? "n/a"}).`,
      });
      result.detected.push(detected);
      continue;
    }

    // 3c. Dedupe — already seeded?
    // reason_code is nullable in payment_recoupments and we INSERT
    // whatever sig.reasonCode is (incl. null for CLP04<0 with no CLP02).
    // Use `.is(reason_code, null)` for null sigs — `.eq(reason_code, "")`
    // would never match the persisted NULL and we'd duplicate on replay.
    let dedupeQuery = supabase
      .from("payment_recoupments")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("source_era_claim_payment_id", detected.sourceEraClaimPaymentId)
      .eq("amount", sig.amount)
      .is("archived_at", null);
    dedupeQuery =
      sig.reasonCode == null || sig.reasonCode === ""
        ? dedupeQuery.is("reason_code", null)
        : dedupeQuery.eq("reason_code", sig.reasonCode);
    const { data: existingRaw } = await dedupeQuery.limit(1).maybeSingle();
    if (existingRaw && (existingRaw as { id?: string }).id) {
      detected.deduped = true;
      detected.recoupmentId = String((existingRaw as { id: string }).id);
      result.detected.push(detected);
      continue;
    }

    // 3d. Insert the payment_recoupments row.
    const sourceProfessionalClaimId = sourceRow
      ? (text(sourceRow.professional_claim_id) || null)
      : null;
    const sourceClientId = sourceRow
      ? (text(sourceRow.client_id) || null)
      : null;

    const { data: insertedRaw, error: insErr } = await supabase
      .from("payment_recoupments")
      .insert({
        organization_id: input.organizationId,
        source_era_claim_payment_id: detected.sourceEraClaimPaymentId,
        source_client_payment_id: null,
        offset_era_claim_payment_id: detected.offsetEraClaimPaymentId,
        professional_claim_id: sourceProfessionalClaimId,
        client_id: sourceClientId,
        payer_profile_id: null,
        amount: sig.amount,
        reason_code: sig.reasonCode,
        reason: sig.description,
        recouped_by_actor_id: null,
      })
      .select("id")
      .single();
    if (insErr || !insertedRaw) {
      result.errors.push({
        field: "payment_recoupments",
        message: insErr?.message ?? "Failed to insert payment_recoupments row.",
      });
      result.detected.push(detected);
      continue;
    }
    detected.recoupmentId = String((insertedRaw as { id: string }).id);
    result.recoupmentsCreated += 1;

    // 3e. Open a workqueue follow-up via the shared rule engine so the
    // take-back surfaces in the queue without manual triage. Reuses the
    // dedupe + audit machinery instead of re-implementing it here.
    try {
      const wq = await applyWorkqueueRules(supabase, {
        organizationId: input.organizationId,
        sourceObjectType: "payment_recoupment",
        sourceObjectId: detected.recoupmentId,
        professionalClaimId: sourceProfessionalClaimId,
        clientId: sourceClientId,
        sourceKind: "recoupment",
        actor,
      });
      if (wq.itemIds.length > 0) {
        detected.workqueueItemId = wq.itemIds[0];
        result.workqueueItemsCreated += wq.itemIds.length;
        // Link the workqueue item back onto the recoupment row.
        await supabase
          .from("payment_recoupments")
          .update({ workqueue_item_id: detected.workqueueItemId })
          .eq("id", detected.recoupmentId)
          .eq("organization_id", input.organizationId);
      }
    } catch (err) {
      // Non-fatal: the recoupment row is the source of truth; the
      // workqueue rule engine can be re-run from the cron sweep.
      result.errors.push({
        field: "workqueue_items",
        message: err instanceof Error ? err.message : "applyWorkqueueRules failed",
      });
    }

    result.detected.push(detected);
  }

  return result;
}
