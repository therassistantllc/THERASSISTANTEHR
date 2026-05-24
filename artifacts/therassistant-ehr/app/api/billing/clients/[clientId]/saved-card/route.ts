/**
 * GET    /api/billing/clients/[clientId]/saved-card
 *   → SavedCardSummary
 * POST   /api/billing/clients/[clientId]/saved-card
 *   body: { action: "start_setup" } → { setupIntentId, clientSecret, publishableKey, connectAccountId, customerId }
 *   body: { action: "confirm", setupIntentId? , paymentMethodId? } → { summary }
 *   body: { action: "set_autopay", enabled: boolean } → { summary }
 * DELETE /api/billing/clients/[clientId]/saved-card
 *   → { summary }
 *
 * Task #487. Billing-scoped (requires VIEW_BILLING). The actual card
 * collection is mediated by Stripe.js on the frontend; this route only
 * orchestrates SetupIntent / attach / detach.
 */
import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  confirmSavedCard,
  getSavedCardSummary,
  removeSavedCard,
  setAutopayEnabled,
  startCardSetup,
  type SavedCardError,
} from "@/lib/payments/savedCardService";

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

interface PostBody {
  organizationId?: string;
  action?: "start_setup" | "confirm" | "set_autopay";
  setupIntentId?: string | null;
  paymentMethodId?: string | null;
  enabled?: boolean;
}

function statusFor(code: SavedCardError): number {
  switch (code) {
    case "client_not_found":
      return 404;
    case "no_saved_card":
    case "no_connected_account":
    case "no_invoice":
      return 422;
    case "stripe_not_configured":
    case "db_unavailable":
      return 503;
    case "authentication_required":
    case "card_declined":
      return 402;
    default:
      return 502;
  }
}

export async function GET(request: Request, ctx: RouteParams) {
  const { clientId } = await ctx.params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") ?? undefined;
  const guard = await requireBillingAccess({ requestedOrganizationId: organizationId });
  if (guard instanceof NextResponse) return guard;
  const result = await getSavedCardSummary({
    organizationId: guard.organizationId,
    clientId,
  });
  if ("ok" in result && result.ok === false) {
    return NextResponse.json({ success: false, error: result.message }, { status: statusFor(result.code) });
  }
  return NextResponse.json({ success: true, summary: result });
}

export async function POST(request: Request, ctx: RouteParams) {
  const { clientId } = await ctx.params;
  const body = (await request.json()) as PostBody;
  const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;

  switch (body.action) {
    case "start_setup": {
      const r = await startCardSetup({ organizationId, clientId });
      if (!r.ok) return NextResponse.json({ success: false, error: r.message }, { status: statusFor(r.code) });
      return NextResponse.json({
        success: true,
        setupIntentId: r.setupIntentId,
        clientSecret: r.clientSecret,
        publishableKey: r.publishableKey,
        connectAccountId: r.connectAccountId,
        customerId: r.customerId,
      });
    }
    case "confirm": {
      const r = await confirmSavedCard({
        organizationId,
        clientId,
        setupIntentId: body.setupIntentId ?? null,
        paymentMethodId: body.paymentMethodId ?? null,
      });
      if (!r.ok) return NextResponse.json({ success: false, error: r.message }, { status: statusFor(r.code) });
      return NextResponse.json({ success: true, summary: r.summary });
    }
    case "set_autopay": {
      const r = await setAutopayEnabled({
        organizationId,
        clientId,
        enabled: !!body.enabled,
      });
      if (!r.ok) return NextResponse.json({ success: false, error: r.message }, { status: statusFor(r.code) });
      return NextResponse.json({ success: true, summary: r.summary });
    }
    default:
      return NextResponse.json(
        { success: false, error: "Unknown action" },
        { status: 400 },
      );
  }
}

export async function DELETE(request: Request, ctx: RouteParams) {
  const { clientId } = await ctx.params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") ?? undefined;
  const guard = await requireBillingAccess({ requestedOrganizationId: organizationId });
  if (guard instanceof NextResponse) return guard;
  const r = await removeSavedCard({ organizationId: guard.organizationId, clientId });
  if (!r.ok) return NextResponse.json({ success: false, error: r.message }, { status: statusFor(r.code) });
  return NextResponse.json({ success: true, summary: r.summary });
}
