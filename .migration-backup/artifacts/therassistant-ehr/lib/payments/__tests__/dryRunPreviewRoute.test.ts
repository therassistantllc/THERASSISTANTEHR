/**
 * End-to-end coverage for the dry-run "preview" pipeline on the
 * refund + reverse API routes (Task #168).
 *
 * Engine-level dry-run coverage already exists (Task #135 — the
 * commitPosting dispatch shim and reversalEngine.test.ts cover the
 * builders directly). What WAS uncovered: the API route in between.
 * A regression like forgetting to plumb `dryRun: true` from the body
 * into the engine call, surfacing a stale balance, or accidentally
 * letting the engine fall through to a live write would slip past
 * every existing test.
 *
 * Both tests:
 *   1. Build an in-memory fake of the supabase admin client preloaded
 *      with a posted ERA-835 + prior refund + prior recoupment.
 *   2. Invoke the route's exported `processRefundRequest` /
 *      `processReversalRequest` with `dryRun: true` and an injected
 *      fake supabase (also injected through the engine's
 *      `injectedSupabase` parameter).
 *   3. Assert the response body carries the expected `preview` shape
 *      AND that NO rows were written to payment_refunds /
 *      era_posting_ledger_entries / audit_logs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { processRefundRequest } from "../../../app/api/billing/payments/posted/[id]/refund/route";
import { processReversalRequest } from "../../../app/api/billing/payments/posted/[id]/reverse/route";
import type { PostingActor } from "../postingEngine";
import {
  validateInsert,
  validateWritePayload,
} from "../../supabase/__tests__/schemaGuard";

const ORG = "11111111-1111-1111-1111-111111111111";
const ERA_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const CLIENT_ID = "44444444-4444-4444-4444-444444444444";

const TEST_ACTOR: PostingActor = {
  staffId: "staff-1",
  userId: "user-1",
  role: "biller",
  source: "test:dryRunPreviewRoute",
};

/**
 * Minimal in-memory fake of the supabase-js builder surface used by the
 * dry-run preview path. Supports the operations exercised by
 * `loadPayment`, `buildRefundPreview`, and `buildReversalPreview`:
 * `.select`, `.eq`, `.is`, `.neq`, `.in`, `.maybeSingle`, plus the
 * `count: 'exact', head: true` form for the workqueue rollup.
 *
 * Any insert/update/upsert call records into `writes` so the tests can
 * assert "no writes were attempted" — a stronger guarantee than just
 * checking the seeded table snapshots, because it catches code paths
 * that would have hit the DB at all.
 */
function makeFakeSupabase(initial: Record<string, Array<Record<string, unknown>>>) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    era_claim_payments: [],
    client_payments: [],
    insurance_manual_payments: [],
    era_posting_ledger_entries: [],
    payment_refunds: [],
    payment_recoupments: [],
    patient_invoices: [],
    professional_claims: [],
    workqueue_items: [],
    audit_logs: [],
    ...initial,
  };
  const writes: Array<{ op: string; table: string; payload: unknown }> = [];

  function builder(tableName: string) {
    const ctx = {
      filters: [] as Array<[string, unknown]>,
      neqs: [] as Array<[string, unknown]>,
      isNulls: [] as string[],
      inSpec: [] as Array<[string, unknown[]]>,
      // jsonb `contains` predicates: every key in `sub` must be present
      // (deep-equal) inside the row's value at `col`.
      containsSpec: [] as Array<[string, Record<string, unknown>]>,
      mode: null as "select" | "count" | "insert" | "update" | null,
      single: false,
      maybe: false,
    };

    const exec = () => {
      let rows = tables[tableName] ?? [];
      rows = rows.filter((r) => ctx.filters.every(([k, v]) => r[k] === v));
      rows = rows.filter((r) => ctx.neqs.every(([k, v]) => r[k] !== v));
      rows = rows.filter((r) =>
        ctx.isNulls.every((k) => r[k] === null || r[k] === undefined),
      );
      for (const [k, vs] of ctx.inSpec) {
        rows = rows.filter((r) => vs.includes(r[k]));
      }
      for (const [col, sub] of ctx.containsSpec) {
        rows = rows.filter((r) => {
          const v = r[col] as Record<string, unknown> | null | undefined;
          if (!v || typeof v !== "object") return false;
          return Object.entries(sub).every(([k, val]) => v[k] === val);
        });
      }
      return rows;
    };

    const thenable = {
      then(onFul: (v: { data: unknown; error: null; count?: number }) => unknown) {
        if (ctx.mode === "count") {
          const res = exec();
          return Promise.resolve({ data: null, error: null, count: res.length }).then(
            onFul,
          );
        }
        if (ctx.mode === "select") {
          const res = exec();
          if (ctx.single || ctx.maybe) {
            return Promise.resolve({ data: res[0] ?? null, error: null }).then(onFul);
          }
          return Promise.resolve({ data: res, error: null }).then(onFul);
        }
        // Any insert/update is unexpected in dry-run mode — record it so
        // the test can fail loudly if a write slips through.
        return Promise.resolve({ data: null, error: null }).then(onFul);
      },
    };

    const chain: Record<string, unknown> = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count === "exact" && opts?.head) ctx.mode = "count";
        else if (ctx.mode === null) ctx.mode = "select";
        return chain;
      },
      insert(payload: unknown) {
        ctx.mode = "insert";
        validateInsert(
          tableName,
          payload as Record<string, unknown> | Array<Record<string, unknown>>,
        );
        writes.push({ op: "insert", table: tableName, payload });
        return chain;
      },
      update(payload: unknown) {
        ctx.mode = "update";
        validateWritePayload(tableName, payload as Record<string, unknown>);
        writes.push({ op: "update", table: tableName, payload });
        return chain;
      },
      eq(k: string, v: unknown) {
        ctx.filters.push([k, v]);
        return chain;
      },
      neq(k: string, v: unknown) {
        ctx.neqs.push([k, v]);
        return chain;
      },
      is(k: string, _v: unknown) {
        ctx.isNulls.push(k);
        return chain;
      },
      in(k: string, vs: unknown[]) {
        ctx.inSpec.push([k, vs]);
        return chain;
      },
      contains(col: string, sub: Record<string, unknown>) {
        ctx.containsSpec.push([col, sub]);
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      single() {
        ctx.single = true;
        return thenable;
      },
      maybeSingle() {
        ctx.maybe = true;
        return thenable;
      },
      then: thenable.then,
    };
    return chain;
  }

  return {
    tables,
    writes,
    client: { from: (t: string) => builder(t) },
  };
}

/** Seed a posted ERA-835 with one prior refund + one prior recoupment. */
function seedPostedEra() {
  return makeFakeSupabase({
    era_claim_payments: [
      {
        id: ERA_ID,
        organization_id: ORG,
        client_id: CLIENT_ID,
        professional_claim_id: CLAIM_ID,
        clp01_claim_control_number: "CTRL-001",
        clp04_payment_amount: 100,
        posting_status: "posted",
        reversed_at: null,
        voided_at: null,
        archived_at: null,
      },
    ],
    payment_refunds: [
      {
        id: "ref-prior",
        organization_id: ORG,
        source_era_claim_payment_id: ERA_ID,
        amount: 20,
        refund_status: "issued",
        archived_at: null,
      },
    ],
    payment_recoupments: [
      {
        id: "rec-prior",
        organization_id: ORG,
        source_era_claim_payment_id: ERA_ID,
        amount: 10,
        archived_at: null,
      },
    ],
    era_posting_ledger_entries: [
      {
        id: "led-1",
        organization_id: ORG,
        source_id: ERA_ID,
        source_type: "era_835",
        entry_type: "insurance_payment",
        amount: 100,
        group_code: null,
        reason_code: null,
        description: "Insurance payment posted from ERA 835 CLP04",
        professional_claim_id: CLAIM_ID,
        client_id: CLIENT_ID,
        archived_at: null,
      },
    ],
    workqueue_items: [
      {
        id: "wq-1",
        organization_id: ORG,
        // Canonical shape per .agents/memory/workqueue-items-schema.md:
        // payment-domain rows live under source_object_type='payment_posting'
        // with the original logical kind stashed in context_payload.
        source_object_type: "payment_posting",
        source_object_id: ERA_ID,
        context_payload: { logical_source_object_type: "era_claim_payment" },
        status: "open",
        archived_at: null,
      },
    ],
  });
}

/** Stub auth that returns a deterministic biller actor — never touches Supabase. */
async function stubRequireAuth(_org: string): Promise<PostingActor> {
  return TEST_ACTOR;
}

/* -------------------------------------------------------------------------- */
/* Refund preview                                                             */
/* -------------------------------------------------------------------------- */

test("refund preview route returns projected remaining balance and writes nothing", async () => {
  const fake = seedPostedEra();
  const { recordInsuranceRefund, recordPatientRefund } = await import(
    "../postingEngine/reversal"
  );

  const refundAmount = 30;
  const { status, payload } = await processRefundRequest(
    `era:${ERA_ID}`,
    {
      organizationId: ORG,
      refundType: "insurance",
      amount: refundAmount,
      reason: "Duplicate payer payment",
      dryRun: true,
    },
    {
      requireAuth: stubRequireAuth,
      recordInsuranceRefund,
      recordPatientRefund,
      supabase: fake.client as never,
    },
  );

  assert.equal(status, 200, "preview should return HTTP 200");
  assert.equal(payload.success, true);
  assert.equal(payload.ok, true);
  // The dry-run path leaves the refund row uninserted.
  assert.equal(payload.refundId, null);

  // Preview surfaces the projected balance math: 100 - 20 prior refund - 10
  // prior recoup = 70 remaining BEFORE the request; minus 30 asked = 40 AFTER.
  const preview = payload.preview as {
    paymentTotalImpact: number;
    priorRefundTotal: number;
    priorRecoupTotal: number;
    remainingRefundableBefore: number;
    remainingRefundableAfter: number;
    refundType: string;
    amount: number;
    compensatingLedgerEntry: { entryType: string; amount: number } | null;
  } | null;
  assert.ok(preview, "response should include a preview payload");
  assert.equal(preview.refundType, "insurance");
  assert.equal(preview.amount, refundAmount);
  assert.equal(preview.paymentTotalImpact, 100);
  assert.equal(preview.priorRefundTotal, 20);
  assert.equal(preview.priorRecoupTotal, 10);
  assert.equal(preview.remainingRefundableBefore, 70);
  assert.equal(preview.remainingRefundableAfter, 40);

  // No-write invariant: the dry-run path must not have attempted ANY
  // insert/update against the refund/ledger/audit tables.
  const writesByTable = (table: string) =>
    fake.writes.filter((w) => w.table === table);
  assert.deepEqual(writesByTable("payment_refunds"), []);
  assert.deepEqual(writesByTable("era_posting_ledger_entries"), []);
  assert.deepEqual(writesByTable("audit_logs"), []);

  // And the seeded snapshots remain at their original row counts.
  assert.equal(fake.tables.payment_refunds.length, 1);
  assert.equal(fake.tables.era_posting_ledger_entries.length, 1);
  assert.equal(fake.tables.audit_logs.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Reversal preview                                                           */
/* -------------------------------------------------------------------------- */

test("reversal preview route returns projected ledger compensation and writes nothing", async () => {
  const fake = seedPostedEra();
  const { reversePostedPayment } = await import("../postingEngine/reversal");

  const { status, payload } = await processReversalRequest(
    `era:${ERA_ID}`,
    {
      organizationId: ORG,
      reason: "Duplicate ERA imported",
      dryRun: true,
    },
    {
      requireAuth: stubRequireAuth,
      reversePostedPayment,
      supabase: fake.client as never,
    },
  );

  assert.equal(status, 200, "preview should return HTTP 200");
  assert.equal(payload.success, true);
  assert.equal(payload.ok, true);
  assert.equal(payload.reversed, false, "dry-run must not flip reversed=true");
  assert.equal(payload.alreadyReversed, false);

  // Preview surfaces the paired negative ledger compensation: one entry
  // mirroring the seeded +100 insurance_payment as -100.
  const preview = payload.preview as {
    paymentTotalImpact: number;
    ledgerReversalEntries: Array<{ entryType: string; amount: number; description: string }>;
    claimStatusChange: { claimId: string; from: string; to: string } | null;
    workqueueItemsToClose: number;
  } | null;
  assert.ok(preview, "response should include a preview payload");
  assert.equal(preview.paymentTotalImpact, 100);
  assert.equal(preview.ledgerReversalEntries.length, 1);
  assert.equal(preview.ledgerReversalEntries[0].entryType, "insurance_payment");
  assert.equal(preview.ledgerReversalEntries[0].amount, -100);
  assert.match(preview.ledgerReversalEntries[0].description, /^Reversal of /);
  assert.deepEqual(preview.claimStatusChange, {
    claimId: CLAIM_ID,
    from: "paid",
    to: "billed",
  });
  // One open workqueue item seeded above should be reported as closeable.
  assert.equal(preview.workqueueItemsToClose, 1);

  // No-write invariant: the dry-run path must not have attempted ANY
  // insert/update against the refund/ledger/audit tables.
  const writesByTable = (table: string) =>
    fake.writes.filter((w) => w.table === table);
  assert.deepEqual(writesByTable("payment_refunds"), []);
  assert.deepEqual(writesByTable("era_posting_ledger_entries"), []);
  assert.deepEqual(writesByTable("audit_logs"), []);

  // Seeded snapshots unchanged.
  assert.equal(fake.tables.payment_refunds.length, 1);
  assert.equal(fake.tables.era_posting_ledger_entries.length, 1);
  assert.equal(fake.tables.audit_logs.length, 0);
  // The era_claim_payments row must NOT have been flipped to 'reversed'.
  assert.equal(fake.tables.era_claim_payments[0].posting_status, "posted");
});
