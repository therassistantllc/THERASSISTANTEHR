/**
 * Coverage for `undoQueueAction` — the JS dispatcher for the per-row
 * "Undo last action" endpoint on the 12 second-wave billing workqueues.
 *
 * The real inverse behavior (restore previous_patch / archive an inserted
 * adjustment / cancel an inserted refund / un-link a reversal pair, plus
 * stamp a compensating audit row in the same transaction) is enforced by
 * the `undo_queue_action_atomic` SQL function. The JS layer's job is to
 * dispatch to that RPC with the right payload and surface its errors as
 * the right HTTP status — so the integration test exercises the SQL, and
 * these tests just lock the contract.
 */
import { describe, it, beforeEach, mock } from "node:test";
import { strict as assert } from "node:assert";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ORG = "11111111-1111-1111-1111-111111111111";
const ROW = "33333333-3333-3333-3333-333333333333";
const USER = "22222222-2222-2222-2222-222222222222";

type RpcCall = { fn: string; args: any };
const rpcCalls: RpcCall[] = [];
let rpcResponse: { data?: any; error?: any } = {
  data: { ok: true, mutation: null, undone_event_type: null, tab: null },
  error: null,
};

const fakeAdmin = {
  rpc(fn: string, args: any) {
    rpcCalls.push({ fn, args });
    return Promise.resolve(rpcResponse);
  },
};

const SUPABASE_URL = pathToFileURL(resolve(process.cwd(), "lib/supabase/server.ts")).href;
mock.module(SUPABASE_URL, {
  namedExports: {
    createServerSupabaseAdminClient: () => fakeAdmin,
    createServerSupabaseAdminClientTyped: () => fakeAdmin,
    createServerSupabaseServiceRoleClient: () => fakeAdmin,
    createServerSupabaseServiceRoleClientTyped: () => fakeAdmin,
  },
});

const { undoQueueAction } = require("../liveQueues") as typeof import("../liveQueues");

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResponse = {
    data: { ok: true, mutation: null, undone_event_type: null, tab: null },
    error: null,
  };
});

const QUEUE_ENDPOINTS = [
  "payer-rejections",
  "resubmissions",
  "partial-denials",
  "adjustments-review",
  "medical-necessity",
  "unposted-payments",
  "credit-balances",
  "reconciliation-exceptions",
  "bad-debt-review",
  "write-offs",
  "audit-queue",
  "compliance-holds",
];

describe("undoQueueAction — atomic RPC dispatch", () => {
  for (const ep of QUEUE_ENDPOINTS) {
    it(`${ep} dispatches to undo_queue_action_atomic with (org, endpoint, rowId, user)`, async () => {
      rpcResponse = {
        data: {
          ok: true,
          mutation: { table: "professional_claims", id: ROW, restored: { claim_status: "rejected_payer" } },
          undone_event_type: `xx_mark_resubmitted`,
          tab: "in_review",
        },
        error: null,
      };
      const r = await undoQueueAction(ep, ORG, ROW, USER);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.undoneEventType, "xx_mark_resubmitted");
        assert.equal(r.tab, "in_review");
        assert.ok(r.mutation);
      }
      assert.equal(rpcCalls.length, 1);
      const c = rpcCalls[0];
      assert.equal(c.fn, "undo_queue_action_atomic");
      assert.equal(c.args.p_organization_id, ORG);
      assert.equal(c.args.p_endpoint, ep);
      assert.equal(c.args.p_row_id, ROW);
      assert.equal(c.args.p_user_id, USER);
    });
  }
});

describe("undoQueueAction — error & guard handling", () => {
  it("rejects an unknown queue with 400 before any RPC call", async () => {
    const r = await undoQueueAction("not-a-queue", ORG, ROW, USER);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 400);
    assert.equal(rpcCalls.length, 0, "no RPC should fire for unknown queue");
  });

  it("maps P0002 (no action to undo) into a 404 so the route returns 404", async () => {
    rpcResponse = {
      data: null,
      error: { code: "P0002", message: "no action to undo for payer-rejections" },
    };
    const r = await undoQueueAction("payer-rejections", ORG, ROW, USER);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 404);
      assert.match(r.error, /no action to undo/);
    }
  });

  it("surfaces downstream-blocker (22023) errors as 400 with the DB message", async () => {
    rpcResponse = {
      data: null,
      error: { code: "22023", message: "cannot undo: refund has already been issued" },
    };
    const r = await undoQueueAction("credit-balances", ORG, ROW, USER);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 400);
      assert.match(r.error, /already been issued/);
    }
  });

  it("treats an already-undone latest action as a 400 ('already an undo')", async () => {
    rpcResponse = {
      data: null,
      error: { code: "22023", message: "last action was already an undo" },
    };
    const r = await undoQueueAction("adjustments-review", ORG, ROW, USER);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 400);
      assert.match(r.error, /already an undo/);
    }
  });
});
