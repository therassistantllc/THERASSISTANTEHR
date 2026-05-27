import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchClaimStatusInquiry } from "@/lib/billing/claimStatusDispatcher";

/**
 * Auto-check (cron) scanner for the Payer Received queue.
 *
 * Today the 276 only fires when a biller clicks "Check payer status" in
 * the Payer Received detail panel. For aging claims that sit in
 * Payer Received for days, billers want the system to poll on a cadence
 * (e.g. every 48–72 hours) and surface anything the payer has updated
 * since the last check.
 *
 * The scanner finds claims that:
 *   1. are currently in the Payer Received queue (claim_status='accepted_payer'),
 *   2. were sent to the payer at least `ageDays` ago, AND
 *   3. have NOT had any claim_status_inquiries row created in the last
 *      `recheckIntervalDays` (so we don't re-poll a claim a biller just
 *      manually checked, and don't auto-poll the same claim every cron tick).
 *
 * For each matching claim it queues a new claim_status_inquiries row with
 * `trigger_source='auto'` and `created_by_user_id=null`, then dispatches it
 * through the SAME `dispatchClaimStatusInquiry` the manual button uses so
 * the wire/persistence/history behavior is identical to manual checks.
 */

export interface RunClaimStatusAutoCheckInput {
  organizationId: string;
  /** Minimum age (in days) of `submitted_at` before a claim is eligible. Default 3. */
  ageDays?: number;
  /**
   * Skip claims that already have any inquiry requested within this many
   * days, regardless of trigger_source. Default 2 (48h).
   */
  recheckIntervalDays?: number;
  /** Hard cap so a runaway cron call can't fan out to thousands of payers. */
  maxClaims?: number;
}

export interface ClaimAutoCheckOutcome {
  claimId: string;
  inquiryId: string | null;
  inquiryStatus: "received" | "failed" | "skipped";
  reason?: string;
  errorMessage?: string | null;
}

export interface RunClaimStatusAutoCheckResult {
  scanned: number;
  dispatched: number;
  skipped: number;
  failures: number;
  outcomes: ClaimAutoCheckOutcome[];
  /** True when the org has the auto-check feature switched off. */
  disabled?: boolean;
}

/**
 * Setting key used to persist a per-org snapshot of the most recent cron
 * run so the Billing Defaults page can show "last cron run: 2h ago —
 * scanned 14, polled 6, skipped 8" without depending on log scraping.
 *
 * The cron updates this AFTER each per-org run (including the disabled
 * short-circuit). The Billing Defaults UI reads it via the heartbeat
 * endpoint and renders a tile.
 */
export const AUTO_CHECK_LAST_RUN_SETTING_KEY = "payer_status.auto_check_last_run";

export interface AutoCheckLastRunSummary {
  ran_at: string;
  scanned: number;
  dispatched: number;
  skipped: number;
  failures: number;
  disabled: boolean;
}

const DEFAULT_AGE_DAYS = 3;
const DEFAULT_RECHECK_DAYS = 2;
const DEFAULT_MAX_CLAIMS = 200;
const DEFAULT_ENABLED = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, any, any>;

interface OrgSettingRow {
  setting_value: unknown;
}

async function loadRawSetting(
  supabase: Sb,
  organizationId: string,
  key: string,
): Promise<unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const { data } = await sb
      .from("organization_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", key)
      .maybeSingle();
    return (data as OrgSettingRow | null)?.setting_value ?? null;
  } catch {
    // organization_settings is optional; fall back to caller-provided defaults.
    return null;
  }
}

async function loadIntSetting(
  supabase: Sb,
  organizationId: string,
  key: string,
): Promise<number | null> {
  const v = await loadRawSetting(supabase, organizationId, key);
  if (v == null) return null;
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return null;
}

/** Parse permissive boolean: true/false, "true"/"false", 1/0, "1"/"0". */
function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return null;
}

async function loadBoolSetting(
  supabase: Sb,
  organizationId: string,
  key: string,
): Promise<boolean | null> {
  return coerceBool(await loadRawSetting(supabase, organizationId, key));
}

/**
 * Resolve effective thresholds from org settings → caller overrides → defaults.
 * Per-org overrides live in `organization_settings`:
 *   - payer_status.auto_check_age_days       (default 3)
 *   - payer_status.auto_recheck_interval_days (default 2)
 */
export async function resolveAutoCheckConfig(
  supabase: Sb,
  organizationId: string,
  input: { ageDays?: number; recheckIntervalDays?: number } = {},
): Promise<{ ageDays: number; recheckIntervalDays: number; enabled: boolean }> {
  // Read the raw stored age value FIRST so we can detect the `0` sentinel
  // ("disabled") before loadIntSetting silently rejects it.
  const orgAgeRaw = await loadRawSetting(
    supabase,
    organizationId,
    "payer_status.auto_check_age_days",
  );
  const orgAgeNum = Number(
    typeof orgAgeRaw === "string" || typeof orgAgeRaw === "number" ? orgAgeRaw : NaN,
  );
  const orgAgeSentinelOff = Number.isFinite(orgAgeNum) && orgAgeNum === 0;
  const orgAge =
    Number.isFinite(orgAgeNum) && orgAgeNum > 0 ? Math.floor(orgAgeNum) : null;

  const orgRecheck = await loadIntSetting(
    supabase,
    organizationId,
    "payer_status.auto_recheck_interval_days",
  );
  const orgEnabled = await loadBoolSetting(
    supabase,
    organizationId,
    "payer_status.auto_check_enabled",
  );

  const ageDays =
    (input.ageDays != null && input.ageDays > 0 ? Math.floor(input.ageDays) : null) ??
    orgAge ??
    DEFAULT_AGE_DAYS;
  const recheckIntervalDays =
    (input.recheckIntervalDays != null && input.recheckIntervalDays > 0
      ? Math.floor(input.recheckIntervalDays)
      : null) ??
    orgRecheck ??
    DEFAULT_RECHECK_DAYS;

  // Disabled if the explicit flag is false OR the age sentinel is 0.
  const enabled = (orgEnabled ?? DEFAULT_ENABLED) && !orgAgeSentinelOff;

  return { ageDays, recheckIntervalDays, enabled };
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persist a per-org snapshot of the most recent cron run into
 * `organization_settings`. Wrapped in try/catch so a settings-write
 * failure can never blow up the cron run itself; the heartbeat tile
 * is best-effort observability, not a hard dependency.
 */
async function persistAutoCheckLastRun(
  supabase: Sb,
  organizationId: string,
  summary: AutoCheckLastRunSummary,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const now = new Date().toISOString();
    await sb.from("organization_settings").upsert(
      {
        organization_id: organizationId,
        setting_key: AUTO_CHECK_LAST_RUN_SETTING_KEY,
        setting_value: summary,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,setting_key" },
    );
  } catch (e) {
    console.warn(
      `[claimStatusAutoCheck] failed to persist last-run summary for ${organizationId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

export async function runClaimStatusAutoCheck(
  supabase: Sb,
  input: RunClaimStatusAutoCheckInput,
): Promise<RunClaimStatusAutoCheckResult> {
  const { organizationId } = input;
  const { ageDays, recheckIntervalDays, enabled } = await resolveAutoCheckConfig(
    supabase,
    organizationId,
    input,
  );
  if (!enabled) {
    await persistAutoCheckLastRun(supabase, organizationId, {
      ran_at: new Date().toISOString(),
      scanned: 0,
      dispatched: 0,
      skipped: 0,
      failures: 0,
      disabled: true,
    });
    return {
      scanned: 0,
      dispatched: 0,
      skipped: 0,
      failures: 0,
      outcomes: [],
      disabled: true,
    };
  }
  const maxClaims = input.maxClaims ?? DEFAULT_MAX_CLAIMS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };

  const nowMs = Date.now();
  const submittedBefore = new Date(nowMs - ageDays * 86400_000).toISOString();
  const recheckCutoff = new Date(nowMs - recheckIntervalDays * 86400_000).toISOString();

  // Pull candidate claims: in Payer Received and old enough to warrant a poll.
  const { data: claims, error: claimsErr } = await sb
    .from("professional_claims")
    .select("id, submitted_at, claim_status")
    .eq("organization_id", organizationId)
    .eq("claim_status", "accepted_payer")
    .not("submitted_at", "is", null)
    .lte("submitted_at", submittedBefore)
    .order("submitted_at", { ascending: true })
    .limit(maxClaims);

  if (claimsErr) {
    throw new Error(claimsErr.message ?? "Failed to load candidate claims");
  }
  const candidates = (claims ?? []) as Array<{ id: string; submitted_at: string | null }>;
  const result: RunClaimStatusAutoCheckResult = {
    scanned: candidates.length,
    dispatched: 0,
    skipped: 0,
    failures: 0,
    outcomes: [],
  };
  if (candidates.length === 0) {
    await persistAutoCheckLastRun(supabase, organizationId, {
      ran_at: new Date().toISOString(),
      scanned: 0,
      dispatched: 0,
      skipped: 0,
      failures: 0,
      disabled: false,
    });
    return result;
  }

  // Look up the most recent inquiry per claim in one query — claims whose
  // latest inquiry is more recent than `recheckCutoff` are skipped.
  const claimIds = candidates.map((c) => c.id);
  const { data: recent } = await sb
    .from("claim_status_inquiries")
    .select("claim_id, requested_at")
    .eq("organization_id", organizationId)
    .in("claim_id", claimIds)
    .gte("requested_at", recheckCutoff)
    .is("archived_at", null);
  const recentClaimIds = new Set<string>(
    ((recent ?? []) as Array<{ claim_id: string }>).map((r) => r.claim_id),
  );

  for (const claim of candidates) {
    if (recentClaimIds.has(claim.id)) {
      result.skipped += 1;
      result.outcomes.push({
        claimId: claim.id,
        inquiryId: null,
        inquiryStatus: "skipped",
        reason: `inquiry within ${recheckIntervalDays}d`,
      });
      continue;
    }

    const queuedAt = new Date().toISOString();
    const inquiryId = uuid();
    const { data: inserted, error: insertErr } = await sb
      .from("claim_status_inquiries")
      .insert({
        id: inquiryId,
        organization_id: organizationId,
        claim_id: claim.id,
        inquiry_status: "queued",
        requested_at: queuedAt,
        duplicate_detection_key: `payer_received_auto:${claim.id}:${queuedAt}`,
        created_by_user_id: null,
        trigger_source: "auto",
      })
      .select("id")
      .single();

    if (insertErr || !inserted?.id) {
      result.failures += 1;
      result.outcomes.push({
        claimId: claim.id,
        inquiryId: null,
        inquiryStatus: "failed",
        errorMessage: insertErr?.message ?? "Failed to queue auto inquiry",
      });
      continue;
    }

    try {
      const outcome = await dispatchClaimStatusInquiry({
        supabase,
        organizationId,
        claimId: claim.id,
        inquiryId: inserted.id as string,
      });
      if (outcome.inquiryStatus === "received") {
        result.dispatched += 1;
      } else {
        result.failures += 1;
      }
      result.outcomes.push({
        claimId: claim.id,
        inquiryId: inserted.id as string,
        inquiryStatus: outcome.inquiryStatus,
        errorMessage: outcome.errorMessage,
      });
    } catch (e) {
      result.failures += 1;
      result.outcomes.push({
        claimId: claim.id,
        inquiryId: inserted.id as string,
        inquiryStatus: "failed",
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await persistAutoCheckLastRun(supabase, organizationId, {
    ran_at: new Date().toISOString(),
    scanned: result.scanned,
    dispatched: result.dispatched,
    skipped: result.skipped,
    failures: result.failures,
    disabled: false,
  });

  return result;
}
