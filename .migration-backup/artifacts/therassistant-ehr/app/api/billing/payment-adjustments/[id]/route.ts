/**
 * PATCH  /api/billing/payment-adjustments/[id]   { organizationId, ...fields }
 * DELETE /api/billing/payment-adjustments/[id]?organizationId=…
 *
 * PATCH allows updating amount / description / reason_code / metadata. DELETE
 * is a soft delete (sets archived_at).
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
  requireAuthenticatedPaymentPoster,
} from "@/lib/payments/postingEngine";

function n(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : undefined;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }
    await requireAuthenticatedPaymentPoster(organizationId);

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const amount = n(body.amount);
    if (amount !== undefined) update.amount = amount;
    if (typeof body.description === "string") update.description = body.description;
    if (typeof body.reasonCode === "string") update.reason_code = body.reasonCode;
    if (typeof body.groupCode === "string") update.group_code = body.groupCode;
    if (typeof body.referenceId === "string") update.reference_id = body.referenceId;
    if (typeof body.adjustmentType === "string") update.adjustment_type = body.adjustmentType;
    if (typeof body.metadata === "object" && body.metadata !== null)
      update.metadata = body.metadata;

    const { data, error } = await supabase
      .from("payment_adjustments")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select("id, amount, description, reason_code, group_code, adjustment_type, metadata, updated_at")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message ?? "Update failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true, adjustment: data });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    if (error instanceof PaymentPostingForbiddenError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Update adjustment failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }
    await requireAuthenticatedPaymentPoster(organizationId);

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("payment_adjustments")
      .update({ archived_at: now, updated_at: now })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    if (error instanceof PaymentPostingForbiddenError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Delete adjustment failed" },
      { status: 500 },
    );
  }
}
