import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AUTO_CHECK_LAST_RUN_SETTING_KEY,
  type AutoCheckLastRunSummary,
} from "@/lib/billing/claimStatusAutoCheck";

/**
 * Back-compat shim over the generalized cron-job registry (Task #745).
 *
 * The nightly auto-check heartbeat used to live entirely in this file
 * (Task #706). Task #745 promoted the freshness math and the "what
 * does last-run mean for this job?" probe into `lib/cron/jobRegistry`
 * so every nightly job — not just the payer auto-check — gets a
 * heartbeat. This module keeps the old name/signature, the richer
 * per-org last-run summary loader, and the `disabled` short-circuit
 * so callers that specifically need the claim-status heartbeat
 * (banner, runbook URL, external uptime endpoint) don't have to
 * thread the registry themselves.
 */

import {
  DEFAULT_STALE_AFTER_HOURS as REGISTRY_DEFAULT_STALE_AFTER_HOURS,
  getCronJobHeartbeat,
  getCronJob,
} from "@/lib/cron/jobRegistry";

export const DEFAULT_STALE_AFTER_HOURS = REGISTRY_DEFAULT_STALE_AFTER_HOURS;

export type AutoCheckHeartbeatStatus = "ok" | "stale" | "never_run" | "disabled";

export interface AutoCheckHeartbeat {
  status: AutoCheckHeartbeatStatus;
  lastRunAt: string | null;
  hoursSinceLastRun: number | null;
  thresholdHours: number;
  message: string;
  /**
   * Snapshot of the most recent per-org cron run, persisted by
   * `runClaimStatusAutoCheck` into `organization_settings`. Used by the
   * Billing Defaults page to show "scanned X, polled Y, skipped Z" and
   * an explicit "auto-check disabled" note when the org has the feature
   * turned off. Null when no run summary has been recorded yet (e.g.
   * never run, or scoped to all orgs).
   */
  lastRunSummary?: AutoCheckLastRunSummary | null;
}

export interface GetAutoCheckHeartbeatOptions {
  organizationId?: string | null;
  staleAfterHours?: number;
  now?: Date;
}

async function loadLastRunSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  organizationId: string,
): Promise<AutoCheckLastRunSummary | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const { data: settingRow } = await sb
      .from("organization_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", AUTO_CHECK_LAST_RUN_SETTING_KEY)
      .maybeSingle();
    const raw = (settingRow as { setting_value?: unknown } | null)?.setting_value;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const r = raw as Record<string, unknown>;
      if (typeof r.ran_at === "string") {
        return {
          ran_at: r.ran_at,
          scanned: Number(r.scanned) || 0,
          dispatched: Number(r.dispatched) || 0,
          skipped: Number(r.skipped) || 0,
          failures: Number(r.failures) || 0,
          disabled: r.disabled === true,
        };
      }
    }
  } catch {
    // organization_settings is optional — silently fall through.
  }
  return null;
}

export async function getClaimStatusAutoCheckHeartbeat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  options: GetAutoCheckHeartbeatOptions = {},
): Promise<AutoCheckHeartbeat> {
  const job = getCronJob("claim-status-auto-check");
  if (!job) {
    throw new Error("claim-status-auto-check job is not registered");
  }
  const hb = await getCronJobHeartbeat(supabase, job, {
    organizationId: options.organizationId,
    staleAfterHours: options.staleAfterHours,
    now: options.now,
  });

  // Best-effort: load the per-org last-run summary so the UI can show
  // "scanned X, polled Y, skipped Z" alongside the freshness verdict.
  // Globally-scoped heartbeat calls have no org context, so the
  // summary is omitted in that mode.
  let lastRunSummary: AutoCheckLastRunSummary | null = null;
  if (options.organizationId) {
    lastRunSummary = await loadLastRunSummary(supabase, options.organizationId);
  }

  // Disabled orgs are expected to have no recent inquiries, so freshness
  // alarms based on `claim_status_inquiries` would be misleading. Short-
  // circuit to a non-alarming `disabled` status, using the persisted
  // last-run timestamp (when the cron last visited and skipped this org)
  // as `lastRunAt`. Without this, the Billing Defaults page would render
  // both the "disabled" tile AND the red "looks broken" banner.
  if (lastRunSummary?.disabled) {
    return {
      status: "disabled",
      lastRunAt: lastRunSummary.ran_at,
      hoursSinceLastRun: null,
      thresholdHours: hb.thresholdHours,
      message:
        "Payer auto-check is disabled for this organization. The scheduled cron is visiting and intentionally skipping it.",
      lastRunSummary,
    };
  }

  // Preserve the original, more specific messages for the existing
  // banner / external-uptime consumers so their copy doesn't change.
  const message =
    hb.status === "never_run"
      ? "Nightly payer auto-check has never produced an inquiry. Confirm the Supabase pg_cron job is scheduled and the CRON_SECRET matches the deployment."
      : hb.status === "stale" && hb.hoursSinceLastRun !== null
        ? `Nightly payer auto-check has not run in ${hb.hoursSinceLastRun}h (threshold ${hb.thresholdHours}h). Check the Supabase pg_cron schedule, the CRON_SECRET, and the deployment URL.`
        : hb.status === "stale"
          ? hb.message
          : `Last auto-check ran ${hb.hoursSinceLastRun}h ago.`;

  return {
    status: hb.status,
    lastRunAt: hb.lastRunAt,
    hoursSinceLastRun: hb.hoursSinceLastRun,
    thresholdHours: hb.thresholdHours,
    message,
    lastRunSummary,
  };
}
