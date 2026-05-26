import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Record a row in `cron_job_runs` so the heartbeat registry can answer
 * "is this scheduled job still running?" without having to infer it
 * from domain side-effects (which can legitimately be zero on a quiet
 * day).
 *
 * Failures here are deliberately swallowed (logged only): the cron's
 * primary work has already completed by the time we record, and we
 * never want a heartbeat-bookkeeping outage to mark a successful run
 * as failed to the caller.
 */
export interface RecordCronJobRunInput {
  jobId: string;
  status: "success" | "error";
  /** Optional org scope. Omit for cron-secret fan-out runs. */
  organizationId?: string | null;
  startedAt?: Date | string | null;
  /** Free-form per-job totals (counts, etc). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summary?: Record<string, any>;
  errorMessage?: string | null;
}

export async function recordCronJobRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  input: RecordCronJobRunInput,
): Promise<void> {
  try {
    const startedAt =
      input.startedAt instanceof Date
        ? input.startedAt.toISOString()
        : (input.startedAt ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const { error } = await sb.from("cron_job_runs").insert({
      job_id: input.jobId,
      organization_id: input.organizationId ?? null,
      status: input.status,
      started_at: startedAt,
      summary: input.summary ?? {},
      error_message: input.errorMessage ?? null,
    });
    if (error) {
      console.warn(
        `recordCronJobRun(${input.jobId}) insert failed: ${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `recordCronJobRun(${input.jobId}) threw:`,
      err instanceof Error ? err.message : err,
    );
  }
}
