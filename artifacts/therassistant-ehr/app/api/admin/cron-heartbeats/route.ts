/**
 * GET /api/admin/cron-heartbeats
 *
 * Multi-job cron heartbeat endpoint — Task #745 generalization of the
 * single-job `/api/admin/cron-heartbeat/claim-status-auto-check`. Walks
 * the `lib/cron/jobRegistry` registry and returns the heartbeat status
 * of every monitored scheduled job in one call.
 *
 * Two callable modes (same shape as the per-job endpoint):
 *   1. External uptime monitor: header `x-cron-secret: $CRON_SECRET` —
 *      checks across all orgs. Responds HTTP 503 if *any* job is stale
 *      so a generic uptime monitor (UptimeRobot/BetterStack/Pingdom)
 *      can page on the worst-case offender.
 *   2. Authenticated admin/biller: cookie session via `requireOrgAccess`
 *      — used by the Billing Defaults page banner. Always responds 200
 *      with the full job list; the UI decides what to render.
 *
 * Optional query params:
 *   - `thresholdHours` (number) — overrides the per-job default for
 *     every job in the response. Useful for one-off probes.
 *   - `organizationId` (uuid) — scopes the probe to one org (the
 *     authenticated mode also enforces tenant isolation).
 */
import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
import {
  getAllCronJobHeartbeats,
  type JobHeartbeat,
} from "@/lib/cron/jobRegistry";

export const runtime = "nodejs";

function parseThreshold(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const url = req.nextUrl;
  const thresholdHours = parseThreshold(url.searchParams.get("thresholdHours"));
  const requestedOrganizationId = url.searchParams.get("organizationId");

  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const isCronCaller = !!(cronSecret && headerSecret && headerSecret === cronSecret);

  let organizationId: string | null = null;
  if (isCronCaller) {
    organizationId = requestedOrganizationId || null;
  } else {
    const guard = await requireOrgAccess({ requestedOrganizationId });
    if (guard instanceof NextResponse) return guard;
    organizationId = guard.organizationId;
  }

  let jobs: JobHeartbeat[];
  try {
    jobs = await getAllCronJobHeartbeats(supabase, {
      organizationId,
      staleAfterHours: thresholdHours,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const anyStale = jobs.some((j) => j.status !== "ok");
  const httpStatus = isCronCaller && anyStale ? 503 : 200;
  return NextResponse.json(
    {
      overall: anyStale ? "degraded" : "ok",
      jobs,
    },
    { status: httpStatus },
  );
}
