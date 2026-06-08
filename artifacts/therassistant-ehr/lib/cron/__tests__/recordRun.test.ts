import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { recordCronJobRun } from "../recordRun";

function makeFakeSupabase(opts: { insertError?: { message: string } } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  return {
    fake: {
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: opts.insertError ?? null });
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    inserts,
  };
}

describe("recordCronJobRun", () => {
  it("inserts into cron_job_runs with the given job + status + summary", async () => {
    const { fake, inserts } = makeFakeSupabase();
    await recordCronJobRun(fake, {
      jobId: "payments-no-response-scan",
      status: "success",
      organizationId: null,
      startedAt: new Date("2026-05-25T09:00:00Z"),
      summary: { totals: { scanned: 5 } },
    });
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].table, "cron_job_runs");
    assert.equal(inserts[0].row.job_id, "payments-no-response-scan");
    assert.equal(inserts[0].row.status, "success");
    assert.equal(inserts[0].row.organization_id, null);
    assert.equal(inserts[0].row.started_at, "2026-05-25T09:00:00.000Z");
    assert.deepEqual(inserts[0].row.summary, { totals: { scanned: 5 } });
  });

  it("never throws when the insert fails — heartbeat bookkeeping must not break the cron", async () => {
    const { fake } = makeFakeSupabase({ insertError: { message: "boom" } });
    await assert.doesNotReject(() =>
      recordCronJobRun(fake, { jobId: "x", status: "error" }),
    );
  });

  it("defaults organizationId and summary when omitted", async () => {
    const { fake, inserts } = makeFakeSupabase();
    await recordCronJobRun(fake, { jobId: "x", status: "success" });
    assert.equal(inserts[0].row.organization_id, null);
    assert.deepEqual(inserts[0].row.summary, {});
    assert.equal(inserts[0].row.started_at, null);
  });
});
