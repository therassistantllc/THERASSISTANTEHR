/**
 * Coverage for `recordQueueAction` — the generic recorder that every
 * second-wave billing workqueue funnels its row actions through.
 *
 * The real-world record mutation (claim_status flip, payment_adjustment
 * insert, refund insert, alert resolve, …) AND the audit_logs overlay
 * stamp are wrapped in a single Postgres function
 * (`record_queue_action_atomic`) so they commit-or-rollback together.
 * The JS layer's only job is to dispatch to that RPC with the right
 * payload and surface its errors as the right HTTP status.
 *
 * These tests stub the supabase admin client with a fake `.rpc()` and
 * assert, for each of the 12 queues:
 *   - the RPC is invoked with the correct (endpoint, action, row_id,
 *     user, extras, target_tab, event_type, event_summary) payload;
 *   - a successful RPC return propagates `mutation` back to the caller;
 *   - RPC errors map to the right HTTP status (P0002 → 404, else 400);
 *   - unknown queues / actions are rejected before any RPC call.
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
let rpcResponse: { data?: any; error?: any } = { data: { ok: true, mutation: null }, error: null };

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

const { recordQueueAction } = require("../liveQueues") as typeof import("../liveQueues");

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResponse = { data: { ok: true, mutation: null }, error: null };
});

// ── Per-queue dispatch contract ─────────────────────────────────────────────
// One test per queue verifies the headline action funnels to the atomic RPC
// with the right payload. The actual SQL behavior (mutation + audit in one
// txn) is enforced by the RPC migration; the JS layer just dispatches.

interface DispatchCase {
  endpoint: string;
  action: string;
  expectedEventType: string;
  expectedTargetTab: string;
  extras?: Record<string, unknown>;
  mutation?: Record<string, unknown> | null;
}

const DISPATCH_CASES: DispatchCase[] = [
  { endpoint: "payer-rejections", action: "mark_resubmitted",
    expectedEventType: "pr_mark_resubmitted", expectedTargetTab: "resubmitted",
    mutation: { table: "professional_claims", id: ROW, patch: { claim_status: "submitted" } } },
  { endpoint: "resubmissions", action: "mark_submitted",
    expectedEventType: "rs_mark_submitted", expectedTargetTab: "submitted",
    mutation: { table: "professional_claims", id: ROW, patch: { claim_status: "submitted" } } },
  { endpoint: "partial-denials", action: "write_off",
    expectedEventType: "pd_write_off", expectedTargetTab: "written_off",
    extras: { note: "PR45 shortfall" },
    mutation: { table: "payment_adjustments", inserted_id: "adj-1", amount: 80 } },
  { endpoint: "adjustments-review", action: "approve",
    expectedEventType: "ar_approve", expectedTargetTab: "approved",
    mutation: { table: "payment_adjustments", id: ROW, patch: { posted_at: "now" } } },
  { endpoint: "medical-necessity", action: "send_appeal",
    expectedEventType: "mn_send_appeal", expectedTargetTab: "appeal_sent",
    mutation: { table: "professional_claims", id: "claim-1", patch: { claim_status: "appealing" } } },
  { endpoint: "unposted-payments", action: "post_to_claim",
    expectedEventType: "up_post_to_claim", expectedTargetTab: "all",
    mutation: { table: "era_claim_payments", id: ROW, patch: { posting_status: "posted" } } },
  { endpoint: "credit-balances", action: "propose_refund",
    expectedEventType: "cb_propose_refund", expectedTargetTab: "needs_refund",
    mutation: { table: "payment_refunds", inserted_id: "refund-1", amount: 50 } },
  { endpoint: "reconciliation-exceptions", action: "resolve",
    expectedEventType: "re_resolve", expectedTargetTab: "resolved",
    mutation: { table: "external_transactions", id: ROW, patch: { processing_status: "cancelled" } } },
  { endpoint: "bad-debt-review", action: "approve",
    expectedEventType: "bd_approve", expectedTargetTab: "approved",
    mutation: { table: "patient_balances", id: ROW, patch: { in_collections: true } } },
  { endpoint: "write-offs", action: "mark_reversal",
    expectedEventType: "wo_mark_reversal", expectedTargetTab: "reversals",
    mutation: { table: "payment_adjustments", reversed_id: ROW, reversal_id: "adj-2", amount: -80 } },
  { endpoint: "audit-queue", action: "complete_audit",
    expectedEventType: "aq_complete_audit", expectedTargetTab: "complete",
    mutation: { table: "billing_alerts", id: ROW, patch: { status: "resolved" } } },
  { endpoint: "compliance-holds", action: "release",
    expectedEventType: "ch_release", expectedTargetTab: "released",
    mutation: { table: "professional_claims", id: ROW, patch: { claim_status: "ready_to_submit" } } },
];

describe("recordQueueAction — atomic RPC dispatch per queue", () => {
  for (const c of DISPATCH_CASES) {
    it(`${c.endpoint} → ${c.action} dispatches atomically`, async () => {
      rpcResponse = { data: { ok: true, mutation: c.mutation ?? null }, error: null };
      const res = await recordQueueAction(c.endpoint, ORG, ROW, c.action, USER, c.extras ?? {});
      assert.deepEqual(res, { ok: true, mutation: c.mutation ?? null });
      assert.equal(rpcCalls.length, 1, "expected exactly one RPC call");
      const call = rpcCalls[0];
      assert.equal(call.fn, "record_queue_action_atomic");
      assert.equal(call.args.p_organization_id, ORG);
      assert.equal(call.args.p_endpoint, c.endpoint);
      assert.equal(call.args.p_action, c.action);
      assert.equal(call.args.p_row_id, ROW);
      assert.equal(call.args.p_user_id, USER);
      assert.deepEqual(call.args.p_extras, c.extras ?? {});
      assert.equal(call.args.p_target_tab, c.expectedTargetTab);
      assert.equal(call.args.p_event_type, c.expectedEventType);
      assert.equal(call.args.p_event_summary, `${c.endpoint} → ${c.action}`);
    });
  }
});

describe("recordQueueAction — error & guard handling", () => {
  it("rejects an unknown queue with 400 before any RPC call", async () => {
    const r = await recordQueueAction("not-a-queue", ORG, ROW, "approve", USER, {});
    assert.equal(r.ok, false);
    if (r.ok === false) assert.equal(r.status, 400);
    assert.equal(rpcCalls.length, 0, "no RPC should fire for unknown queue");
  });

  it("rejects an unsupported action with 400 before any RPC call", async () => {
    const r = await recordQueueAction("payer-rejections", ORG, ROW, "not-an-action", USER, {});
    assert.equal(r.ok, false);
    if (r.ok === false) assert.equal(r.status, 400);
    assert.equal(rpcCalls.length, 0);
  });

  it("maps a Postgres P0002 (no rows) into a 404 so the route returns 404", async () => {
    rpcResponse = { data: null, error: { code: "P0002", message: "claim not found" } };
    const r = await recordQueueAction("payer-rejections", ORG, ROW, "mark_resubmitted", USER, {});
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.status, 404);
      assert.match(r.error, /not found/);
    }
  });

  it("surfaces non-404 RPC errors as 400 with the DB message", async () => {
    rpcResponse = {
      data: null,
      error: { code: "22023", message: "no shortfall to write off on era payment" },
    };
    const r = await recordQueueAction("partial-denials", ORG, ROW, "write_off", USER, {});
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.status, 400);
      assert.match(r.error, /no shortfall/);
    }
  });
});
