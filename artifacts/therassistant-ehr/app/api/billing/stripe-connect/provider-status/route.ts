/**
 * GET /api/billing/stripe-connect/provider-status?providerId=<id>&organizationId=<id>
 *
 * Resolves a Stripe Connect status snapshot for a clinician given either
 * a `providers.id` (what an appointment.provider_id holds) or a
 * `provider_credentialing_profiles.id` directly. The Collect-Copay modal
 * uses this to decide whether to render the Stripe Elements card form or
 * fall back to the manual log path.
 *
 * Response:
 *   { success, status, credentialingProfileId, providerName,
 *     stripeConnectAccountId, chargesEnabled, requirements }
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";
import { summarizeConnectStatus } from "@/lib/stripe/connect";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const providerId = (url.searchParams.get("providerId") ?? "").trim();
    const organizationId = (url.searchParams.get("organizationId") ?? DEFAULT_ORG_ID).trim();
    if (!providerId) {
      return NextResponse.json({ success: false, error: "providerId is required" }, { status: 400 });
    }
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 503 });
    }

    // Try directly as a credentialing profile id first.
    const tryCred = await supabase
      .from("provider_credentialing_profiles")
      .select(
        "id, provider_name, stripe_connect_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements",
      )
      .eq("id", providerId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();

    let credRow = tryCred.data as
      | {
          id: string;
          provider_name: string | null;
          stripe_connect_account_id: string | null;
          stripe_charges_enabled: boolean | null;
          stripe_payouts_enabled: boolean | null;
          stripe_details_submitted: boolean | null;
          stripe_requirements: { currently_due?: string[]; disabled_reason?: string | null } | null;
        }
      | null;

    // Otherwise, resolve via the providers table → credentialing_profile_id.
    if (!credRow) {
      const { data: providerRow } = await supabase
        .from("providers")
        .select("id, credentialing_profile_id, display_name, first_name, last_name")
        .eq("id", providerId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      const credId = (providerRow as { credentialing_profile_id?: string | null } | null)?.credentialing_profile_id;
      if (credId) {
        const { data } = await supabase
          .from("provider_credentialing_profiles")
          .select(
            "id, provider_name, stripe_connect_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements",
          )
          .eq("id", credId)
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .maybeSingle();
        credRow = data as typeof credRow;
      }
    }

    if (!credRow) {
      return NextResponse.json({
        success: true,
        status: "not_connected",
        credentialingProfileId: null,
        providerName: null,
        stripeConnectAccountId: null,
        chargesEnabled: false,
        requirements: null,
      });
    }

    const status = summarizeConnectStatus({
      stripe_connect_account_id: credRow.stripe_connect_account_id,
      stripe_charges_enabled: credRow.stripe_charges_enabled ?? false,
      stripe_details_submitted: credRow.stripe_details_submitted ?? false,
      stripe_requirements: credRow.stripe_requirements ?? null,
    });

    return NextResponse.json({
      success: true,
      status,
      credentialingProfileId: credRow.id,
      providerName: credRow.provider_name,
      stripeConnectAccountId: credRow.stripe_connect_account_id,
      chargesEnabled: Boolean(credRow.stripe_charges_enabled),
      requirements: credRow.stripe_requirements ?? null,
    });
  } catch (err) {
    console.error("[stripe-connect/provider-status]", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Status lookup failed" },
      { status: 500 },
    );
  }
}
