/**
 * POST /api/billing/payments/bulk/defer
 * Body: { organizationId, ids: string[], until: string (ISO date), reason?: string }
 *
 * Defers selected payments by stamping a `defer_until` + `defer_reason` on
 * each row. Reads back through the dashboard query. Role-guarded via
 * `requireAuthenticatedPaymentPoster`.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedPaymentPoster } from "@/lib/payments/postingEngine";
import { applyBulkUpdate, parseTargets } from "../_shared";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const organizationId = String((body as { organizationId?: string }).organizationId ?? "");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }
  const until = String((body as { until?: string }).until ?? "");
  if (!until) {
    return NextResponse.json({ error: "until (ISO timestamp) is required" }, { status: 400 });
  }
  const reason = (body as { reason?: string | null }).reason ?? null;
  const { targets, errors: parseErrors } = parseTargets((body as { ids?: unknown }).ids);
  if (targets.length === 0) {
    return NextResponse.json({ error: "No valid targets", parseErrors }, { status: 400 });
  }

  let actor;
  try {
    actor = await requireAuthenticatedPaymentPoster(organizationId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const r = await applyBulkUpdate(
    {
      supabase,
      organizationId,
      actor,
      action: "payment_adjusted",
      verb: "defer",
      metadata: { defer_until: until, reason },
    },
    targets,
    () => ({
      defer_until: until,
      defer_reason: reason,
      updated_at: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ ok: r.failed === 0, parseErrors, ...r });
}
