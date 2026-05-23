/**
 * POST /api/billing/stripe-connect/refresh-status
 *
 * Re-pulls the Stripe Express account state and persists charges_enabled,
 * payouts_enabled, details_submitted, and requirements onto the
 * provider_credentialing_profiles row. Idempotent.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";
import {
  getStripeSecretKey,
  retrieveAccount,
  StripeRequestError,
  summarizeConnectStatus,
} from "@/lib/stripe/connect";

export async function POST(request: Request) {
  try {
    if (!getStripeSecretKey()) {
      return NextResponse.json(
        { success: false, error: "STRIPE_SECRET_KEY not configured" },
        { status: 503 },
      );
    }
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      providerId?: string;
      organizationId?: string;
    };
    const providerId = String(body.providerId ?? "").trim();
    const organizationId = String(body.organizationId ?? DEFAULT_ORG_ID).trim();
    if (!providerId) {
      return NextResponse.json({ success: false, error: "providerId is required" }, { status: 400 });
    }

    const { data: provider, error: provErr } = await supabase
      .from("provider_credentialing_profiles")
      .select("id, stripe_connect_account_id")
      .eq("id", providerId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (provErr) throw provErr;
    if (!provider) {
      return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
    }
    const accountId = (provider as { stripe_connect_account_id?: string | null }).stripe_connect_account_id ?? null;
    if (!accountId) {
      return NextResponse.json(
        { success: true, status: "not_connected", accountId: null },
      );
    }

    const account = await retrieveAccount(accountId);
    const updates = {
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_details_submitted: Boolean(account.details_submitted),
      stripe_requirements: account.requirements ?? null,
      stripe_account_status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error: updateErr } = await supabase
      .from("provider_credentialing_profiles")
      .update(updates)
      .eq("id", providerId)
      .eq("organization_id", organizationId);
    if (updateErr) throw updateErr;

    const status = summarizeConnectStatus({
      stripe_connect_account_id: accountId,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_requirements: account.requirements ?? null,
    });
    return NextResponse.json({ success: true, accountId, status, ...updates });
  } catch (err) {
    if (err instanceof StripeRequestError) {
      return NextResponse.json(
        { success: false, error: err.message, stripeCode: err.stripeCode },
        { status: err.status },
      );
    }
    console.error("[stripe-connect/refresh-status]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Status refresh failed" },
      { status: 500 },
    );
  }
}
