/**
 * POST /api/billing/stripe-connect/onboard
 *
 * Starts (or resumes) a Stripe Connect Express onboarding flow for a
 * provider. If the provider has no stripe_connect_account_id yet, we
 * create the Express account on Stripe first, persist its id, and then
 * mint a fresh account_link onboarding URL the caller redirects the
 * clinician to. The same call resumes onboarding for an already-created
 * account (Stripe rotates account-link URLs).
 *
 * Returns: { success, url, accountId, status }
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";
import {
  createAccountLink,
  createExpressAccount,
  getStripeSecretKey,
  retrieveAccount,
  StripeRequestError,
  summarizeConnectStatus,
} from "@/lib/stripe/connect";

function originFromRequest(request: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const replit = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (replit) return `https://${replit}`;
  return new URL(request.url).origin;
}

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
      .select(
        "id, provider_name, email, stripe_connect_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements",
      )
      .eq("id", providerId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (provErr) throw provErr;
    if (!provider) {
      return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
    }

    let accountId = (provider as { stripe_connect_account_id?: string | null }).stripe_connect_account_id ?? null;

    if (!accountId) {
      const account = await createExpressAccount({
        email: (provider as { email?: string | null }).email ?? null,
        providerName: (provider as { provider_name?: string | null }).provider_name ?? null,
        metadata: { organization_id: organizationId, provider_id: providerId },
      });
      accountId = account.id;
      const { error: updateErr } = await supabase
        .from("provider_credentialing_profiles")
        .update({
          stripe_connect_account_id: accountId,
          stripe_charges_enabled: Boolean(account.charges_enabled),
          stripe_payouts_enabled: Boolean(account.payouts_enabled),
          stripe_details_submitted: Boolean(account.details_submitted),
          stripe_requirements: account.requirements ?? null,
          stripe_account_status_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", providerId)
        .eq("organization_id", organizationId);
      if (updateErr) throw updateErr;
    } else {
      const account = await retrieveAccount(accountId);
      await supabase
        .from("provider_credentialing_profiles")
        .update({
          stripe_charges_enabled: Boolean(account.charges_enabled),
          stripe_payouts_enabled: Boolean(account.payouts_enabled),
          stripe_details_submitted: Boolean(account.details_submitted),
          stripe_requirements: account.requirements ?? null,
          stripe_account_status_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", providerId)
        .eq("organization_id", organizationId);
    }

    const origin = originFromRequest(request);
    const returnUrl = `${origin}/settings/providers?stripeConnect=${encodeURIComponent(providerId)}`;
    const refreshUrl = `${origin}/settings/providers?stripeConnectRefresh=${encodeURIComponent(providerId)}`;
    const link = await createAccountLink({
      accountId: accountId!,
      returnUrl,
      refreshUrl,
    });

    const account = await retrieveAccount(accountId!);
    const status = summarizeConnectStatus({
      stripe_connect_account_id: accountId,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_requirements: account.requirements ?? null,
    });

    return NextResponse.json({ success: true, url: link.url, accountId, status });
  } catch (err) {
    if (err instanceof StripeRequestError) {
      return NextResponse.json(
        { success: false, error: err.message, stripeCode: err.stripeCode },
        { status: err.status === 401 ? 500 : err.status },
      );
    }
    console.error("[stripe-connect/onboard]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Onboarding failed" },
      { status: 500 },
    );
  }
}
