import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_STALE_AFTER_HOURS,
  evaluateHeartbeat,
  type Heartbeat,
} from "./heartbeat";

export { DEFAULT_STALE_AFTER_HOURS } from "./heartbeat";

/**
 * Registry of every scheduled background job whose freshness we monitor.
 *
 * Previously only the claim-status auto-check (Task #706) had a
 * heartbeat. Task #745 generalized this: any cron we add — billing,
 * eligibility, fax queue, autopay — registers here with a freshness
 * threshold and a probe that returns "when did this last successfully
 * run?". One endpoint (`/api/admin/cron-heartbeats`) and one banner
 * surface every registered job's status.
 *
 * Two probe strategies are supported:
 *
 *   1. `cron_job_runs`-backed: the cron calls `recordCronJobRun` after
 *      each fan-out, so the probe just reads MAX(finished_at) for
 *      status='success'. This is the default for new jobs.
 *   2. Custom probe: the job already has a natural "did it run?"
 *      witness (e.g. `claim_status_inquiries.trigger_source='auto'`),
 *      so we read that directly and don't need the cron to dual-write.
 */

export interface CronJobProbeInput {
  organizationId?: string | null;
}

export interface CronJobProbeResult {
  lastRunAt: string | null;
}

export interface CronJob {
  /** Stable machine id; also the row value written to cron_job_runs.job_id. */
  id: string;
  /** Short title for the admin UI / banner. */
  label: string;
  /** Longer description (1 sentence) — explains what it does, for the admin UI. */
  description: string;
  /** Default freshness threshold in hours. Overridable per request. */
  thresholdHours: number;
  /** Short recovery pointer — appended to stale/never-run messages. */
  recoveryHint?: string;
  /** Optional runbook link for the admin UI. */
  runbookPath?: string;
  /** Probe: returns when this job last successfully ran (or null). */
  probe: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: SupabaseClient<any, any, any>,
    input: CronJobProbeInput,
  ) => Promise<CronJobProbeResult>;
}

/** Probe factory: reads MAX(finished_at) from `cron_job_runs`. */
export function makeCronJobRunsProbe(jobId: string) {
  return async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: SupabaseClient<any, any, any>,
    { organizationId }: CronJobProbeInput,
  ): Promise<CronJobProbeResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb
      .from("cron_job_runs")
      .select("finished_at")
      .eq("job_id", jobId)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1);
    if (organizationId) {
      // Tenant-scoped probe matches either rows tagged with this org OR
      // global cron-secret fan-out rows (organization_id is null), since
      // either implies the job machinery itself is alive.
      q = q.or(`organization_id.eq.${organizationId},organization_id.is.null`);
    }
    const { data, error } = await q;
    if (error) {
      throw new Error(
        `cron_job_runs probe for "${jobId}" failed: ${error.message}`,
      );
    }
    const row = Array.isArray(data)
      ? (data[0] as { finished_at?: string } | undefined)
      : null;
    return { lastRunAt: row?.finished_at ?? null };
  };
}

/** Probe: reads MAX(created_at) from claim_status_inquiries trigger_source='auto'. */
export function claimStatusAutoCheckProbe() {
  return async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: SupabaseClient<any, any, any>,
    { organizationId }: CronJobProbeInput,
  ): Promise<CronJobProbeResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("claim_status_inquiries")
      .select("created_at")
      .eq("trigger_source", "auto")
      .order("created_at", { ascending: false })
      .limit(1);
    if (organizationId) {
      q = q.eq("organization_id", organizationId);
    }
    const { data, error } = await q;
    if (error) {
      throw new Error(
        `claim_status_inquiries probe failed: ${error.message}`,
      );
    }
    const row = Array.isArray(data)
      ? (data[0] as { created_at?: string } | undefined)
      : null;
    return { lastRunAt: row?.created_at ?? null };
  };
}

/**
 * The registry. Add new scheduled jobs here.
 *
 * `thresholdHours` should be ~1.5x the expected cadence so a single
 * missed run doesn't page; only sustained outages do.
 */
export const CRON_JOBS: CronJob[] = [
  {
    id: "claim-status-auto-check",
    label: "Nightly payer auto-check",
    description:
      "Scheduled 276 poller that keeps the Payer Received queue moving without billers clicking 'Check status' on each claim.",
    thresholdHours: DEFAULT_STALE_AFTER_HOURS, // 36h
    recoveryHint:
      "Check the Supabase pg_cron schedule, the CRON_SECRET, and the deployment URL.",
    runbookPath: "CLAIM_STATUS_AUTO_CHECK_RUNBOOK.md",
    probe: claimStatusAutoCheckProbe(),
  },
  {
    id: "payments-no-response-scan",
    label: "Nightly no-response aging scan",
    description:
      "Materializes 'no_response' workqueue items for claims aged past the org-configured threshold (default 30d).",
    thresholdHours: DEFAULT_STALE_AFTER_HOURS, // 36h (daily cadence)
    recoveryHint:
      "Check the Supabase pg_cron schedule, the CRON_SECRET, and the deployment URL for the no-response-scan endpoint.",
    probe: makeCronJobRunsProbe("payments-no-response-scan"),
  },
];

export function getCronJob(id: string): CronJob | undefined {
  return CRON_JOBS.find((j) => j.id === id);
}

export interface GetCronHeartbeatOptions {
  organizationId?: string | null;
  /** Override the per-job staleness threshold. */
  staleAfterHours?: number;
  now?: Date;
}

export interface JobHeartbeat extends Heartbeat {
  jobId: string;
  label: string;
  description: string;
  runbookPath?: string;
}

export async function getCronJobHeartbeat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  job: CronJob,
  options: GetCronHeartbeatOptions = {},
): Promise<JobHeartbeat> {
  const { lastRunAt } = await job.probe(supabase, {
    organizationId: options.organizationId ?? null,
  });
  const heartbeat = evaluateHeartbeat({
    lastRunAt,
    thresholdHours: options.staleAfterHours ?? job.thresholdHours,
    now: options.now,
    jobLabel: job.label,
    recoveryHint: job.recoveryHint,
  });
  return {
    ...heartbeat,
    jobId: job.id,
    label: job.label,
    description: job.description,
    runbookPath: job.runbookPath,
  };
}

export async function getAllCronJobHeartbeats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  options: GetCronHeartbeatOptions = {},
): Promise<JobHeartbeat[]> {
  return Promise.all(
    CRON_JOBS.map((job) => getCronJobHeartbeat(supabase, job, options)),
  );
}
