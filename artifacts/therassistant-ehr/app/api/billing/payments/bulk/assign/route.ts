/**
 * POST /api/billing/payments/bulk/assign
 * Body: { organizationId, ids: string[], assignedToStaffId: string | null }
 *
 * Assigns selected payments to a biller (or unassigns when null).
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
  const assignedToStaffId =
    (body as { assignedToStaffId?: string | null }).assignedToStaffId ?? null;
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
      verb: "assign",
      metadata: { assigned_to_staff_id: assignedToStaffId },
    },
    targets,
    () => ({
      assigned_to_staff_id: assignedToStaffId,
      updated_at: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ ok: r.failed === 0, parseErrors, ...r });
}
