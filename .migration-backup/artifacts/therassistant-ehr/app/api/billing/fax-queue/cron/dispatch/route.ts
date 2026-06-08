/**
 * POST /api/billing/fax-queue/cron/dispatch
 *
 * Drains pending `fax_queue` rows by sending the merged documentation PDF
 * through the configured outbound fax provider (Telnyx). Mirrors the dual
 * caller pattern used by the other billing crons:
 *
 *   1. Scheduler:  header `x-cron-secret: $CRON_SECRET`  — fans out across
 *      every organization with at least one pending fax_queue row.
 *   2. Authenticated biller: body `{ organizationId, maxFaxes? }` — manual
 *      run for that single org, useful for back-office triage.
 *
 * Idempotent within a batch: the worker only picks rows in status='pending'
 * and updates each one to 'sent'/'failed' before returning, so re-running
 * immediately re-processes only the rows that still failed.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { runFaxQueueDispatch } from "@/lib/billing/faxQueueWorker";

export const runtime = "nodejs";

interface CronBody {
  organizationId?: string;
  maxFaxes?: number;
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
      .from("fax_queue")
      .select("organization_id")
      .eq("status", "pending");
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
    sent: number;
    failed: number;
    skipped: number;
    providerName: string;
    error?: string;
  }> = [];

  for (const organizationId of organizationIds) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await runFaxQueueDispatch(supabase as any, {
        organizationId,
        maxFaxes: body.maxFaxes,
      });
      perOrg.push({
        organizationId,
        scanned: r.scanned,
        sent: r.sent,
        failed: r.failed,
        skipped: r.skipped,
        providerName: r.providerName,
      });
    } catch (err) {
      perOrg.push({
        organizationId,
        scanned: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        providerName: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      console.warn(
        `fax-queue dispatch failed for ${organizationId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const totals = perOrg.reduce(
    (acc, r) => {
      acc.scanned += r.scanned;
      acc.sent += r.sent;
      acc.failed += r.failed;
      acc.skipped += r.skipped;
      return acc;
    },
    { scanned: 0, sent: 0, failed: 0, skipped: 0 },
  );

  return NextResponse.json({
    ok: true,
    organizations: perOrg.length,
    totals,
    perOrg,
  });
}
