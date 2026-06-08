/**
 * Backwards-compat shim for the ERA 835 posting service.
 *
 * As of Task #107 (Payment Posting — Foundation), all ledger writes go
 * through the centralised posting engine in `lib/payments/postingEngine`.
 * This module re-exports the same public surface (`postEra835Batch`,
 * `postSingleEra835ClaimPayment`) so existing callers (API routes,
 * imports, UI server actions) keep working unchanged — they now route to
 * `commitPosting` under the hood with a `system` actor.
 *
 * Callers that have a resolved authenticated staff member should call
 * `commitPosting` directly and supply a real `PostingActor` — that path
 * also writes a richer audit log row with user_id / role.
 */

import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  commitPosting,
  type PostingActor,
} from "@/lib/payments/postingEngine";
import { parseEra835 } from "@/lib/payments/era835Parser";
import { detectAndSeedTakebacks } from "@/lib/payments/postingEngine/eraTakebackDetection";

export interface PostEra835BatchInput {
  organizationId: string;
  eraImportBatchId: string;
  /** Optional — when omitted, a `system` actor is used. */
  actor?: PostingActor;
}

export interface PostEra835BatchResult {
  ok: boolean;
  postedClaims: number;
  blockedClaims: number;
  patientInvoicesCreated: number;
  errors: Array<{ field: string; message: string }>;
  /**
   * Non-fatal anomalies surfaced by the post-pass take-back detector
   * (e.g. PLB WO referencing an unknown claim control number). These
   * are deliberately kept out of `errors` so they cannot downgrade
   * `import_status` to `blocked` or flip `ok` to false.
   */
  warnings?: Array<{ field: string; message: string }>;
}

export interface PostSingleEra835ClaimPaymentInput {
  organizationId: string;
  eraClaimPaymentId: string;
  /** Optional — when omitted, a `system` actor is used. */
  actor?: PostingActor;
}

export interface PostSingleEra835ClaimPaymentResult {
  ok: boolean;
  posted: boolean;
  alreadyPosted: boolean;
  blocked: boolean;
  patientInvoiceCreated: boolean;
  workqueueItemsClosed: number;
  errors: Array<{ field: string; message: string }>;
}

export async function postEra835Batch(
  input: PostEra835BatchInput,
): Promise<PostEra835BatchResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      postedClaims: 0,
      blockedClaims: 0,
      patientInvoicesCreated: 0,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const { data: payments, error: paymentError } = await supabase
    .from("era_claim_payments")
    .select("id, claim_match_status, posting_status")
    .eq("organization_id", input.organizationId)
    .eq("era_import_batch_id", input.eraImportBatchId)
    .is("archived_at", null);

  if (paymentError) {
    return {
      ok: false,
      postedClaims: 0,
      blockedClaims: 0,
      patientInvoicesCreated: 0,
      errors: [{ field: "era_claim_payments", message: paymentError.message }],
    };
  }

  let postedClaims = 0;
  let blockedClaims = 0;
  let patientInvoicesCreated = 0;
  const errors: Array<{ field: string; message: string }> = [];

  // Validation codes that represent "row is not postable yet" rather than a
  // commit failure. Legacy batch behaviour was to silently skip these
  // (counting them as blocked); preserve that so the batch's overall
  // `ok` / `import_status` only flips when something truly broke.
  const SKIPPABLE_VALIDATION_CODES = new Set([
    "claim_not_matched",
    "posting_status_blocked",
  ]);

  for (const row of payments ?? []) {
    const result = await commitPosting({
      organizationId: input.organizationId,
      source: { type: "era_835", eraClaimPaymentId: String((row as { id: string }).id) },
      actor: input.actor ?? null,
    });

    if (result.alreadyPosted || result.posted) postedClaims += 1;
    if (result.blocked) blockedClaims += 1;
    if (result.patientInvoiceCreated) patientInvoicesCreated += 1;

    if (result.errors.length > 0) {
      const isOnlySkippableBlocked =
        result.blocked &&
        !result.posted &&
        result.validation.blocking.every((issue) =>
          SKIPPABLE_VALIDATION_CODES.has(issue.code),
        );

      if (!isOnlySkippableBlocked) {
        errors.push(...result.errors);
      }
    }
  }

  // Decide import_status BEFORE running take-back detection. Take-back
  // detection is a best-effort post-pass: a payer sending a take-back we
  // can't match (unknown PCN), or a transient workqueue insert failure,
  // must NOT downgrade an otherwise successfully-posted batch to
  // `blocked` — operations would have to manually unblock perfectly
  // good ERAs. Only the per-claim posting loop above gates import_status.
  const importStatus = errors.length > 0 ? "blocked" : "posted";

  // Auto-seed payer take-backs into the Recoupments queue. All failures
  // here are collected as warnings (separate from `errors`) and surfaced
  // to the caller without affecting `ok` / `import_status`.
  const takebackWarnings: Array<{ field: string; message: string }> = [];
  try {
    const { data: batchRow } = await supabase
      .from("era_import_batches")
      .select("raw_content")
      .eq("id", input.eraImportBatchId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const rawContent = batchRow ? (batchRow as { raw_content?: string | null }).raw_content : null;
    if (rawContent) {
      const parsed = parseEra835(rawContent);
      const takebackResult = await detectAndSeedTakebacks(supabase, {
        organizationId: input.organizationId,
        eraImportBatchId: input.eraImportBatchId,
        parsed,
        actor: input.actor ?? undefined,
      });
      for (const e of takebackResult.errors) {
        takebackWarnings.push({
          field: `takeback:${e.field}`,
          message: e.message,
        });
      }
    }
  } catch (err) {
    takebackWarnings.push({
      field: "takeback_detection",
      message: err instanceof Error ? err.message : "ERA take-back detection failed.",
    });
  }

  await supabase
    .from("era_import_batches")
    .update({
      import_status: importStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.eraImportBatchId)
    .eq("organization_id", input.organizationId);

  return {
    ok: errors.length === 0,
    postedClaims,
    blockedClaims,
    patientInvoicesCreated,
    errors,
    warnings: takebackWarnings.length > 0 ? takebackWarnings : undefined,
  };
}

export async function postSingleEra835ClaimPayment(
  input: PostSingleEra835ClaimPaymentInput,
): Promise<PostSingleEra835ClaimPaymentResult> {
  const result = await commitPosting({
    organizationId: input.organizationId,
    source: { type: "era_835", eraClaimPaymentId: input.eraClaimPaymentId },
    actor: input.actor ?? null,
  });

  return {
    ok: result.ok,
    posted: result.posted,
    alreadyPosted: result.alreadyPosted,
    blocked: result.blocked,
    patientInvoiceCreated: result.patientInvoiceCreated,
    workqueueItemsClosed: result.workqueueItemsClosed,
    errors: result.errors,
  };
}
