import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  requireAuthenticatedPaymentPoster,
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
} from "@/lib/payments/postingEngine";
import { findOrCreateRow } from "@/lib/db/findOrCreate";

function generateUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof PaymentPostingUnauthenticatedError) return "Not authenticated";
  if (error instanceof PaymentPostingForbiddenError) return "Forbidden";
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Payment posting failed";
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseServiceRoleClient();

    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SUPABASE_SERVICE_ROLE_KEY is required for payment posting writes. Add it to .env.local and restart dev server.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { paymentImportItemId?: unknown; eraClaimPaymentId?: unknown };
    const paymentImportItemId = String(body.paymentImportItemId ?? "").trim();
    const requestedEraClaimPaymentId = String(body.eraClaimPaymentId ?? "").trim();

    if (!paymentImportItemId && !requestedEraClaimPaymentId) {
      return NextResponse.json(
        { success: false, error: "paymentImportItemId or eraClaimPaymentId is required" },
        { status: 400 },
      );
    }

    let eraClaimPayment: Record<string, unknown> | null = null;
    if (requestedEraClaimPaymentId) {
      const { data, error } = await supabase
        .from("era_claim_payments")
        .select("*")
        .eq("id", requestedEraClaimPaymentId)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw error;
      eraClaimPayment = data as Record<string, unknown> | null;
    } else if (paymentImportItemId) {
      const { data, error } = await supabase
        .from("era_claim_payments")
        .select("*")
        .eq("payment_import_item_id", paymentImportItemId)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      eraClaimPayment = data as Record<string, unknown> | null;
    }

    const resolvedPaymentImportItemId =
      paymentImportItemId || String(eraClaimPayment?.payment_import_item_id ?? "").trim();

    const { data: paymentImportItem, error: itemError } = resolvedPaymentImportItemId
      ? await supabase
          .from("payment_import_items")
          .select("id, organization_id, claim_id, client_id, net_amount, posting_ready, imported_item_ref")
          .eq("id", resolvedPaymentImportItemId)
          .is("archived_at", null)
          .maybeSingle()
      : { data: null, error: null };

    if (itemError) throw itemError;
    if (!paymentImportItem && !eraClaimPayment) {
      return NextResponse.json({ success: false, error: "Payment import item or ERA claim payment not found" }, { status: 404 });
    }

    const organizationId = String(
      eraClaimPayment?.organization_id ?? paymentImportItem?.organization_id ?? "",
    );

    // Task #112 — POST_PAYMENTS gate (org resolved from ERA claim/payment item).
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

    const paymentReady = Boolean(paymentImportItem?.posting_ready) || eraClaimPayment?.posted_status === "unposted";
    if (!paymentReady) {
      return NextResponse.json({ success: false, error: "Payment is not ready to post" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const eraPaidAmount = money(eraClaimPayment?.paid_amount);
    const importNetAmount = money(paymentImportItem?.net_amount);
    const safeAmount = eraPaidAmount || importNetAmount;
    const claimId = String(eraClaimPayment?.professional_claim_id ?? paymentImportItem?.claim_id ?? "").trim() || null;
    const clientId = String(eraClaimPayment?.client_id ?? paymentImportItem?.client_id ?? "").trim() || null;
    const paymentRef = String(
      eraClaimPayment?.check_or_eft_number ??
        eraClaimPayment?.payer_claim_control_number ??
        paymentImportItem?.imported_item_ref ??
        eraClaimPayment?.id ??
        paymentImportItem?.id ??
        "payment",
    );

    // Find-or-create with 23505 race protection (Task #184). Partial unique
    // index idx_payment_postings_unique_active_import_item guarantees one
    // live posting per import item even if two posters race.
    const postingResult = await findOrCreateRow<Record<string, unknown>>({
      label: "payment posting",
      findExisting: () => {
        if (resolvedPaymentImportItemId) {
          return supabase
            .from("payment_postings")
            .select("*")
            .eq("payment_import_item_id", resolvedPaymentImportItemId)
            .is("archived_at", null)
            .limit(1)
            .maybeSingle();
        }

        return supabase
          .from("payment_postings")
          .select("*")
          .eq("posting_reference", `ERA-${eraClaimPayment?.id}`)
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .limit(1)
          .maybeSingle();
      },
      insertNew: () =>
        supabase
          .from("payment_postings")
          .insert({
            id: generateUuid(),
            organization_id: organizationId,
            payment_import_item_id: resolvedPaymentImportItemId || null,
            posting_status: "posted",
            posting_reference: `POST-${Date.now()}`,
            total_posted_amount: safeAmount,
            note: `Posted from payment posting workspace for ${paymentRef}`,
            posted_at: now,
            created_at: now,
            updated_at: now,
          })
          .select("*")
          .single(),
    });

    if (!postingResult.ok) {
      return NextResponse.json({ success: false, error: postingResult.error }, { status: 422 });
    }
    if (!postingResult.created) {
      return NextResponse.json({ success: true, reused: true, posting: postingResult.row });
    }
    const createdPosting = postingResult.row;

    if (resolvedPaymentImportItemId) {
      const paymentImportUpdate = await supabase
        .from("payment_import_items")
        .update({ payment_import_status: "posted", posting_ready: false, updated_at: now })
        .eq("id", resolvedPaymentImportItemId);
      if (paymentImportUpdate.error) throw paymentImportUpdate.error;
    }

    if (eraClaimPayment?.id) {
      const eraPaymentUpdate = await supabase
        .from("era_claim_payments")
        .update({ posted_status: "posted", posted_at: now, updated_at: now })
        .eq("id", eraClaimPayment.id);
      if (eraPaymentUpdate.error) throw eraPaymentUpdate.error;

      const eraLineUpdate = await supabase
        .from("era_service_lines")
        .update({ posted_status: "posted", updated_at: now })
        .eq("era_claim_payment_id", eraClaimPayment.id)
        .is("archived_at", null);
      if (eraLineUpdate.error) throw eraLineUpdate.error;
    }

    if (clientId) {
      const ledgerReference = String(eraClaimPayment?.id ?? createdPosting.id);
      const existingLedger = await supabase
        .from("client_ledger_entries")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("source_type", "era_payment")
        .eq("reference_number", ledgerReference)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (existingLedger.error) throw existingLedger.error;

      if (!existingLedger.data) {
        const ledgerInsert = await supabase
          .from("client_ledger_entries")
          .insert({
            id: generateUuid(),
            organization_id: organizationId,
            client_id: clientId,
            professional_claim_id: claimId,
            era_claim_payment_id: eraClaimPayment?.id ?? null,
            source_type: "era_payment",
            entry_type: "insurance_payment",
            description: `Insurance payment posted from ERA ${paymentRef}`,
            debit_amount: 0,
            credit_amount: safeAmount,
            balance_effect: -safeAmount,
            service_date: null,
            posting_date: todayIsoDate(),
            reference_number: ledgerReference,
            metadata: {
              payment_import_item_id: resolvedPaymentImportItemId || null,
              payment_posting_id: createdPosting.id,
              check_or_eft_number: eraClaimPayment?.check_or_eft_number ?? null,
              payer_claim_control_number: eraClaimPayment?.payer_claim_control_number ?? null,
              patient_account_number: eraClaimPayment?.patient_account_number ?? paymentImportItem?.imported_item_ref ?? null,
            },
            created_at: now,
            updated_at: now,
          });
        if (ledgerInsert.error) throw ledgerInsert.error;
      }
    }

    const workqueueByEra = eraClaimPayment?.id
      ? await supabase
          .from("workqueue_items")
          .update({ status: "resolved", resolved_at: now, updated_at: now })
          .eq("source_object_id", eraClaimPayment.id)
          .eq("work_type", "payment_posting_needed")
          .is("archived_at", null)
      : { error: null };
    if (workqueueByEra.error) throw workqueueByEra.error;

    if (resolvedPaymentImportItemId) {
      const workqueueByImport = await supabase
        .from("workqueue_items")
        .update({ status: "resolved", resolved_at: now, updated_at: now })
        .eq("source_object_id", resolvedPaymentImportItemId)
        .eq("work_type", "payment_posting_needed")
        .is("archived_at", null);
      if (workqueueByImport.error) throw workqueueByImport.error;
    }

    if (claimId) {
      const claimUpdate = await supabase
        .from("professional_claims")
        .update({
          claim_status: "paid",
          paid_at: now,
          payer_responsibility_amount: safeAmount,
          updated_at: now,
        })
        .eq("id", claimId);
      if (claimUpdate.error) throw claimUpdate.error;
    }

    return NextResponse.json({ success: true, reused: false, posting: createdPosting });
  } catch (error) {
    console.error("Payment posting failed", error);
    return NextResponse.json(
      {
        success: false,
        error: extractErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
