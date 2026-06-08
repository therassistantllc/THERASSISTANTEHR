import { NextResponse } from "next/server";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  requireAuthenticatedPaymentPoster,
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
} from "@/lib/payments/postingEngine";
import { postSingleEra835ClaimPayment } from "@/lib/payments/era835PostingService";

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
    let postingActor: Awaited<ReturnType<typeof requireAuthenticatedPaymentPoster>>;
    try {
      postingActor = await requireAuthenticatedPaymentPoster(organizationId);
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
    if (!eraClaimPayment?.id) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This payment import item has no ledger-backed ERA claim payment. Re-import or run the ERA bridge migration before posting.",
        },
        { status: 409 },
      );
    }

    const canonicalPost = await postSingleEra835ClaimPayment({
      organizationId,
      eraClaimPaymentId: String(eraClaimPayment.id),
      actor: postingActor,
    });
    if (!canonicalPost.ok) {
      return NextResponse.json(
        { success: false, ...canonicalPost },
        { status: canonicalPost.blocked ? 409 : 500 },
      );
    }
    const canonicalNow = new Date().toISOString();
    if (resolvedPaymentImportItemId) {
      const paymentImportUpdate = await supabase
        .from("payment_import_items")
        .update({ payment_import_status: "posted", posting_ready: false, updated_at: canonicalNow })
        .eq("id", resolvedPaymentImportItemId);
      if (paymentImportUpdate.error) throw paymentImportUpdate.error;
    }
    await supabase
      .from("workqueue_items")
      .update({ status: "resolved", resolved_at: canonicalNow, updated_at: canonicalNow })
      .eq("source_object_id", eraClaimPayment.id)
      .in("work_type", ["payment_posting_needed", "era_835_exception"])
      .is("archived_at", null);
    return NextResponse.json({
      success: true,
      reused: false,
      eraClaimPaymentId: eraClaimPayment.id,
      ...canonicalPost,
    });
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
