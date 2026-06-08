import "server-only";

/**
 * Shared freshness evaluator for cron heartbeats.
 *
 * Originally Task #745 generalized the lone claim-status auto-check
 * heartbeat (Task #706) into a job registry covering every nightly
 * scheduled job. The freshness math is the same regardless of job, so
 * it lives here and `lib/cron/heartbeats.ts` per-job probes feed it.
 */

export const DEFAULT_STALE_AFTER_HOURS = 36;

export type HeartbeatStatus = "ok" | "stale" | "never_run";

export interface Heartbeat {
  status: HeartbeatStatus;
  lastRunAt: string | null;
  hoursSinceLastRun: number | null;
  thresholdHours: number;
  /** Human-readable reason — safe to drop into a banner or email body. */
  message: string;
}

export interface EvaluateHeartbeatInput {
  lastRunAt: string | null;
  thresholdHours: number;
  /** Override `now` for tests. */
  now?: Date;
  /** Short label used in human messages, e.g. "Nightly payer auto-check". */
  jobLabel: string;
  /** Optional extra hint appended to the "never run" / "stale" message. */
  recoveryHint?: string;
}

export function evaluateHeartbeat(input: EvaluateHeartbeatInput): Heartbeat {
  const thresholdHours = Math.max(
    1,
    Number(input.thresholdHours) || DEFAULT_STALE_AFTER_HOURS,
  );
  const now = input.now ?? new Date();
  const hint = input.recoveryHint ? ` ${input.recoveryHint}` : "";

  if (!input.lastRunAt) {
    return {
      status: "never_run",
      lastRunAt: null,
      hoursSinceLastRun: null,
      thresholdHours,
      message: `${input.jobLabel} has never recorded a successful run.${hint}`,
    };
  }

  const parsed = new Date(input.lastRunAt).getTime();
  if (!Number.isFinite(parsed)) {
    return {
      status: "stale",
      lastRunAt: input.lastRunAt,
      hoursSinceLastRun: null,
      thresholdHours,
      message: `${input.jobLabel} last-run timestamp is unparseable (${input.lastRunAt}).`,
    };
  }
  const hoursSinceLastRun = (now.getTime() - parsed) / (1000 * 60 * 60);
  const rounded = Math.round(hoursSinceLastRun * 10) / 10;

  if (hoursSinceLastRun > thresholdHours) {
    return {
      status: "stale",
      lastRunAt: input.lastRunAt,
      hoursSinceLastRun: rounded,
      thresholdHours,
      message: `${input.jobLabel} has not run in ${rounded}h (threshold ${thresholdHours}h).${hint}`,
    };
  }

  return {
    status: "ok",
    lastRunAt: input.lastRunAt,
    hoursSinceLastRun: rounded,
    thresholdHours,
    message: `${input.jobLabel} last ran ${rounded}h ago.`,
  };
}
