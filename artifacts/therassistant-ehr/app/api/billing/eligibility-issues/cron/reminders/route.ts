/**
 * POST /api/billing/eligibility-issues/cron/reminders
 *
 * Task #702: scheduled scan that re-pings assignees whose routed
 * eligibility handoffs are still open past the configured threshold.
 *
 * Two callable modes:
 *   1. Scheduler: header `x-cron-secret: $CRON_SECRET` — fans out
 *      across every organization that owns at least one open routed
 *      eligibility item.
 *   2. Authenticated biller: body `{ organizationId, thresholdHours? }`
 *      — manual run for a single org (useful for QA / one-off catch-ups).
 *
 * Threshold: `thresholdHours` body field overrides
 * `ELIGIBILITY_ROUTING_REMINDER_HOURS` env, which overrides the 24h
 * default. Idempotent: the scan dedupes against the
 * `eligibility_routing_reminders` log, so re-running within the window
 * is a no-op.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  DEFAULT_REMINDER_THRESHOLD_HOURS,
  runEligibilityRoutingReminderScan,
  type ReminderScanResult,
} from "@/lib/billing/eligibilityRoutingReminderScan";

export const runtime = "nodejs";

const ROUTED_WORK_TYPES = [
  "eligibility_routed_clinician",
  "eligibility_routed_admin",
];
const OPEN_STATUSES = ["open", "in_progress", "blocked"];

function resolveThresholdHours(bodyOverride: number | null): number {
  if (bodyOverride && Number.isFinite(bodyOverride) && bodyOverride > 0) {
    return Math.floor(bodyOverride);
  }
  const env = Number(process.env.ELIGIBILITY_ROUTING_REMINDER_HOURS);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  return DEFAULT_REMINDER_THRESHOLD_HOURS;
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    organizationId?: string;
    thresholdHours?: number;
  } | null;

  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const isCronCaller = !!(cronSecret && headerSecret && headerSecret === cronSecret);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };

  let organizationIds: string[] = [];
  if (isCronCaller) {
    const { data, error } = await sb
      .from("workqueue_items")
      .select("organization_id")
      .in("work_type", ROUTED_WORK_TYPES)
      .in("status", OPEN_STATUSES)
      .is("archived_at", null);
    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to enumerate organizations" },
        { status: 500 },
      );
    }
    organizationIds = [
      ...new Set(
        ((data ?? []) as Array<{ organization_id: string }>)
          .map((r) => r.organization_id)
          .filter(Boolean),
      ),
    ];
  } else {
    const requested = (body?.organizationId ?? "").trim();
    const guard = await requireBillingAccess({
      requestedOrganizationId: requested || undefined,
    });
    if (guard instanceof NextResponse) return guard;
    organizationIds = [guard.organizationId];
  }

  const thresholdHours = resolveThresholdHours(
    typeof body?.thresholdHours === "number" ? body.thresholdHours : null,
  );

  const perOrg: ReminderScanResult[] = [];
  for (const organizationId of organizationIds) {
    try {
      const r = await runEligibilityRoutingReminderScan({
        sb,
        organizationId,
        thresholdHours,
      });
      perOrg.push(r);
    } catch (err) {
      perOrg.push({
        organizationId,
        scanned: 0,
        remindersSent: 0,
        items: [
          {
            workqueueItemId: "*",
            organizationId,
            assignedToStaffId: null,
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    }
  }

  const totals = perOrg.reduce(
    (acc, r) => {
      acc.scanned += r.scanned;
      acc.remindersSent += r.remindersSent;
      return acc;
    },
    { scanned: 0, remindersSent: 0 },
  );

  return NextResponse.json({
    ok: true,
    thresholdHours,
    organizations: perOrg.length,
    totals,
    perOrg,
  });
}
