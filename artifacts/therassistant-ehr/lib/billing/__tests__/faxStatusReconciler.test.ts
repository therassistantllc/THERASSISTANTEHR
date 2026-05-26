/**
 * Tests for runFaxStatusReconcile (Task #726).
 *
 * After the dispatcher hands a fax to Telnyx the transmission sits in
 * status='sending'. The reconciler polls the provider for the terminal
 * outcome and flips the transmission to 'delivered' or 'failed'. These
 * tests exercise:
 *   1. 'delivered' from the provider → transmission flipped to delivered.
 *   2. 'failed' from the provider → transmission flipped to failed with
 *      the provider's failure_reason surfaced as the error.
 *   3. 'sending' from the provider → row left alone, will re-poll later.
 *   4. Rows still on the dispatcher placeholder (no sent_at) are
 *      skipped — the dispatcher owns them.
 *   5. Only fax-channel non-terminal rows for this org are polled.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { runFaxStatusReconcile } from "../faxStatusReconciler";
import type { FaxProvider, GetFaxStatusResult } from "@/lib/fax/provider";

const ORG = "00000000-0000-0000-0000-000000000001";
const OTHER_ORG = "00000000-0000-0000-0000-000000000099";

interface Tx {
  id: string;
  organization_id: string;
  channel: string;
  provider_message_id: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
}

function makeFake(transmissions: Tx[]): Parameters<typeof runFaxStatusReconcile>[0] {
  function from(table: string) {
    if (table !== "claim_documentation_transmissions" && table !== "fax_queue") {
      throw new Error(`unexpected table ${table}`);
    }
    const ctx: {
      table: string;
      org?: string;
      channel?: string;
      statusIn?: string[];
      id?: string;
      update?: Record<string, unknown>;
    } = { table };

    function matchSelect() {
      const rows = transmissions.filter(
        (t) =>
          t.organization_id === ctx.org &&
          (ctx.channel ? t.channel === ctx.channel : true) &&
          (ctx.statusIn ? ctx.statusIn.includes(t.status) : true),
      );
      return { data: rows, error: null };
    }

    function resolveUpdate(): Promise<{ data: null; error: null }> {
      if (ctx.table === "claim_documentation_transmissions" && ctx.id) {
        const row = transmissions.find((t) => t.id === ctx.id && t.organization_id === ctx.org);
        if (row) Object.assign(row, ctx.update ?? {});
      }
      return Promise.resolve({ data: null, error: null });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(matchSelect()),
      update: (v: unknown) => {
        ctx.update = v as Record<string, unknown>;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        if (col === "organization_id") ctx.org = String(val);
        else if (col === "channel") ctx.channel = String(val);
        else if (col === "id") ctx.id = String(val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        if (col === "status") ctx.statusIn = vals.map(String);
        return builder;
      },
      // Awaiting the builder resolves either an update (if .update was
      // called) or a select. This lets `await sb.from(t).update(p).eq().eq()`
      // and `await sb.from(t).select().eq().in()` both work.
      then: (resolve: (v: unknown) => unknown) => {
        if (ctx.update) return resolve(resolveUpdate());
        return resolve(matchSelect());
      },
    };
    return builder;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

function provider(map: Record<string, GetFaxStatusResult>): FaxProvider {
  return {
    name: "test-poll",
    configured: true,
    async send() {
      throw new Error("send not used in reconciler tests");
    },
    async getStatus(id) {
      return map[id] ?? { ok: false, error: `no stub for ${id}` };
    },
  };
}

describe("runFaxStatusReconcile", () => {
  it("flips transmission to delivered when Telnyx reports delivered", async () => {
    const txs: Tx[] = [
      {
        id: "tx-1",
        organization_id: ORG,
        channel: "fax",
        provider_message_id: "telnyx-1",
        status: "sending",
        error: null,
        sent_at: "2026-06-26T10:00:00Z",
      },
    ];
    const supabase = makeFake(txs);
    const r = await runFaxStatusReconcile(supabase, {
      organizationId: ORG,
      provider: provider({
        "telnyx-1": { ok: true, providerStatus: "delivered", normalized: "delivered" },
      }),
    });
    assert.equal(r.scanned, 1);
    assert.equal(r.delivered, 1);
    assert.equal(r.failed, 0);
    assert.equal(txs[0].status, "delivered");
    assert.equal(txs[0].error, null);
  });

  it("flips transmission to failed with the provider's failure reason", async () => {
    const txs: Tx[] = [
      {
        id: "tx-1",
        organization_id: ORG,
        channel: "fax",
        provider_message_id: "telnyx-2",
        status: "sending",
        error: null,
        sent_at: "2026-06-26T10:00:00Z",
      },
    ];
    const supabase = makeFake(txs);
    const r = await runFaxStatusReconcile(supabase, {
      organizationId: ORG,
      provider: provider({
        "telnyx-2": {
          ok: true,
          providerStatus: "failed",
          normalized: "failed",
          failureReason: "busy",
        },
      }),
    });
    assert.equal(r.failed, 1);
    assert.equal(txs[0].status, "failed");
    assert.match(String(txs[0].error), /busy/);
  });

  it("leaves still-sending rows alone and re-polls them later", async () => {
    const txs: Tx[] = [
      {
        id: "tx-1",
        organization_id: ORG,
        channel: "fax",
        provider_message_id: "telnyx-3",
        status: "sending",
        error: null,
        sent_at: "2026-06-26T10:00:00Z",
      },
    ];
    const supabase = makeFake(txs);
    const r = await runFaxStatusReconcile(supabase, {
      organizationId: ORG,
      provider: provider({
        "telnyx-3": { ok: true, providerStatus: "sending", normalized: "sending" },
      }),
    });
    assert.equal(r.stillSending, 1);
    assert.equal(r.delivered, 0);
    assert.equal(r.failed, 0);
    assert.equal(txs[0].status, "sending", "row is untouched");
  });

  it("skips rows still on the dispatcher placeholder (no sent_at)", async () => {
    const txs: Tx[] = [
      {
        id: "tx-pre-handoff",
        organization_id: ORG,
        channel: "fax",
        provider_message_id: "fax-queue-uuid-placeholder",
        status: "queued",
        error: null,
        sent_at: null,
      },
    ];
    const supabase = makeFake(txs);
    const r = await runFaxStatusReconcile(supabase, {
      organizationId: ORG,
      provider: provider({}),
    });
    assert.equal(r.scanned, 0);
    assert.equal(txs[0].status, "queued");
  });

  it("ignores other orgs and non-fax channels", async () => {
    const txs: Tx[] = [
      {
        id: "tx-mine",
        organization_id: ORG,
        channel: "fax",
        provider_message_id: "telnyx-mine",
        status: "sending",
        error: null,
        sent_at: "2026-06-26T10:00:00Z",
      },
      {
        id: "tx-other-org",
        organization_id: OTHER_ORG,
        channel: "fax",
        provider_message_id: "telnyx-other",
        status: "sending",
        error: null,
        sent_at: "2026-06-26T10:00:00Z",
      },
      {
        id: "tx-email",
        organization_id: ORG,
        channel: "email",
        provider_message_id: "smtp-1",
        status: "sending",
        error: null,
        sent_at: "2026-06-26T10:00:00Z",
      },
    ];
    const supabase = makeFake(txs);
    const r = await runFaxStatusReconcile(supabase, {
      organizationId: ORG,
      provider: provider({
        "telnyx-mine": { ok: true, providerStatus: "delivered", normalized: "delivered" },
      }),
    });
    assert.equal(r.scanned, 1);
    assert.equal(r.delivered, 1);
    assert.equal(txs.find((t) => t.id === "tx-other-org")!.status, "sending");
    assert.equal(txs.find((t) => t.id === "tx-email")!.status, "sending");
  });
});
