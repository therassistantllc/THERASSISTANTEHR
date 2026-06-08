/**
 * POST /api/billing/payments/posted/:id/cancel-refund
 *
 * Cancel a pending insurance refund (Task #169). The posted-payment id in
 * the path is the composite id of the SOURCE payment (used for routing and
 * audit context); the refund row is identified by `refundId` in the body.
 *
 * Cancellation:
 *   - payment_refunds.refund_status pending → cancelled (+ archived_at)
 *   - linked workqueue item closed
 *   - audit log row written
 *
 * Blocked once the refund has flipped to 'issued' — by then money has
 * moved and the right tool is reverse/recoup, not cancel.
 */
import { NextResponse } from "next/server";
import {
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
  cancelPendingRefund,
  requireAuthenticatedPaymentPoster,
} from "@/lib/payments/postingEngine";
import { parseCompositePostedPaymentId as parseCompositeId, UUID_RE } from "../_compositeId";

interface Body {
  organizationId?: string;
  refundId?: string;
  reason?: string;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Body;
    const organizationId = body.organizationId ? String(body.organizationId) : "";
    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: "organizationId is required" },
        { status: 400 },
      );
    }
    const target = parseCompositeId(rawId);
    if (!target) {
      return NextResponse.json(
        { success: false, error: "Invalid posted-payment id (expected era:|cp:|mi: prefix)" },
        { status: 400 },
      );
    }
    const refundId = String(body.refundId ?? "");
    if (!UUID_RE.test(refundId)) {
      return NextResponse.json(
        { success: false, error: "refundId must be a UUID" },
        { status: 400 },
      );
    }
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json(
        { success: false, error: "reason is required" },
        { status: 400 },
      );
    }
    const actor = await requireAuthenticatedPaymentPoster(organizationId);
    const result = await cancelPendingRefund({
      organizationId,
      refundId,
      reason,
      actor,
    });
    if (!result.ok) {
      // refund_status / reason errors are client-fault (409 / 400);
      // anything else is a 5xx so callers can retry / page on-call.
      const isClient = result.errors.some((e) =>
        ["refund_status", "refund_type", "reason"].includes(e.field),
      );
      const status = result.errors.some((e) => e.field === "reason") ? 400 : isClient ? 409 : 500;
      return NextResponse.json({ success: false, ...result }, { status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError)
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    if (error instanceof PaymentPostingForbiddenError)
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    console.error("Cancel-refund posted-payment API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to cancel refund",
      },
      { status: 500 },
    );
  }
}
