/**
 * Pure logic for deciding whether the scheduled billing-code refresh should
 * page ops. Kept side-effect free so it is trivial to unit-test.
 *
 * Two alert reasons today:
 *   - "error"       — the refresh itself failed (download/parse/upsert).
 *   - "missing"     — refresh succeeded but a code system whose new release is
 *                     overdue produced zero rows (CMS hasn't published, or our
 *                     download URL changed, or filters dropped every row).
 *
 * Release calendar (CMS, US):
 *   - ICD-10-CM     — annual, effective Oct 1. Expect the new file to be
 *                     available by Oct 15 of each year.
 *   - HCPCS Level II — quarterly (Jan/Apr/Jul/Oct 1). Expect the new file by
 *                     the 15th of each release month.
 *   - CPT           — AMA-licensed, distributed manually. We never auto-fetch
 *                     CPT, so it has no "missing" check here.
 */

export type CodeSystem = "ICD-10-CM" | "HCPCS" | "CPT";

export interface PerSystemResult {
  codeSystem: CodeSystem;
  /** number of rows parsed from the source file in this run (0 if no file). */
  parsedRows: number;
  /** parse/upsert error message, if any. */
  error?: string | null;
  /** Optional: the release-year of the file we actually loaded, e.g. "2026". */
  loadedReleaseLabel?: string | null;
}

export type AlertReason =
  | { kind: "error"; codeSystem: CodeSystem; message: string }
  | { kind: "missing"; codeSystem: CodeSystem; overdueSince: string };

export interface EvaluateRefreshOutcomeInput {
  now: Date;
  results: PerSystemResult[];
}

export interface EvaluateRefreshOutcomeResult {
  shouldAlert: boolean;
  reasons: AlertReason[];
}

/**
 * Is the new ICD-10-CM release overdue as of `now`?
 * Effective Oct 1, expected to be downloadable by Oct 15 of the same year.
 * The "release year" is the calendar year of that Oct 1 effective date.
 */
export function expectedIcd10ReleaseYear(now: Date): number | null {
  const y = now.getUTCFullYear();
  // Cutoff = Oct 15 of year Y at 00:00 UTC.
  const cutoff = Date.UTC(y, 9, 15);
  return now.getTime() >= cutoff ? y : null;
}

/**
 * Is the new HCPCS quarterly release overdue as of `now`?
 * Quarterly releases are effective Jan/Apr/Jul/Oct 1; the file is expected to
 * be downloadable by the 15th of that month. Returns an ISO date string for
 * the most recent overdue release, or null if no release is currently overdue.
 */
export function expectedHcpcsReleaseDate(now: Date): string | null {
  const y = now.getUTCFullYear();
  const releaseMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct (0-indexed)
  let latestOverdue: number | null = null;
  for (const m of releaseMonths) {
    const cutoff = Date.UTC(y, m, 15);
    if (now.getTime() >= cutoff) latestOverdue = cutoff;
  }
  if (latestOverdue == null) return null;
  const d = new Date(latestOverdue);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function evaluateRefreshOutcome(
  input: EvaluateRefreshOutcomeInput,
): EvaluateRefreshOutcomeResult {
  const reasons: AlertReason[] = [];

  for (const r of input.results) {
    if (r.error) {
      reasons.push({ kind: "error", codeSystem: r.codeSystem, message: r.error });
      // Don't double-fire "missing" on the same system if it also errored —
      // the error is the more actionable signal.
      continue;
    }

    if (r.parsedRows > 0) continue;

    if (r.codeSystem === "ICD-10-CM") {
      const overdueYear = expectedIcd10ReleaseYear(input.now);
      if (overdueYear != null) {
        reasons.push({
          kind: "missing",
          codeSystem: "ICD-10-CM",
          overdueSince: `${overdueYear}-10-15`,
        });
      }
    } else if (r.codeSystem === "HCPCS") {
      const overdue = expectedHcpcsReleaseDate(input.now);
      if (overdue != null) {
        reasons.push({ kind: "missing", codeSystem: "HCPCS", overdueSince: overdue });
      }
    }
    // CPT: no automated release calendar — never fire "missing" for it.
  }

  return { shouldAlert: reasons.length > 0, reasons };
}

/** Render a human-readable summary suitable for email/workqueue title. */
export function summarizeAlertReasons(reasons: AlertReason[]): string {
  if (reasons.length === 0) return "Billing-code refresh OK";
  const parts = reasons.map((r) => {
    if (r.kind === "error") return `${r.codeSystem} failed: ${r.message}`;
    return `${r.codeSystem} returned 0 rows but a new release was due by ${r.overdueSince}`;
  });
  return parts.join("; ");
}
