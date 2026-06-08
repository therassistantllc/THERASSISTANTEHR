/**
 * POST /api/billing/fax-queue/cron/reconcile-status
 *
 * Polls the configured fax provider (Telnyx) for the terminal status of
 * every `claim_documentation_transmissions` row currently stuck in a
 * non-terminal state ('queued' or 'sending'). Mirrors the dual-caller
 * pattern used by the dispatch cron:
 *
 *   1. Scheduler:  header `x-cron-secret: $CRON_SECRET`  — fans out across
 *      every organization with at least one non-terminal fax transmission.
 *   2. Authenticated biller: body `{ organizationId, maxRows? }` — manual
 *      run for back-office triage.
 *
 * The dispatcher writes 'sending'; this reconciler flips to
 * 'delivered'/'failed' once Telnyx reaches a terminal status.
 * Re-running is safe — it only touches non-terminal rows.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { runFaxStatusReconcile } from "@/lib/billing/faxStatusReconciler";

export const runtime = "nodejs";

interface CronBody {
  organizationId?: string;
  maxRows?: number;
}

export async function POST(req: Request) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as CronBody;
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const isCronCaller = !!(cronSecret && headerSecret && headerSecret === cronSecret);

  let organizationIds: string[];
  if (isCronCaller) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const { data, error } = await sb
      .from("claim_documentation_transmissions")
      .select("organization_id")
      .eq("channel", "fax")
      .in("status", ["queued", "sending"]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    organizationIds = [
      ...new Set(
        ((data ?? []) as Array<{ organization_id: string }>)
          .map((r) => r.organization_id)
          .filter(Boolean),
      ),
    ];
  } else {
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId,
    });
    if (guard instanceof NextResponse) return guard;
    organizationIds = [guard.organizationId];
  }

  const perOrg: Array<{
    organizationId: string;
    scanned: number;
    delivered: number;
    failed: number;
    stillSending: number;
    errors: number;
    providerName: string;
    error?: string;
  }> = [];

  for (const organizationId of organizationIds) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await runFaxStatusReconcile(supabase as any, {
        organizationId,
        maxRows: body.maxRows,
      });
      perOrg.push({
        organizationId,
        scanned: r.scanned,
        delivered: r.delivered,
        failed: r.failed,
        stillSending: r.stillSending,
        errors: r.errors,
        providerName: r.providerName,
      });
    } catch (err) {
      perOrg.push({
        organizationId,
        scanned: 0,
        delivered: 0,
        failed: 0,
        stillSending: 0,
        errors: 1,
        providerName: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      console.warn(
        `fax-queue reconcile failed for ${organizationId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const totals = perOrg.reduce(
    (acc, r) => {
      acc.scanned += r.scanned;
      acc.delivered += r.delivered;
      acc.failed += r.failed;
      acc.stillSending += r.stillSending;
      acc.errors += r.errors;
      return acc;
    },
    { scanned: 0, delivered: 0, failed: 0, stillSending: 0, errors: 0 },
  );

  return NextResponse.json({
    ok: true,
    organizations: perOrg.length,
    totals,
    perOrg,
  });
}
