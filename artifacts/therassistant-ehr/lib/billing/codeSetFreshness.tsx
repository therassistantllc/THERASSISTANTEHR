/**
 * Code-set freshness reporting (Task #197).
 *
 * The scheduled refresh upserts CMS-released ICD-10-CM, HCPCS, and CPT
 * code sets into `diagnosis_codes` / `procedure_codes`. Billers had no
 * in-app way to tell whether the data was current — this module
 * computes the max(updated_at) per (table, code_system) and decides
 * whether the load is stale relative to the latest CMS release date.
 *
 * CMS publishes new code sets on a known schedule:
 *   - ICD-10-CM: annual, effective October 1 of each year (FY).
 *   - HCPCS Level II: quarterly, effective the first of Jan/Apr/Jul/Oct.
 *   - CPT: annual, effective January 1 of each year.
 *
 * `computeCodeSetStatus` is a pure function so it can be unit-tested
 * without spinning up Supabase. `fetchCodeSetFreshness` wraps it with
 * the live database queries.
 */
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export type CodeSystemId = "ICD-10-CM" | "HCPCS" | "CPT";

export interface CodeSetRow {
  table: "diagnosis_codes" | "procedure_codes";
  codeSystem: CodeSystemId;
  /** ISO timestamp of the most recently touched row, or null if empty. */
  lastLoadedAt: string | null;
  /** Total active codes in this system. */
  activeCount: number;
}

export interface CodeSetStatus extends CodeSetRow {
  label: string;
  /** ISO date of the most recent CMS release that should already be loaded. */
  expectedReleaseDate: string;
  /** True when expectedReleaseDate is more than 30 days older than lastLoadedAt. */
  isStale: boolean;
  /** Human-friendly reason for staleness (or "Current" when not stale). */
  staleReason: string;
}

const STALE_GRACE_DAYS = 30;

const SYSTEMS: ReadonlyArray<{
  table: CodeSetRow["table"];
  codeSystem: CodeSystemId;
  label: string;
}> = [
  { table: "diagnosis_codes", codeSystem: "ICD-10-CM", label: "ICD-10-CM (Diagnoses)" },
  { table: "procedure_codes", codeSystem: "HCPCS", label: "HCPCS Level II (Procedures)" },
  { table: "procedure_codes", codeSystem: "CPT", label: "CPT (Procedures)" },
];

/**
 * Return the most recent CMS effective date for `system` that is on or
 * before `now`. Exposed for tests.
 */
export function latestCmsReleaseDate(system: CodeSystemId, now: Date): Date {
  const year = now.getUTCFullYear();
  if (system === "ICD-10-CM") {
    // FY release: Oct 1 each year.
    const thisYear = Date.UTC(year, 9, 1);
    const lastYear = Date.UTC(year - 1, 9, 1);
    return new Date(now.getTime() >= thisYear ? thisYear : lastYear);
  }
  if (system === "CPT") {
    // Annual: Jan 1 each year.
    return new Date(Date.UTC(year, 0, 1));
  }
  // HCPCS quarterly: Jan 1, Apr 1, Jul 1, Oct 1.
  const quarters = [0, 3, 6, 9].map((m) => Date.UTC(year, m, 1));
  const t = now.getTime();
  let latest = quarters[0];
  for (const q of quarters) {
    if (t >= q && q > latest) latest = q;
  }
  return new Date(latest);
}

/**
 * Pure compute: turns raw freshness rows into display-ready statuses.
 * `now` is injectable for deterministic tests.
 */
export function computeCodeSetStatus(rows: CodeSetRow[], now: Date): CodeSetStatus[] {
  const byKey = new Map(rows.map((r) => [`${r.table}::${r.codeSystem}`, r] as const));
  return SYSTEMS.map(({ table, codeSystem, label }) => {
    const row = byKey.get(`${table}::${codeSystem}`) ?? {
      table,
      codeSystem,
      lastLoadedAt: null,
      activeCount: 0,
    };
    const release = latestCmsReleaseDate(codeSystem, now);
    const expectedReleaseDate = release.toISOString().slice(0, 10);

    // Stale rule (per Task #197): the newest CMS release date has
    // passed by more than 30 days without a new load. That requires
    // BOTH:
    //   (a) the release itself is more than 30 days old relative to
    //       `now` (we don't expect an instant load on release day —
    //       CMS files take time to publish, license, and import), and
    //   (b) the last load happened before that release (or never).
    const releaseAgeDays = Math.floor((now.getTime() - release.getTime()) / 86_400_000);
    const releaseIsOverdue = releaseAgeDays > STALE_GRACE_DAYS;
    const loadedBeforeRelease =
      !row.lastLoadedAt || new Date(row.lastLoadedAt).getTime() < release.getTime();

    let isStale = false;
    let staleReason = "Current";
    if (!row.lastLoadedAt) {
      isStale = true;
      staleReason = "Never loaded";
    } else if (releaseIsOverdue && loadedBeforeRelease) {
      isStale = true;
      staleReason = `The ${expectedReleaseDate} CMS release has been out for ${releaseAgeDays} days without a new load`;
    }

    return {
      table,
      codeSystem,
      lastLoadedAt: row.lastLoadedAt,
      activeCount: row.activeCount,
      label,
      expectedReleaseDate,
      isStale,
      staleReason,
    };
  });
}

export type CodeSetFreshnessResult =
  | { ok: true; statuses: CodeSetStatus[]; fetchedAt: string }
  | { ok: false; error: string };

/**
 * Live DB fetch. Uses the admin client because the reference tables are
 * shared (no per-org scoping) and the read is harmless.
 */
export async function fetchCodeSetFreshness(now: Date = new Date()): Promise<CodeSetFreshnessResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, error: "Database not available" };
  }

  const rows: CodeSetRow[] = [];
  for (const { table, codeSystem } of SYSTEMS) {
    const latest = await supabase
      .from(table)
      .select("updated_at")
      .eq("code_system", codeSystem)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (latest.error) {
      return { ok: false, error: `Failed to read ${table}: ${latest.error.message}` };
    }
    const count = await supabase
      .from(table)
      .select("code", { count: "exact", head: true })
      .eq("code_system", codeSystem)
      .eq("is_active", true);
    if (count.error) {
      return { ok: false, error: `Failed to count ${table}: ${count.error.message}` };
    }
    const lastRow = latest.data?.[0] as { updated_at?: string | null } | undefined;
    rows.push({
      table,
      codeSystem,
      lastLoadedAt: lastRow?.updated_at ?? null,
      activeCount: count.count ?? 0,
    });
  }

  return {
    ok: true,
    statuses: computeCodeSetStatus(rows, now),
    fetchedAt: now.toISOString(),
  };
}
