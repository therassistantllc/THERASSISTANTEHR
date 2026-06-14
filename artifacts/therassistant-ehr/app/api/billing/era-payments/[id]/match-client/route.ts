import { NextResponse, NextRequest } from "next/server";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
  requireAuthenticatedPaymentPoster,
} from "@/lib/payments/postingEngine";

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Unable to match ERA payment to client.";
}

/**
 * POST { organizationId, clientId }
 *
 * Matches a legacy/claimless ERA payment row to a patient account without
 * requiring or creating a professional claim. The database RPC validates the
 * selected client and moves the ERA row into patient_matched / ready status.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServerSupabaseServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Service role key not configured" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";

  if (!organizationId) {
    return NextResponse.json(
      { success: false, error: "organizationId is required" },
      { status: 400 },
    );
  }
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: "clientId is required" },
      { status: 400 },
    );
  }

  try {
    await requireAuthenticatedPaymentPoster(organizationId);

    const { data, error } = await supabase.rpc("match_claimless_era_to_client", {
      p_organization_id: organizationId,
      p_era_claim_payment_id: id,
      p_client_id: clientId,
    });
    if (error) throw error;

    const payment = Array.isArray(data) ? data[0] : data;
    if (!payment) {
      return NextResponse.json(
        { success: false, error: "ERA payment row was not found or could not be matched." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, payment });
  } catch (e) {
    if (e instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json(
        { success: false, error: e.message },
        { status: 401 },
      );
    }
    if (e instanceof PaymentPostingForbiddenError) {
      return NextResponse.json(
        { success: false, error: e.message },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { success: false, error: errMsg(e) },
      { status: 500 },
    );
  }
}
