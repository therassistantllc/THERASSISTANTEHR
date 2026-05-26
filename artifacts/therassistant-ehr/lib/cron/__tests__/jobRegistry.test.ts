import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  CRON_JOBS,
  getCronJob,
  getAllCronJobHeartbeats,
  getCronJobHeartbeat,
  makeCronJobRunsProbe,
  claimStatusAutoCheckProbe,
} from "../jobRegistry";

interface FilterCall {
  table: string;
  col?: string;
  val?: unknown;
}

function makeFakeSupabase(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  const calls: FilterCall[] = [];
  function builder(table: string) {
    const rows = rowsByTable[table] ?? [];
    const self = {
      select: () => self,
      eq: (col: string, val: unknown) => {
        calls.push({ table, col, val });
        return self;
      },
      or: (expr: string) => {
        calls.push({ table, col: "or", val: expr });
        return self;
      },
      order: () => self,
      limit: () => self,
      then: (resolve: (r: { data: unknown; error: unknown }) => void) => {
        return resolve({ data: rows, error: null });
      },
    };
    return self;
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fake: { from: (t: string) => builder(t) } as any,
    calls,
  };
}

describe("CRON_JOBS registry", () => {
  it("registers both the claim-status auto-check and no-response scan", () => {
    const ids = CRON_JOBS.map((j) => j.id).sort();
    assert.deepEqual(ids, [
      "claim-status-auto-check",
      "payments-no-response-scan",
    ]);
  });

  it("each job has a sensible threshold and a label", () => {
    for (const job of CRON_JOBS) {
      assert.ok(job.label.length > 0, `${job.id} needs a label`);
      assert.ok(job.thresholdHours >= 24, `${job.id} threshold too tight`);
    }
  });

  it("getCronJob returns the matching entry or undefined", () => {
    assert.equal(getCronJob("payments-no-response-scan")?.id, "payments-no-response-scan");
    assert.equal(getCronJob("nope"), undefined);
  });
});

describe("makeCronJobRunsProbe", () => {
  it("filters by job_id and status='success' and returns the most-recent finished_at", async () => {
    const { fake, calls } = makeFakeSupabase({
      cron_job_runs: [{ finished_at: "2026-05-25T09:00:00Z" }],
    });
    const probe = makeCronJobRunsProbe("payments-no-response-scan");
    const r = await probe(fake, {});
    assert.equal(r.lastRunAt, "2026-05-25T09:00:00Z");
    assert.ok(
      calls.some(
        (c) => c.table === "cron_job_runs" && c.col === "job_id" && c.val === "payments-no-response-scan",
      ),
    );
    assert.ok(
      calls.some(
        (c) => c.table === "cron_job_runs" && c.col === "status" && c.val === "success",
      ),
    );
  });

  it("returns null lastRunAt when no rows exist", async () => {
    const { fake } = makeFakeSupabase({ cron_job_runs: [] });
    const r = await makeCronJobRunsProbe("payments-no-response-scan")(fake, {});
    assert.equal(r.lastRunAt, null);
  });

  it("adds an OR scope (this org OR global null) when organizationId provided", async () => {
    const { fake, calls } = makeFakeSupabase({ cron_job_runs: [] });
    await makeCronJobRunsProbe("payments-no-response-scan")(fake, {
      organizationId: "org-1",
    });
    assert.ok(
      calls.some(
        (c) => c.col === "or" && typeof c.val === "string" && (c.val as string).includes("org-1"),
      ),
      "OR scope should include the org id and the null branch",
    );
  });
});

describe("claimStatusAutoCheckProbe", () => {
  it("reads the latest trigger_source='auto' inquiry timestamp", async () => {
    const { fake, calls } = makeFakeSupabase({
      claim_status_inquiries: [{ created_at: "2026-05-25T09:00:00Z" }],
    });
    const probe = claimStatusAutoCheckProbe();
    const r = await probe(fake, {});
    assert.equal(r.lastRunAt, "2026-05-25T09:00:00Z");
    assert.ok(
      calls.some((c) => c.col === "trigger_source" && c.val === "auto"),
    );
  });
});

describe("getCronJobHeartbeat / getAllCronJobHeartbeats", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  it("reports 'ok' when probe returns a recent timestamp", async () => {
    const { fake } = makeFakeSupabase({
      claim_status_inquiries: [
        { created_at: new Date(now.getTime() - 5 * 3600_000).toISOString() },
      ],
    });
    const job = getCronJob("claim-status-auto-check")!;
    const hb = await getCronJobHeartbeat(fake, job, { now });
    assert.equal(hb.status, "ok");
    assert.equal(hb.jobId, "claim-status-auto-check");
    assert.equal(hb.label, job.label);
  });

  it("reports 'stale' when probe returns an old timestamp", async () => {
    const { fake } = makeFakeSupabase({
      claim_status_inquiries: [
        { created_at: new Date(now.getTime() - 100 * 3600_000).toISOString() },
      ],
    });
    const job = getCronJob("claim-status-auto-check")!;
    const hb = await getCronJobHeartbeat(fake, job, { now });
    assert.equal(hb.status, "stale");
    assert.equal(hb.runbookPath, job.runbookPath);
  });

  it("getAllCronJobHeartbeats returns one entry per registered job", async () => {
    const { fake } = makeFakeSupabase({
      claim_status_inquiries: [],
      cron_job_runs: [],
    });
    const all = await getAllCronJobHeartbeats(fake, { now });
    assert.equal(all.length, CRON_JOBS.length);
    for (const j of all) {
      assert.equal(j.status, "never_run");
    }
  });
});
