import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { DEFAULT_STALE_AFTER_HOURS, evaluateHeartbeat } from "../heartbeat";

describe("evaluateHeartbeat", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  it("returns 'never_run' when lastRunAt is null", () => {
    const r = evaluateHeartbeat({
      lastRunAt: null,
      thresholdHours: 36,
      now,
      jobLabel: "X",
      recoveryHint: "do Y.",
    });
    assert.equal(r.status, "never_run");
    assert.equal(r.lastRunAt, null);
    assert.equal(r.hoursSinceLastRun, null);
    assert.equal(r.thresholdHours, 36);
    assert.match(r.message, /X has never/);
    assert.match(r.message, /do Y\./);
  });

  it("returns 'ok' inside threshold", () => {
    const tenHoursAgo = new Date(now.getTime() - 10 * 3600_000).toISOString();
    const r = evaluateHeartbeat({
      lastRunAt: tenHoursAgo,
      thresholdHours: 36,
      now,
      jobLabel: "Job",
    });
    assert.equal(r.status, "ok");
    assert.equal(r.hoursSinceLastRun, 10);
    assert.match(r.message, /Job last ran 10h ago/);
  });

  it("returns 'stale' past threshold and includes recovery hint", () => {
    const fortyHoursAgo = new Date(now.getTime() - 40 * 3600_000).toISOString();
    const r = evaluateHeartbeat({
      lastRunAt: fortyHoursAgo,
      thresholdHours: 36,
      now,
      jobLabel: "Job",
      recoveryHint: "check pg_cron.",
    });
    assert.equal(r.status, "stale");
    assert.equal(r.hoursSinceLastRun, 40);
    assert.match(r.message, /has not run in 40h/);
    assert.match(r.message, /check pg_cron\./);
  });

  it("clamps invalid threshold to default", () => {
    const r = evaluateHeartbeat({
      lastRunAt: null,
      thresholdHours: 0,
      now,
      jobLabel: "J",
    });
    assert.equal(r.thresholdHours, DEFAULT_STALE_AFTER_HOURS);
  });

  it("returns 'stale' with null hours when timestamp unparseable", () => {
    const r = evaluateHeartbeat({
      lastRunAt: "not-a-date",
      thresholdHours: 36,
      now,
      jobLabel: "J",
    });
    assert.equal(r.status, "stale");
    assert.equal(r.hoursSinceLastRun, null);
  });
});
