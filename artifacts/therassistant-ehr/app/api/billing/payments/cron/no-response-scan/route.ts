/**
 * POST /api/billing/payments/cron/no-response-scan
 *
 * Daily aging-scan that materializes `no_response` workqueue items for
 * claims aged past the org-configured threshold
 * (`payment_posting.no_response_days`; default 30d).
 *
 * Two callable modes:
 *   1. Scheduler: header `x-cron-secret: $CRON_SECRET` — runs against
 *      every organization that owns at least one professional_claim.
 *   2. Authenticated biller (admin/biller role): body `{ organizationId }`
 *      — manual run for that single org, useful for back-office triage.
 *
 * Idempotent: `runNoResponseAgingScan` dedupes via `existingOpenItem`,
 * so re-running the same day is a no-op.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedPaymentPoster } from "@/lib/payments/postingEngine";
import { runNoResponseAgingScan } from "@/lib/payments/postingEngine/workqueueRules";
import type { PostingActor } from "@/lib/payments/postingEngine/types";
import { recordCronJobRun } from "@/lib/cron/recordRun";

export const runtime = "nodejs";

const JOB_ID = "payments-no-response-scan";

export async function POST(req: Request) {
  const startedAt = new Date();
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { organizationId?: string } | null;
  const isCronCaller = !!(cronSecret && headerSecret && headerSecret === cronSecret);

  // Targets: cron caller fans out across orgs; authenticated caller pins
  // to one. We resolve org list inside the route so the scheduler doesn't
  // need to maintain a registry.
  let organizationIds: string[] = [];
  let actor: PostingActor;
  if (isCronCaller) {
    const { data, error } = await supabase
      .from("professional_claims")
      .select("organization_id")
      .not("organization_id", "is", null);
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
    actor = { staffId: null, userId: null, role: "system", source: "cron" } as PostingActor;
  } else {
    const organizationId = String(body?.organizationId ?? "");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required when not using cron secret" },
        { status: 400 },
      );
    }
    try {
      actor = await requireAuthenticatedPaymentPoster(organizationId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Forbidden" },
        { status: 403 },
      );
    }
    organizationIds = [organizationId];
  }

  const perOrg: Array<{
    organizationId: string;
    scanned: number;
    itemsCreated: number;
    errors: Array<{ claimId: string; message: string }>;
  }> = [];

  for (const organizationId of organizationIds) {
    try {
      const r = await runNoResponseAgingScan(supabase, { organizationId, actor });
      perOrg.push({
        organizationId,
        scanned: r.scanned,
        itemsCreated: r.itemsCreated,
        errors: r.errors,
      });
    } catch (err) {
      perOrg.push({
        organizationId,
        scanned: 0,
        itemsCreated: 0,
        errors: [{ claimId: "*", message: err instanceof Error ? err.message : String(err) }],
      });
    }
  }

  const totals = perOrg.reduce(
    (acc, r) => {
      acc.scanned += r.scanned;
      acc.itemsCreated += r.itemsCreated;
      acc.errors += r.errors.length;
      return acc;
    },
    { scanned: 0, itemsCreated: 0, errors: 0 },
  );

  // Heartbeat: cron-secret fan-out runs are recorded as a single global
  // row (organization_id=null); per-org manual catch-up runs as scoped.
  // Either way the registry probe (Task #745) reads MAX(finished_at) so
  // the Billing Defaults banner / external uptime check can tell the
  // job is still alive even on days where every org has zero candidates.
  const overallStatus: "success" | "error" =
    totals.errors > 0 && totals.itemsCreated === 0 && totals.scanned === 0
      ? "error"
      : "success";
  await recordCronJobRun(supabase, {
    jobId: JOB_ID,
    status: overallStatus,
    organizationId: isCronCaller ? null : (organizationIds[0] ?? null),
    startedAt,
    summary: { organizations: perOrg.length, totals, mode: isCronCaller ? "cron" : "manual" },
    errorMessage:
      overallStatus === "error"
        ? `All ${totals.errors} per-org scan(s) failed.`
        : null,
  });

  return NextResponse.json({ ok: true, organizations: perOrg.length, totals, perOrg });
}
