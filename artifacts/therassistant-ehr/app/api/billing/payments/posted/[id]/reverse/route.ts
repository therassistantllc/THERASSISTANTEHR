/**
 * POST /api/billing/payments/posted/:id/reverse
 *
 * Reverses a posted payment (writes paired negative ledger entries, restores
 * balances, marks posting_status='reversed', closes obsolete workqueue items,
 * audits). Routes ERA-835 / client_payment / insurance_manual uniformly
 * through the posting engine.
 *
 * When `dryRun: true` is passed in the body, the engine runs all
 * validation + the same reads it would do live, returns a `preview`
 * (projected ledger compensation, claim status change, invoice delta,
 * auto-patient-refund, workqueue items it would close) and writes
 * NOTHING to the DB. The dashboard uses this to render a confirm-modal
 * before money actually moves (Task #168).
 */
import { NextResponse } from "next/server";
import {
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
  requireAuthenticatedPaymentPoster,
  reversePostedPayment,
} from "@/lib/payments/postingEngine";
import type { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { parseCompositePostedPaymentId as parseCompositeId } from "../_compositeId";

interface Body {
  organizationId?: string;
  reason?: string;
  dryRun?: boolean;
}

type SupabaseAdmin = NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>;

/** Injectable dependencies so the processor is unit-testable end-to-end. */
export interface ReverseRouteDeps {
  requireAuth: typeof requireAuthenticatedPaymentPoster;
  reversePostedPayment: typeof reversePostedPayment;
  /** Optional injected supabase client — forwarded to the engine handler. */
  supabase?: SupabaseAdmin | null;
}

export const defaultReverseRouteDeps: ReverseRouteDeps = {
  requireAuth: requireAuthenticatedPaymentPoster,
  reversePostedPayment,
};

/**
 * Testable inner pipeline. Returns `{ status, payload }` so the POST
 * wrapper can keep concerns separated. Throws auth errors so the
 * wrapper can map them to 401/403 cleanly.
 */
export async function processReversalRequest(
  rawId: string,
  body: Body,
  deps: ReverseRouteDeps = defaultReverseRouteDeps,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const organizationId = body.organizationId ? String(body.organizationId) : "";
  if (!organizationId) {
    return {
      status: 400,
      payload: { success: false, error: "organizationId is required" },
    };
  }
  const target = parseCompositeId(rawId);
  if (!target) {
    return {
      status: 400,
      payload: {
        success: false,
        error: "Invalid posted-payment id (expected era:|cp:|mi: prefix)",
      },
    };
  }
  const actor = await deps.requireAuth(organizationId);
  const result = await deps.reversePostedPayment(
    {
      organizationId,
      target,
      reason: String(body.reason ?? "").trim(),
      actor,
      dryRun: body.dryRun === true,
    },
    deps.supabase ?? undefined,
  );
  if (!result.ok) {
    const isClientError = result.errors.some((e) =>
      ["reason", "posting_status", target.kind].includes(e.field),
    );
    return {
      status: isClientError ? 409 : 500,
      payload: { success: false, ...result },
    };
  }
  return { status: 200, payload: { success: true, ...result } };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Body;
    const { status, payload } = await processReversalRequest(rawId, body);
    return NextResponse.json(payload, { status });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError)
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    if (error instanceof PaymentPostingForbiddenError)
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    console.error("Reverse posted-payment API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to reverse payment" },
      { status: 500 },
    );
  }
}
