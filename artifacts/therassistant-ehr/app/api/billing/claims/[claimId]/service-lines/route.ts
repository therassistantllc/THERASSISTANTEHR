/**
 * GET /api/billing/claims/[claimId]/service-lines
 *
 * Lists service lines for a professional claim — used by the manual
 * insurance posting workspace to render the per-line allocation grid.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { assertFkBelongsToOrg, FkOwnershipError } from "@/lib/payments/fkOwnershipGuard";
import {
  requireAuthenticatedPaymentPoster,
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
} from "@/lib/payments/postingEngine";

export async function GET(request: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const { claimId } = await params;
    const url = new URL(request.url);
    const organizationId = String(url.searchParams.get("organizationId") ?? "").trim();
    if (!organizationId) {
      return NextResponse.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }
    // Service-line financial data — gate behind the same payment-poster
    // role required to read/post on a claim. Without this guard, any
    // authenticated user (e.g. clinician) with a claim id could read
    // charges, modifiers, and auth numbers.
    await requireAuthenticatedPaymentPoster(organizationId);
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Database connection not available" }, { status: 503 });
    }
    const guard = supabase as unknown as Parameters<typeof assertFkBelongsToOrg>[0];
    await assertFkBelongsToOrg(guard, "professional_claims", organizationId, claimId);

    const { data, error } = await supabase
      .from("professional_claim_service_lines")
      .select("id, line_number, procedure_code, charge_amount")
      .eq("claim_id", claimId)
      .order("line_number", { ascending: true });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, lines: data ?? [] });
  } catch (err) {
    if (err instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    }
    if (err instanceof PaymentPostingForbiddenError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
    }
    if (err instanceof FkOwnershipError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load service lines" },
      { status: 500 },
    );
  }
}
