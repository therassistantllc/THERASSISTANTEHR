/**
 * POST /api/billing/payments/bulk/archive
 * Body: { organizationId, ids: string[], reason?: string }
 *
 * Archives selected payments (soft-delete via archived_at). Reverse with
 * the unarchive endpoint (not yet implemented — restore manually if needed).
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

  const now = new Date().toISOString();
  const r = await applyBulkUpdate(
    {
      supabase,
      organizationId,
      actor,
      action: "payment_voided",
      verb: "archive",
      metadata: { reason },
    },
    targets,
    () => ({
      archived_at: now,
      updated_at: now,
    }),
  );

  return NextResponse.json({ ok: r.failed === 0, parseErrors, ...r });
}
