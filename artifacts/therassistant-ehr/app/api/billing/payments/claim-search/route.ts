/**
 * GET /api/billing/payments/claim-search?organizationId=&q=&payerId=
 *
 * Lightweight claim lookup for the manual-insurance posting workspace.
 * Searches professional_claims by claim_number / patient_account_number
 * and optionally filters by payer_profile_id.
 */

import { NextResponse } from "next/server";
import {
  requireAuthenticatedPaymentPoster,
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
} from "@/lib/payments/postingEngine";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId") ?? "";
    if (!organizationId) {
      return NextResponse.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }
    await requireAuthenticatedPaymentPoster(organizationId);
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "DB unavailable" }, { status: 503 });

    const q = (url.searchParams.get("q") ?? "").trim();
    const payerId = url.searchParams.get("payerId");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100);

    let query = supabase
      .from("professional_claims")
      .select(
        "id, claim_number, patient_account_number, patient_id, payer_profile_id, claim_status, total_charge_amount, payer_responsibility_amount, patient_responsibility_amount, date_of_service_from, date_of_service_to, created_at",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (payerId) query = query.eq("payer_profile_id", payerId);
    if (q) {
      query = query.or(`claim_number.ilike.%${q}%,patient_account_number.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    return NextResponse.json({ ok: true, claims: data ?? [] });
  } catch (err) {
    if (err instanceof PaymentPostingUnauthenticatedError) return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    if (err instanceof PaymentPostingForbiddenError) return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
