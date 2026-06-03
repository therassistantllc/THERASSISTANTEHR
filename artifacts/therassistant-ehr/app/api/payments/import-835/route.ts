import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
// File: app/api/payments/import-835/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseAdminClient as createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { parse835 } from "@/lib/clearinghouse/parsers/parse835";
import type { Json } from "@/lib/supabase/database.types";
import {
  requireAuthenticatedPaymentPoster,
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
} from "@/lib/payments/postingEngine";
import { UNIQUE_VIOLATION } from "@/lib/db/findOrCreate";

function generateUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function numberOrZero(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function stringOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "835 import failed";
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const submittedOrganizationId = String(formData.get("organizationId") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "835 file is required" }, { status: 400 });
    }

    const supabase = createServerSupabaseServiceRoleClient();

    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SUPABASE_SERVICE_ROLE_KEY is required for 835 import writes. Add it to .env.local and restart dev server.",
        },
        { status: 503 },
      );
    }

    const guard = await requireOrgAccess({
      requestedOrganizationId: submittedOrganizationId || null,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // Task #112 — POST_PAYMENTS gate on 835 ingest.
    try {
      await requireAuthenticatedPaymentPoster(organizationId);
    } catch (err) {
      const status =
        err instanceof PaymentPostingUnauthenticatedError ? 401 : err instanceof PaymentPostingForbiddenError ? 403 : 403;
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : "Forbidden" },
        { status },
      );
    }

    const raw835 = await file.text();

    if (!raw835.includes("ISA") || !raw835.includes("CLP")) {
      return NextResponse.json({ success: false, error: "File does not appear to be a valid 835 ERA" }, { status: 422 });
    }

    const parsed = parse835(raw835);
    const now = new Date().toISOString();
    const fileHash = crypto.createHash("sha256").update(raw835).digest("hex");

    const batchId = generateUuid();

    const { error: batchError } = await supabase
      .from("payment_import_batches")
      .insert({
        id: batchId,
        organization_id: organizationId,
        import_source: "835_era_upload",
        payment_import_status: "parsed",
        source_file_name: file.name,
        source_file_hash: fileHash,
        imported_at: now,
        total_item_count: parsed.claims.length,
        total_amount: parsed.totalPaymentAmount ?? 0,
        parse_errors_count: 0,
        created_at: now,
        updated_at: now,
      });

    if (batchError) throw batchError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importedItems: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unmatchedClaims: any[] = [];

    let duplicateClaims = 0;

    for (const [claimIndex, claim] of parsed.claims.entries()) {
      const patientControlNumber = claim.patientControlNumber;

      let matchedClaim: { id: string; client_id: string | null; insurance_policy_id?: string | null; payer_profile_id?: string | null } | null = null;

      if (patientControlNumber) {
        const { data: claimNumberMatch } = await supabase
          .from("professional_claims")
          .select("id, client_id, insurance_policy_id, payer_profile_id")
          .eq("organization_id", organizationId)
          .eq("claim_number", patientControlNumber)
          .limit(1)
          .maybeSingle();

        matchedClaim = claimNumberMatch;
      }

      if (!matchedClaim && patientControlNumber && isUuid(patientControlNumber)) {
        const { data: idMatch } = await supabase
          .from("professional_claims")
          .select("id, client_id, insurance_policy_id, payer_profile_id")
          .eq("organization_id", organizationId)
          .eq("id", patientControlNumber)
          .limit(1)
          .maybeSingle();

        matchedClaim = idMatch;
      }

      const itemId = generateUuid();

      const payload = {
        payer_name: claim.payerName,
        payee_name: claim.payeeName,
        payment_date: claim.paymentDate,
        claim_status_code: claim.claimStatusCode,
        patient_first_name: claim.patientFirstName,
        patient_last_name: claim.patientLastName,
        patient_member_id: claim.patientMemberId,
        total_charge_amount: claim.totalChargeAmount,
        paid_amount: claim.paidAmount,
        patient_responsibility_amount: claim.patientResponsibilityAmount,
        payer_claim_control_number: claim.payerClaimControlNumber,
        claim_filing_indicator_code: claim.claimFilingIndicatorCode,
        check_or_eft_number: claim.checkOrEftNumber,
        trace_number: claim.traceNumber,
        adjustments: claim.adjustments,
        service_lines: claim.serviceLines,
        raw_claim_payload: claim.raw,
      } as unknown as Json;

      const itemFileHash = `${fileHash}:${patientControlNumber || claim.payerClaimControlNumber || claim.traceNumber || claimIndex + 1}`;

      const itemRecord = {
        id: itemId,
        organization_id: organizationId,
        batch_id: batchId,
        payment_import_status: "parsed",
        imported_item_ref: patientControlNumber,
        payment_date: claim.paymentDate,
        payer_id: null,
        claim_id: matchedClaim?.id ?? null,
        client_id: matchedClaim?.client_id ?? null,
        service_line_ref: null,
        gross_amount: claim.totalChargeAmount ?? 0,
        adjustment_amount:
          claim.adjustments.reduce((sum, adj) => sum + Number(adj.amount ?? 0), 0),
        net_amount: claim.paidAmount ?? 0,
        unapplied_amount: matchedClaim ? 0 : claim.paidAmount ?? 0,
        posting_ready: Boolean(matchedClaim),
        raw_item_payload: payload,
        original_file_name: file.name,
        storage_bucket: null,
        storage_path: null,
        file_hash: itemFileHash,
        parse_status: "parsed",
        parse_error: null,
        parsed_at: now,
        match_status: matchedClaim ? "matched" : "unmatched",
        match_reason: matchedClaim
          ? "Matched by claim number or claim id"
          : "No claim matched from ERA import",
        matched_at: matchedClaim ? now : null,
        created_at: now,
        updated_at: now,
      };

      const { error: itemError } = await supabase
        .from("payment_import_items")
        .insert(itemRecord);

      if (itemError) {
        if ((itemError as { code?: string }).code === UNIQUE_VIOLATION) {
          duplicateClaims += 1;
          continue;
        }
        throw itemError;
      }

      const eraClaimPaymentId = generateUuid();
      const { error: eraClaimError } = await supabase
        .from("era_claim_payments")
        .insert({
          id: eraClaimPaymentId,
          organization_id: organizationId,
          payment_import_batch_id: batchId,
          payment_import_item_id: itemId,
          professional_claim_id: matchedClaim?.id ?? null,
          payer_profile_id: matchedClaim?.payer_profile_id ?? null,
          client_id: matchedClaim?.client_id ?? null,
          insurance_policy_id: matchedClaim?.insurance_policy_id ?? null,
          clp01_claim_control_number: stringOrNull(patientControlNumber),
          payer_claim_control_number: stringOrNull(claim.payerClaimControlNumber),
          patient_account_number: stringOrNull(patientControlNumber),
          payer_name: stringOrNull(claim.payerName),
          payer_id: null,
          claim_status_code: stringOrNull(claim.claimStatusCode),
          total_charge_amount: numberOrZero(claim.totalChargeAmount),
          paid_amount: numberOrZero(claim.paidAmount),
          patient_responsibility_amount: numberOrZero(claim.patientResponsibilityAmount),
          claim_filing_indicator_code: stringOrNull(claim.claimFilingIndicatorCode),
          payment_date: claim.paymentDate || null,
          check_or_eft_number: stringOrNull(claim.checkOrEftNumber),
          raw_clp: (claim.raw ?? {}) as Json,
          raw_segments: payload,
          match_status: matchedClaim ? "matched" : "unmatched",
          posted_status: "unposted",
          created_at: now,
          updated_at: now,
        });
      if (eraClaimError) throw eraClaimError;

      const serviceLines = arrayOrEmpty(claim.serviceLines);
      if (serviceLines.length > 0) {
        const eraServiceRows = serviceLines.map((line, index) => {
          const row = line as Record<string, unknown>;
          const adjustments = arrayOrEmpty(row.adjustments);
          const carcCodes = adjustments
            .map((adj) => (adj && typeof adj === "object" ? (adj as Record<string, unknown>).reasonCode : null))
            .map(stringOrNull)
            .filter((code): code is string => Boolean(code));
          const groupCodes = adjustments
            .map((adj) => (adj && typeof adj === "object" ? (adj as Record<string, unknown>).groupCode : null))
            .map(stringOrNull)
            .filter((code): code is string => Boolean(code));
          const rarcCodes = arrayOrEmpty(row.remarkCodes).map(stringOrNull).filter((code): code is string => Boolean(code));

          return {
            id: generateUuid(),
            organization_id: organizationId,
            era_claim_payment_id: eraClaimPaymentId,
            professional_claim_id: matchedClaim?.id ?? null,
            service_line_number: index + 1,
            service_date_from: row.serviceDate || row.serviceDateFrom || null,
            service_date_to: row.serviceDateTo || null,
            procedure_code: stringOrNull(row.procedureCode || row.procedure_code),
            modifiers: arrayOrEmpty(row.modifiers).map(String),
            units: row.units == null ? null : numberOrZero(row.units),
            charge_amount: numberOrZero(row.chargeAmount ?? row.charge_amount),
            allowed_amount: row.allowedAmount == null ? null : numberOrZero(row.allowedAmount),
            paid_amount: numberOrZero(row.paidAmount ?? row.paid_amount),
            deductible_amount: numberOrZero(row.deductibleAmount),
            coinsurance_amount: numberOrZero(row.coinsuranceAmount),
            copay_amount: numberOrZero(row.copayAmount),
            contractual_adjustment_amount: numberOrZero(row.contractualAdjustmentAmount),
            other_adjustment_amount: numberOrZero(row.otherAdjustmentAmount),
            group_codes: [...new Set(groupCodes)],
            carc_codes: [...new Set(carcCodes)],
            rarc_codes: [...new Set(rarcCodes)],
            raw_svc: (row.raw ?? row) as Json,
            raw_segments: row as Json,
            match_status: matchedClaim ? "matched" : "unmatched",
            posted_status: "unposted",
            created_at: now,
            updated_at: now,
          };
        });

        const { error: eraLineError } = await supabase
          .from("era_service_lines")
          .insert(eraServiceRows);
        if (eraLineError) throw eraLineError;
      }

      importedItems.push({ ...itemRecord, era_claim_payment_id: eraClaimPaymentId });

      // Create workqueue item if payment is ready to post (matched)
      if (itemRecord.posting_ready) {
        const { error: queueError } = await supabase
          .from("workqueue_items")
          .insert({
            id: generateUuid(),
            organization_id: organizationId,
            source_object_type: "era_claim_payment",
            source_object_id: eraClaimPaymentId,
            professional_claim_id: matchedClaim?.id ?? null,
            era_claim_payment_id: eraClaimPaymentId,
            work_type: "payment_posting_needed",
            status: "open",
            priority: "medium",
            title: `Post payment for ${patientControlNumber || "ERA claim"}`,
            description: `${claim.payerName ?? "Payer"} - $${Number(claim.paidAmount ?? 0).toFixed(2)}`,
            resolved_at: null,
            created_at: now,
            updated_at: now,
          });

        if (queueError) throw queueError;
      }

      if (!matchedClaim) {
        unmatchedClaims.push({
          imported_item_ref: patientControlNumber,
          payer_name: claim.payerName,
          paid_amount: claim.paidAmount,
          era_claim_payment_id: eraClaimPaymentId,
        });
      }
    }

    return NextResponse.json({
      success: true,
      batchId,
      fileName: file.name,
      summary: {
        claimsFound: parsed.claims.length,
        matchedClaims: importedItems.filter((x) => x.claim_id).length,
        unmatchedClaims: unmatchedClaims.length,
        postingReady: importedItems.filter((x) => x.posting_ready).length,
        duplicateClaims,
        totalPaymentAmount: parsed.totalPaymentAmount,
        payerName: parsed.payerName,
        paymentDate: parsed.paymentDate,
      },
      unmatchedClaims,
    });
  } catch (error) {
    console.error("835 import failed", extractErrorMessage(error));

    return NextResponse.json(
      {
        success: false,
        error: extractErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
