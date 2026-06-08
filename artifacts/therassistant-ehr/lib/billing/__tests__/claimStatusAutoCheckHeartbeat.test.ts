/**
 * Tests for the nightly auto-check heartbeat (Task #706).
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  DEFAULT_STALE_AFTER_HOURS,
  getClaimStatusAutoCheckHeartbeat,
} from "../claimStatusAutoCheckHeartbeat";

interface Filter {
  col: string;
  val: unknown;
}

function makeFakeSupabase(opts: {
  rows?: Array<{ created_at: string }>;
  error?: { message: string };
  /** When set, organization_settings.maybeSingle() returns this setting_value. */
  lastRunSummary?: Record<string, unknown> | null;
}) {
  const recordedFilters: Filter[] = [];
  function builder(table: string) {
    const localFilters: Filter[] = [];
    const self = {
      select: () => self,
      eq: (col: string, val: unknown) => {
        recordedFilters.push({ col, val });
        localFilters.push({ col, val });
        return self;
      },
      order: () => self,
      limit: () => self,
      maybeSingle: () => {
        if (table === "organization_settings") {
          return Promise.resolve({
            data: opts.lastRunSummary ? { setting_value: opts.lastRunSummary } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (r: { data: unknown; error: unknown }) => void) => {
        if (opts.error) return resolve({ data: null, error: opts.error });
        return resolve({ data: opts.rows ?? [], error: null });
      },
    };
    return self;
  }
  return {
    fake: { from: (t: string) => builder(t) },
    recordedFilters,
  };
}

describe("getClaimStatusAutoCheckHeartbeat", () => {
  it("returns 'never_run' when no auto inquiries exist yet", async () => {
    const { fake } = makeFakeSupabase({ rows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await getClaimStatusAutoCheckHeartbeat(fake as any);
    assert.equal(r.status, "never_run");
    assert.equal(r.lastRunAt, null);
    assert.equal(r.hoursSinceLastRun, null);
    assert.equal(r.thresholdHours, DEFAULT_STALE_AFTER_HOURS);
    assert.match(r.message, /never produced an inquiry/);
  });

  it("returns 'ok' when the latest auto inquiry is inside the threshold", async () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const tenHoursAgo = new Date(now.getTime() - 10 * 3600 * 1000).toISOString();
    const { fake } = makeFakeSupabase({ rows: [{ created_at: tenHoursAgo }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await getClaimStatusAutoCheckHeartbeat(fake as any, { now });
    assert.equal(r.status, "ok");
    assert.equal(r.lastRunAt, tenHoursAgo);
    assert.equal(r.hoursSinceLastRun, 10);
  });

  it("returns 'stale' when the latest auto inquiry is older than the threshold", async () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const fortyHoursAgo = new Date(now.getTime() - 40 * 3600 * 1000).toISOString();
    const { fake } = makeFakeSupabase({ rows: [{ created_at: fortyHoursAgo }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await getClaimStatusAutoCheckHeartbeat(fake as any, { now });
    assert.equal(r.status, "stale");
    assert.equal(r.hoursSinceLastRun, 40);
    assert.equal(r.thresholdHours, DEFAULT_STALE_AFTER_HOURS);
    assert.match(r.message, /has not run in 40h/);
  });

  it("honors a custom staleAfterHours override", async () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const fifteenHoursAgo = new Date(now.getTime() - 15 * 3600 * 1000).toISOString();
    const { fake } = makeFakeSupabase({ rows: [{ created_at: fifteenHoursAgo }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await getClaimStatusAutoCheckHeartbeat(fake as any, {
      now,
      staleAfterHours: 12,
    });
    assert.equal(r.status, "stale");
    assert.equal(r.thresholdHours, 12);
  });

  it("scopes the query by organization_id when provided", async () => {
    const { fake, recordedFilters } = makeFakeSupabase({ rows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getClaimStatusAutoCheckHeartbeat(fake as any, { organizationId: "org-123" });
    assert.ok(
      recordedFilters.some((f) => f.col === "trigger_source" && f.val === "auto"),
      "filters by trigger_source=auto",
    );
    assert.ok(
      recordedFilters.some((f) => f.col === "organization_id" && f.val === "org-123"),
      "filters by organization_id when scoped",
    );
  });

  it("does NOT add an organization_id filter when scope is omitted", async () => {
    const { fake, recordedFilters } = makeFakeSupabase({ rows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getClaimStatusAutoCheckHeartbeat(fake as any);
    assert.ok(
      !recordedFilters.some((f) => f.col === "organization_id"),
      "no organization_id filter when unscoped",
    );
  });

  it("returns 'disabled' (not stale/never_run) when the org has auto-check turned off", async () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const eightHoursAgo = new Date(now.getTime() - 8 * 3600 * 1000).toISOString();
    const { fake } = makeFakeSupabase({
      // No auto inquiries — a disabled org never produces them.
      rows: [],
      lastRunSummary: {
        ran_at: eightHoursAgo,
        scanned: 0,
        dispatched: 0,
        skipped: 0,
        failures: 0,
        disabled: true,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await getClaimStatusAutoCheckHeartbeat(fake as any, {
      now,
      organizationId: "org-disabled",
    });
    assert.equal(r.status, "disabled");
    assert.equal(r.lastRunAt, eightHoursAgo);
    assert.equal(r.lastRunSummary?.disabled, true);
    assert.match(r.message, /disabled for this organization/);
  });

  it("returns the persisted lastRunSummary alongside an 'ok' verdict", async () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    const { fake } = makeFakeSupabase({
      rows: [{ created_at: twoHoursAgo }],
      lastRunSummary: {
        ran_at: twoHoursAgo,
        scanned: 14,
        dispatched: 6,
        skipped: 8,
        failures: 0,
        disabled: false,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await getClaimStatusAutoCheckHeartbeat(fake as any, {
      now,
      organizationId: "org-1",
    });
    assert.equal(r.status, "ok");
    assert.equal(r.lastRunSummary?.scanned, 14);
    assert.equal(r.lastRunSummary?.dispatched, 6);
    assert.equal(r.lastRunSummary?.skipped, 8);
  });

  it("surfaces the underlying error when supabase fails", async () => {
    const { fake } = makeFakeSupabase({ error: { message: "boom" } });
    await assert.rejects(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => getClaimStatusAutoCheckHeartbeat(fake as any),
      /boom/,
    );
  });
});
