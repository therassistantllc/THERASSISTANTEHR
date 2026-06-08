/**
 * GET /api/billing/payments/audit
 *
 * Admin-only paginated payment audit log viewer (Task #112, step 3).
 * Lists rows from `public.audit_logs` scoped to the caller's org with
 * filters by action, user_id (actor), and date range. Action set is
 * locked to the payment-mutation set written by the engine so the
 * viewer never accidentally surfaces unrelated events.
 *
 * Query params:
 *   organizationId (required) — tenant scope.
 *   action         (optional) — single PaymentAuditAction.
 *   userId         (optional) — actor user id.
 *   from / to      (optional) — ISO timestamps (inclusive).
 *   limit          (optional, default 50, max 200)
 *   offset         (optional, default 0)
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";

export const runtime = "nodejs";

const PAYMENT_ACTIONS = new Set([
  "payment_posted",
  "payment_reversed",
  "payment_voided",
  "payment_adjusted",
  "era_batch_posted",
  "era_batch_imported",
  "patient_invoice_created",
  "patient_invoice_updated",
  "recoupment_recorded",
  "refund_requested",
  "refund_issued",
  "unapplied_credit_recorded",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organizationId") ?? "";
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const ctx = await requireAuthenticatedStaff();
  if (!ctx) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    // Dev pass-through (same posture as the posting engine guard).
  } else {
    if (ctx.organizationId !== organizationId) {
      return NextResponse.json(
        { error: "Cannot view audit logs for a different organization" },
        { status: 403 },
      );
    }
    if (!ctx.roles.includes("admin")) {
      return NextResponse.json(
        { error: "Admin role required to view payment audit logs" },
        { status: 403 },
      );
    }
  }

  const action = url.searchParams.get("action");
  const userId = url.searchParams.get("userId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  let q = supabase
    .from("audit_logs")
    .select(
      "id, created_at, user_id, user_role, action, object_type, object_id, claim_id, workqueue_item_id, event_summary, before_value, after_value, event_metadata",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .in("action", Array.from(PAYMENT_ACTIONS))
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (action && PAYMENT_ACTIONS.has(action)) q = q.eq("action", action);
  if (userId) q = q.eq("user_id", userId);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, count, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    limit,
    offset,
    actions: Array.from(PAYMENT_ACTIONS),
  });
}
