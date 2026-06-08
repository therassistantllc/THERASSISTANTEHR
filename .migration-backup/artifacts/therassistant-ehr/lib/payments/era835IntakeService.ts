import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { parseEra835, type Era835ClaimPayment } from "@/lib/payments/era835Parser";
import {
  detectEraDocumentationRequest,
  writeMedicalReviewRequestAudit,
} from "@/lib/medical-review/documentationRequestDetection";

export interface IntakeEra835Input {
  organizationId: string;
  rawContent: string;
  fileName?: string | null;
  source?: string | null;
}

export interface IntakeEra835Result {
  ok: boolean;
  batchId: string | null;
  totalClaims: number;
  matchedClaims: number;
  unmatchedClaims: number;
  errors: Array<{ field: string; message: string }>;
}

type ClaimMatch = {
  id: string;
  patient_id: string | null;
};

export async function matchProfessionalClaim(organizationId: string, claimControlNumber: string): Promise<ClaimMatch | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error } = await supabase
    .from("professional_claims")
    .select("id, patient_id")
    .eq("organization_id", organizationId)
    .or(`claim_number.eq.${claimControlNumber},patient_account_number.eq.${claimControlNumber}`)
    .limit(2);

  if (error) throw new Error(error.message);
  if (!data || data.length !== 1) return null;
  return data[0] as ClaimMatch;
}

function sumPatientResponsibility(claims: Era835ClaimPayment[]) {
  return claims.reduce((sum, claim) => sum + claim.clp05PatientResponsibility, 0);
}

export async function intakeEra835(input: IntakeEra835Input): Promise<IntakeEra835Result> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      batchId: null,
      totalClaims: 0,
      matchedClaims: 0,
      unmatchedClaims: 0,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  if (!input.rawContent?.trim()) {
    return {
      ok: false,
      batchId: null,
      totalClaims: 0,
      matchedClaims: 0,
      unmatchedClaims: 0,
      errors: [{ field: "rawContent", message: "835 ERA content is required" }],
    };
  }

  const parsed = parseEra835(input.rawContent);

  // ── Duplicate-ERA detection (Task #107 foundation). ─────────────────────
  // Pre-check for a same-org batch with identical (payer, EFT#, payment date,
  // total amount). The DB has a partial unique index as a backstop, but
  // supabase-js cannot ON CONFLICT a partial index (see memory note), so we
  // must check explicitly.
  if (
    parsed.payerIdentifier &&
    parsed.traceNumber &&
    parsed.paymentDate &&
    parsed.paymentAmount > 0
  ) {
    const { data: existingDup } = await supabase
      .from("era_import_batches")
      .select("id, file_name, created_at")
      .eq("organization_id", input.organizationId)
      .eq("payer_identifier", parsed.payerIdentifier)
      .eq("eft_or_check_number", parsed.traceNumber)
      .eq("payment_date", parsed.paymentDate)
      .eq("total_payment_amount", parsed.paymentAmount)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    if (existingDup?.id) {
      return {
        ok: false,
        batchId: String(existingDup.id),
        totalClaims: parsed.claims.length,
        matchedClaims: 0,
        unmatchedClaims: parsed.claims.length,
        errors: [
          {
            field: "duplicate_era",
            message: `Duplicate ERA detected: an import batch with the same payer (${parsed.payerName ?? parsed.payerIdentifier}), EFT/check ${parsed.traceNumber}, payment date ${parsed.paymentDate}, and amount ${parsed.paymentAmount.toFixed(2)} already exists (batch ${String(existingDup.id).slice(0, 8)}).`,
          },
        ],
      };
    }
  }

  const { data: batch, error: batchError } = await supabase
    .from("era_import_batches")
    .insert({
      organization_id: input.organizationId,
      source: input.source ?? "manual_upload",
      file_name: input.fileName ?? undefined,
      raw_content: input.rawContent,
      parsed_summary: {
        transactionSetControlNumber: parsed.transactionSetControlNumber,
        paymentMethod: parsed.paymentMethod,
        traceNumber: parsed.traceNumber,
        segmentCount: parsed.segmentCount,
        paymentDate: parsed.paymentDate,
        payerName: parsed.payerName,
        payerIdentifier: parsed.payerIdentifier,
      },
      import_status: "parsed",
      total_claims: parsed.claims.length,
      total_payment_amount: parsed.paymentAmount,
      total_patient_responsibility: sumPatientResponsibility(parsed.claims),
      // Dedupe identity columns (Task #107).
      payer_identifier: parsed.payerIdentifier,
      payer_name: parsed.payerName,
      eft_or_check_number: parsed.traceNumber,
      payment_date: parsed.paymentDate,
      payment_method_code: parsed.paymentMethod,
    } as never)
    .select("id")
    .single();

  if (batchError || !batch) {
    return {
      ok: false,
      batchId: null,
      totalClaims: parsed.claims.length,
      matchedClaims: 0,
      unmatchedClaims: parsed.claims.length,
      errors: [{ field: "era_import_batches", message: batchError?.message ?? "Failed to create ERA import batch" }],
    };
  }

  const batchId = String(batch.id);
  let matchedClaims = 0;
  let unmatchedClaims = 0;
  const errors: Array<{ field: string; message: string }> = [];

  for (const claim of parsed.claims) {
    try {
      const match = await matchProfessionalClaim(input.organizationId, claim.clp01ClaimControlNumber);
      if (match) matchedClaims += 1;
      else unmatchedClaims += 1;

      const { data: paymentRow, error: claimPaymentError } = await supabase
        .from("era_claim_payments")
        .insert({
          organization_id: input.organizationId,
          era_import_batch_id: batchId,
          professional_claim_id: match?.id ?? null,
          client_id: match?.patient_id ?? null,
          clp01_claim_control_number: claim.clp01ClaimControlNumber,
          clp02_claim_status_code: claim.clp02ClaimStatusCode,
          clp03_total_charge: claim.clp03TotalCharge,
          clp04_payment_amount: claim.clp04PaymentAmount,
          clp05_patient_responsibility: claim.clp05PatientResponsibility,
          payer_claim_control_number: claim.payerClaimControlNumber,
          claim_match_status: match ? "matched" : "unmatched",
          posting_status: match ? "ready" : "blocked",
          cas_adjustments: claim.casAdjustments,
          service_lines: claim.serviceLines,
          raw_segments: claim.rawSegments,
          // Task #561 — surface CARC/RARC arrays alongside the structured
          // `remark_codes` jsonb so Medical Review / Denials / Payer
          // Received panels can read them without re-parsing raw_segments.
          carc_codes: Array.from(
            new Set(
              (claim.casAdjustments ?? [])
                .map((a) => String(a.reasonCode ?? "").toUpperCase())
                .filter(Boolean),
            ),
          ),
          rarc_codes: Array.from(
            new Set(
              (claim.remarkCodes ?? [])
                .map((c) => String(c ?? "").toUpperCase())
                .filter(Boolean),
            ),
          ),
          remark_codes: (claim.remarkCodes ?? [])
            .map((c) => String(c ?? "").toUpperCase())
            .filter(Boolean)
            .map((code) => ({ code, source: "835" })),
        })
        .select("id")
        .single();

      if (claimPaymentError) throw new Error(claimPaymentError.message);

      // ── Auto-seed Medical Review queue from ERA doc-request signals. ──
      // When the payer's remittance carries necessity CARCs (50/55/167)
      // or records-related remark codes (N706/MA01/N705/...), drop a
      // `medical_review_requested` audit row so the
      // /billing/medical-review queue surfaces the claim immediately
      // instead of waiting on a biller to write one by hand. We only
      // seed for matched claims — unmatched payments don't have a
      // professional_claim_id to attach the audit row to.
      if (match) {
        const detected = detectEraDocumentationRequest({
          carcCodes: (claim.casAdjustments ?? []).map((a) => a.reasonCode),
          remarkCodes: claim.remarkCodes ?? [],
        });
        if (detected) {
          const seed = await writeMedicalReviewRequestAudit(supabase, {
            organizationId: input.organizationId,
            claimId: match.id,
            clientId: match.patient_id ?? null,
            appointmentId: null,
            detected,
            origin: "ERA",
            sourceObjectId: paymentRow?.id ? String(paymentRow.id) : null,
          });
          if (seed.status === "error") {
            // Non-fatal: the era_claim_payments row was inserted; the
            // medical-review fallback (denial-classification path) will
            // still surface the claim and the audit row can be re-seeded
            // by re-importing the same ERA.
            console.warn(
              `[ERA medical-review seed] failed for claim ${match.id}: ${seed.error}`,
            );
          }
        }
      }

      // Task #457 — persist COB signals (CO-22, MOA other-payer paid)
      // onto `claim_cob_signals` whenever we can attach them to a real
      // matched claim. Unmatched ERAs skip this — without a
      // professional_claim_id there's nowhere to attribute the signal
      // and `/api/billing/cob-issues` keys off claim_id.
      if (match && (claim.cobSignals.coveredByOtherPayer || claim.cobSignals.otherPayerPaidAmount != null)) {
        const eraClaimPaymentId = paymentRow?.id ? String(paymentRow.id) : null;
        const signalRows: Array<Record<string, unknown>> = [];
        if (claim.cobSignals.coveredByOtherPayer) {
          signalRows.push({
            organization_id: input.organizationId,
            professional_claim_id: match.id,
            era_claim_payment_id: eraClaimPaymentId,
            signal_type: "co_22",
            other_payer_name: claim.cobSignals.otherPayerName,
            other_payer_id: claim.cobSignals.otherPayerId,
            other_payer_paid_amount: null,
            source_segment: claim.cobSignals.sourceSegment,
            raw: {
              clp: claim.clp01ClaimControlNumber,
              co22Amount: claim.cobSignals.co22Amount,
            },
          });
        }
        if (claim.cobSignals.otherPayerPaidAmount != null) {
          signalRows.push({
            organization_id: input.organizationId,
            professional_claim_id: match.id,
            era_claim_payment_id: eraClaimPaymentId,
            signal_type: "other_payer_paid",
            other_payer_name: claim.cobSignals.otherPayerName,
            other_payer_id: claim.cobSignals.otherPayerId,
            other_payer_paid_amount: claim.cobSignals.otherPayerPaidAmount,
            source_segment: claim.cobSignals.sourceSegment,
            raw: { clp: claim.clp01ClaimControlNumber },
          });
        }
        if (signalRows.length > 0) {
          const { error: signalErr } = await supabase
            .from("claim_cob_signals")
            .insert(signalRows as never);
          if (signalErr) {
            // Don't fail the whole intake over a COB-signal write — the
            // ERA itself has already been persisted. Log and continue.
            console.warn(
              `[era835Intake] failed to persist claim_cob_signals for ${claim.clp01ClaimControlNumber}: ${signalErr.message}`,
            );
          }
        }
      }
    } catch (error) {
      errors.push({
        field: claim.clp01ClaimControlNumber,
        message: error instanceof Error ? error.message : "Failed to create ERA claim payment row",
      });
    }
  }

  const importStatus = errors.length > 0 ? "blocked" : unmatchedClaims > 0 ? "matched" : "matched";
  await supabase
    .from("era_import_batches")
    .update({ import_status: importStatus, updated_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("organization_id", input.organizationId);

  return {
    ok: errors.length === 0,
    batchId,
    totalClaims: parsed.claims.length,
    matchedClaims,
    unmatchedClaims,
    errors,
  };
}
