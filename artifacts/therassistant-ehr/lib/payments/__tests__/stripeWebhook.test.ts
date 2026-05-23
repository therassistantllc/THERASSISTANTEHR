/**
 * Stripe webhook regression suite (Task #137).
 *
 * Pins the edge-case behavior of `/api/billing/payments/stripe-webhook`
 * that previously had no automated coverage and tends to fail silently
 * in production:
 *
 *   1. Signature verification — valid signature passes; tampered body,
 *      truncated hex, stale timestamp, and missing/extra v1 candidates
 *      all fail closed.
 *   2. Dual-event dedupe — two deliveries (charge.succeeded twice, or
 *      payment_intent.succeeded + charge.succeeded for the same charge)
 *      collapse into ONE client_payments row and the second returns
 *      alreadyPosted=true.
 *   3. PI-without-charge defer — payment_intent.succeeded without a
 *      resolvable charge id defers (no post, no workqueue) and a
 *      subsequent charge.succeeded posts cleanly under the same key.
 *   4. Missing metadata fallback — a charge.succeeded missing
 *      metadata.organization_id / metadata.client_id writes a
 *      workqueue_items row (work_type='patient_payment_review') and
 *      returns 200 (so Stripe doesn't retry forever).
 *
 * The route was refactored to expose `processStripeWebhook(rawBody,
 * signatureHeader, deps?)` so the supabase factory and posting engine
 * can be injected here without spinning up real infra. Production POST
 * still uses `defaultStripeWebhookDeps`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  defaultStripeWebhookDeps,
  extractPaymentDetails,
  processStripeWebhook,
  verifyStripeSignature,
  type StripeWebhookDeps,
} from "../../../app/api/billing/payments/stripe-webhook/route";
import { commitPatientPayment } from "../postingEngine/patientPayment";
import type { PatientPaymentResult } from "../postingEngine/patientPayment";
import {
  validateInsert,
  validateWritePayload,
} from "../../supabase/__tests__/schemaGuard";

const SECRET = "whsec_test_abc123";

/** Build a real Stripe-Signature header for a given body + timestamp. */
function signBody(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { header: `t=${ts},v1=${sig}`, ts, sig };
}

/* -------------------------------------------------------------------------- */
/* 1. Signature verification                                                  */
/* -------------------------------------------------------------------------- */

test("verifyStripeSignature accepts a valid t/v1 pair", () => {
  const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded" });
  const { header } = signBody(body);
  assert.equal(verifyStripeSignature(body, header, SECRET), true);
});

test("verifyStripeSignature rejects a tampered body", () => {
  const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded", amt: 100 });
  const { header } = signBody(body);
  // Same signature, mutated payload — must fail.
  const tampered = body.replace("100", "9999");
  assert.equal(verifyStripeSignature(tampered, header, SECRET), false);
});

test("verifyStripeSignature rejects timestamps outside the 5-minute window", () => {
  const body = JSON.stringify({ id: "evt_old" });
  const stale = Math.floor(Date.now() / 1000) - 60 * 10; // 10 minutes ago
  const { header } = signBody(body, SECRET, stale);
  assert.equal(verifyStripeSignature(body, header, SECRET), false);
});

test("verifyStripeSignature accepts when one of multiple v1 candidates matches", () => {
  // Mirrors Stripe's key-rotation header: t=...,v1=<bogus>,v1=<real>.
  const body = JSON.stringify({ id: "evt_rot" });
  const ts = Math.floor(Date.now() / 1000);
  const real = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  const bogus = "0".repeat(real.length);
  const header = `t=${ts},v1=${bogus},v1=${real}`;
  assert.equal(verifyStripeSignature(body, header, SECRET), true);
});

test("verifyStripeSignature rejects malformed hex without throwing", () => {
  const body = "{}";
  const ts = Math.floor(Date.now() / 1000);
  // 'zz' is not valid hex; must not throw and must return false.
  const header = `t=${ts},v1=zz`;
  assert.equal(verifyStripeSignature(body, header, SECRET), false);
});

test("verifyStripeSignature rejects header missing t= or v1=", () => {
  assert.equal(verifyStripeSignature("{}", null, SECRET), false);
  assert.equal(verifyStripeSignature("{}", "v1=deadbeef", SECRET), false);
  assert.equal(
    verifyStripeSignature("{}", `t=${Math.floor(Date.now() / 1000)}`, SECRET),
    false,
  );
});

test("processStripeWebhook returns 401 when signature is invalid", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded" });
  const res = await processStripeWebhook(body, "t=0,v1=deadbeef", makeDeps());
  assert.equal(res.status, 401);
});

test("processStripeWebhook returns 503 when STRIPE_WEBHOOK_SECRET is unset", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded" });
  const deps = makeDeps({ getSecret: () => undefined });
  const res = await processStripeWebhook(body, "anything", deps);
  assert.equal(res.status, 503);
});

/* -------------------------------------------------------------------------- */
/* 2. Dual-event dedupe via the route                                         */
/* -------------------------------------------------------------------------- */

test("charge.succeeded delivered twice posts once; second returns alreadyPosted=true", async () => {
  // The commit engine owns the unique-index dedupe; the route's contract
  // is that it forwards both deliveries with the same external id and
  // surfaces alreadyPosted on the second. Here we simulate the engine's
  // behavior (first commit fresh, second sees the prior row and short-circuits).
  const posted = new Map<string, string>();
  const commitCalls: Array<{ external: string; amount: number }> = [];

  const deps = makeDeps({
    commitPayment: async (input) => {
      commitCalls.push({ external: input.externalPaymentId ?? "", amount: input.amount });
      const existing = posted.get(input.externalPaymentId ?? "");
      if (existing) {
        return mkResult({ ok: true, alreadyPosted: true, paymentId: existing });
      }
      const id = `pay_${posted.size + 1}`;
      posted.set(input.externalPaymentId ?? "", id);
      return mkResult({ ok: true, alreadyPosted: false, paymentId: id });
    },
  });

  const body = JSON.stringify(chargeSucceededEvent({ chargeId: "ch_dup", amount: 5000 }));
  const { header } = signBody(body);

  const r1 = await processStripeWebhook(body, header, deps);
  const j1 = (await r1.json()) as { success: boolean; alreadyPosted: boolean; paymentId: string };
  assert.equal(r1.status, 200);
  assert.equal(j1.success, true);
  assert.equal(j1.alreadyPosted, false);

  const r2 = await processStripeWebhook(body, header, deps);
  const j2 = (await r2.json()) as { success: boolean; alreadyPosted: boolean; paymentId: string };
  assert.equal(r2.status, 200);
  assert.equal(j2.success, true);
  assert.equal(j2.alreadyPosted, true);
  assert.equal(j2.paymentId, j1.paymentId, "both deliveries must resolve to the same payment row");
  assert.equal(posted.size, 1, "only one logical client_payments row should exist");
  assert.equal(commitCalls.length, 2, "both webhook deliveries should reach commitPayment");
  assert.equal(commitCalls[0].external, commitCalls[1].external);
});

test("commitPatientPayment unique-violation fallback returns alreadyPosted (race-safe)", async () => {
  // Simulates two concurrent webhook deliveries: both pass the
  // pre-insert lookup (no existing row), then one inserts first and the
  // other hits Postgres' unique-constraint 23505. The loser must surface
  // alreadyPosted=true, not a generic error — otherwise the route would
  // write a noisy workqueue item for a normal dual-delivery.
  let preInsertLookups = 0;
  let inserts = 0;
  const winnerId = "11111111-1111-4111-8111-111111111111";

  const fake = makeFakeSupabaseForCommit({
    onClientPaymentsLookup: () => {
      preInsertLookups += 1;
      if (preInsertLookups === 1) return null; // before any insert, no row exists
      return { id: winnerId }; // after the failed insert, the winner is visible
    },
    onClientPaymentsInsert: () => {
      inserts += 1;
      // 23505 unique_violation from the (org, method, external_payment_id) index
      return { code: "23505", message: "duplicate key value violates unique constraint" };
    },
  });

  const res = await commitPatientPayment(
    {
      organizationId: "org-1",
      clientId: "client-1",
      amount: 50,
      method: "stripe",
      applyTo: { kind: "account_balance" },
      externalPaymentId: "ch_race",
      actor: { staffId: null, userId: null, role: "system", source: "test" },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fake as any,
  );

  assert.equal(res.ok, true, "23505 on dedupe-key insert must be treated as success");
  assert.equal(res.alreadyPosted, true);
  assert.equal(res.paymentId, winnerId);
  assert.equal(inserts, 1, "insert must be attempted exactly once");
  assert.equal(preInsertLookups, 2, "must look up again after 23505 to fetch the winner");
});

/* -------------------------------------------------------------------------- */
/* 3. PI-without-charge defers; subsequent charge posts                       */
/* -------------------------------------------------------------------------- */

test("payment_intent.succeeded without charge id defers; charge.succeeded then posts", async () => {
  const commitCalls: Array<{ external: string | null | undefined }> = [];
  const supabaseFromCalls: string[] = [];
  const deps = makeDeps({
    commitPayment: async (input) => {
      commitCalls.push({ external: input.externalPaymentId });
      return mkResult({ ok: true, alreadyPosted: false, paymentId: "pay_1" });
    },
    getSupabase: () => {
      // Should NOT be needed on a deferred PI (no workqueue write, no posting).
      return makeFakeSupabaseRecorder(supabaseFromCalls) as unknown as ReturnType<
        StripeWebhookDeps["getSupabase"]
      >;
    },
  });

  // PI event with no latest_charge, no charges.data → must defer.
  const piBody = JSON.stringify({
    id: "evt_pi_1",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_1",
        amount_received: 5000,
        currency: "usd",
        metadata: { organization_id: "org-1", client_id: "client-1" },
      },
    },
  });
  const piSig = signBody(piBody).header;

  const r1 = await processStripeWebhook(piBody, piSig, deps);
  const j1 = (await r1.json()) as { success: boolean; deferred?: boolean };
  assert.equal(r1.status, 200);
  assert.equal(j1.success, true);
  assert.equal(j1.deferred, true);
  assert.equal(commitCalls.length, 0, "deferred PI must not call the posting engine");
  assert.equal(
    supabaseFromCalls.length,
    0,
    "deferred PI must not touch supabase (no workqueue row)",
  );

  // Now the charge.succeeded for the same PI arrives — must post cleanly.
  const chargeBody = JSON.stringify(
    chargeSucceededEvent({
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      amount: 5000,
    }),
  );
  const chargeSig = signBody(chargeBody).header;

  const r2 = await processStripeWebhook(chargeBody, chargeSig, deps);
  const j2 = (await r2.json()) as { success: boolean; paymentId: string };
  assert.equal(r2.status, 200);
  assert.equal(j2.success, true);
  assert.equal(j2.paymentId, "pay_1");
  assert.equal(commitCalls.length, 1);
  assert.equal(commitCalls[0].external, "ch_1", "must dedupe on the CHARGE id, not the PI id");
});

test("PI with charge id posts under that charge id (PI metadata fallback works)", () => {
  // Sanity-check extractPaymentDetails: when the PI carries metadata and
  // a nested charge, we must surface the charge id and the PI metadata.
  const details = extractPaymentDetails({
    id: "evt_pi_2",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_2",
        amount: 7500,
        amount_received: 7500,
        currency: "usd",
        latest_charge: "ch_2",
        metadata: { organization_id: "org-1", client_id: "client-1" },
      },
    },
  });
  assert.ok(details);
  assert.equal(details!.chargeId, "ch_2");
  assert.equal(details!.paymentIntentId, "pi_2");
  assert.equal(details!.amountCents, 7500);
  assert.equal(details!.metadata.organization_id, "org-1");
});

/* -------------------------------------------------------------------------- */
/* 4. Missing metadata → workqueue_items row + 200                            */
/* -------------------------------------------------------------------------- */

test("charge.succeeded missing org metadata writes workqueue_items row and returns 200", async () => {
  // Need org context on the row so it routes to a tenant — the route uses
  // metadata.organization_id when client_id is missing.
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          validateInsert(table, row);
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const commitCalls: number[] = [];
  const deps = makeDeps({
    getSupabase: () => supabase as unknown as ReturnType<StripeWebhookDeps["getSupabase"]>,
    commitPayment: async () => {
      commitCalls.push(1);
      return mkResult({ ok: true, alreadyPosted: false, paymentId: "should_not_happen" });
    },
  });

  // organization_id present (needed to attach the WQ row), client_id missing.
  const body = JSON.stringify({
    id: "evt_nomd",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_nomd",
        amount: 1234,
        currency: "usd",
        metadata: { organization_id: "org-1" }, // no client_id
      },
    },
  });
  const { header } = signBody(body);

  const res = await processStripeWebhook(body, header, deps);
  assert.equal(res.status, 200, "missing-metadata path must NOT 5xx (Stripe would retry forever)");
  const json = (await res.json()) as { success: boolean; queuedForReview: boolean };
  assert.equal(json.queuedForReview, true);

  assert.equal(commitCalls.length, 0, "must not attempt to post a payment with missing metadata");
  const wq = inserts.find((i) => i.table === "workqueue_items");
  assert.ok(wq, "expected a workqueue_items insert");
  assert.equal(wq!.row.work_type, "patient_payment_review");
  assert.equal(wq!.row.organization_id, "org-1");
  assert.equal(wq!.row.source_object_type, "payment_posting");
  const ctx = wq!.row.context_payload as Record<string, unknown>;
  assert.equal(ctx.origin, "stripe_webhook");
  assert.equal(ctx.stripe_charge_id, "ch_nomd");
});

test("route still ignores unrelated event types with 200", async () => {
  const body = JSON.stringify({ id: "evt_x", type: "customer.updated", data: { object: {} } });
  const { header } = signBody(body);
  const deps = makeDeps();
  const res = await processStripeWebhook(body, header, deps);
  assert.equal(res.status, 200);
  const j = (await res.json()) as { success: boolean; ignored: boolean };
  assert.equal(j.ignored, true);
});

test("defaultStripeWebhookDeps is wired to real factories (regression guard)", () => {
  // If POST stops using the deps interface, prod will silently bypass the
  // engine. Cheap structural assertion that the default wiring exists.
  assert.equal(typeof defaultStripeWebhookDeps.getSupabase, "function");
  assert.equal(typeof defaultStripeWebhookDeps.commitPayment, "function");
  assert.equal(typeof defaultStripeWebhookDeps.reversePayment, "function");
  assert.equal(typeof defaultStripeWebhookDeps.getSecret, "function");
});

/* -------------------------------------------------------------------------- */
/* 5. charge.dispute.closed auto-reverse on lost (Task #173)                  */
/* -------------------------------------------------------------------------- */

test("dispute closed as LOST auto-reverses the matching client_payment and resolves the WQ", async () => {
  const reverseCalls: Array<{ orgId: string; targetId: string; reason: string }> = [];
  const wqUpdates: Array<Record<string, unknown>> = [];
  const supabase = makeFakeSupabaseForDispute({
    clientPayment: {
      id: "cp_1",
      organization_id: "org-1",
      client_id: "client-1",
      patient_invoice_id: "inv-1",
    },
    existingWorkqueueItem: { id: "wq_1", context_payload: { stripe_dispute_id: "du_lost" } },
    onWorkqueueUpdate: (row) => wqUpdates.push(row),
  });
  const deps = makeDeps({
    getSupabase: () => supabase as unknown as ReturnType<StripeWebhookDeps["getSupabase"]>,
    reversePayment: async (input) => {
      reverseCalls.push({
        orgId: input.organizationId,
        targetId: input.target.id,
        reason: input.reason,
      });
      return {
        ok: true,
        reversed: true,
        alreadyReversed: false,
        ledgerEntriesWritten: 1,
        workqueueItemsClosed: 0,
        auditLogIds: ["audit-1"],
        errors: [],
      };
    },
  });

  const body = JSON.stringify(disputeClosedEvent({ disputeId: "du_lost", chargeId: "ch_1", status: "lost", amount: 5000 }));
  const { header } = signBody(body);
  const res = await processStripeWebhook(body, header, deps);
  assert.equal(res.status, 200);
  const json = (await res.json()) as {
    success: boolean;
    workqueueItemId: string;
    disputeStatus: string;
    reversal: { attempted: boolean; ok: boolean; clientPaymentId: string };
  };
  assert.equal(json.success, true);
  assert.equal(json.disputeStatus, "lost");
  assert.equal(json.reversal.attempted, true);
  assert.equal(json.reversal.ok, true);
  assert.equal(json.reversal.clientPaymentId, "cp_1");
  assert.equal(reverseCalls.length, 1, "exactly one reversal must fire");
  assert.equal(reverseCalls[0].orgId, "org-1");
  assert.equal(reverseCalls[0].targetId, "cp_1");
  assert.match(reverseCalls[0].reason, /du_lost.*lost/);
  assert.equal(wqUpdates.length, 1);
  assert.equal(wqUpdates[0].status, "resolved", "WQ must be resolved when auto-reverse succeeds");
  assert.match(
    String(wqUpdates[0].description ?? ""),
    /Auto-reversed client_payment cp_1/,
    "WQ description must point at the reversal",
  );
});

test("dispute closed as WON resolves the WQ and does NOT call reversePayment", async () => {
  const reverseCalls: number[] = [];
  const wqUpdates: Array<Record<string, unknown>> = [];
  const supabase = makeFakeSupabaseForDispute({
    clientPayment: {
      id: "cp_2",
      organization_id: "org-1",
      client_id: "client-1",
      patient_invoice_id: null,
    },
    existingWorkqueueItem: { id: "wq_2", context_payload: { stripe_dispute_id: "du_won" } },
    onWorkqueueUpdate: (row) => wqUpdates.push(row),
  });
  const deps = makeDeps({
    getSupabase: () => supabase as unknown as ReturnType<StripeWebhookDeps["getSupabase"]>,
    reversePayment: async () => {
      reverseCalls.push(1);
      throw new Error("reversePayment must not be called for won disputes");
    },
  });

  const body = JSON.stringify(disputeClosedEvent({ disputeId: "du_won", chargeId: "ch_2", status: "won", amount: 5000 }));
  const { header } = signBody(body);
  const res = await processStripeWebhook(body, header, deps);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { reversal?: unknown; disputeStatus: string };
  assert.equal(json.disputeStatus, "won");
  assert.equal(json.reversal, undefined, "won disputes must not include a reversal block");
  assert.equal(reverseCalls.length, 0);
  assert.equal(wqUpdates[0].status, "resolved");
});

test("dispute closed as LOST leaves WQ in_progress when auto-reverse fails", async () => {
  const wqUpdates: Array<Record<string, unknown>> = [];
  const supabase = makeFakeSupabaseForDispute({
    clientPayment: {
      id: "cp_3",
      organization_id: "org-1",
      client_id: "client-1",
      patient_invoice_id: null,
    },
    existingWorkqueueItem: { id: "wq_3", context_payload: { stripe_dispute_id: "du_fail" } },
    onWorkqueueUpdate: (row) => wqUpdates.push(row),
  });
  const deps = makeDeps({
    getSupabase: () => supabase as unknown as ReturnType<StripeWebhookDeps["getSupabase"]>,
    reversePayment: async () => ({
      ok: false,
      reversed: false,
      alreadyReversed: false,
      ledgerEntriesWritten: 0,
      workqueueItemsClosed: 0,
      auditLogIds: [],
      errors: [{ field: "ledger", message: "simulated DB outage" }],
    }),
  });

  const body = JSON.stringify(disputeClosedEvent({ disputeId: "du_fail", chargeId: "ch_3", status: "lost", amount: 4200 }));
  const { header } = signBody(body);
  const res = await processStripeWebhook(body, header, deps);
  assert.equal(res.status, 200);
  assert.equal(wqUpdates.length, 1);
  assert.equal(wqUpdates[0].status, "in_progress", "failed auto-reverse must NOT resolve the WQ");
  assert.match(
    String(wqUpdates[0].description ?? ""),
    /Auto-reversal FAILED.*ledger: simulated DB outage/,
  );
});

test("dispute closed as LOST resolves WQ when reversal returns alreadyReversed", async () => {
  const wqUpdates: Array<Record<string, unknown>> = [];
  const supabase = makeFakeSupabaseForDispute({
    clientPayment: {
      id: "cp_4",
      organization_id: "org-1",
      client_id: "client-1",
      patient_invoice_id: null,
    },
    existingWorkqueueItem: { id: "wq_4", context_payload: { stripe_dispute_id: "du_idem" } },
    onWorkqueueUpdate: (row) => wqUpdates.push(row),
  });
  const deps = makeDeps({
    getSupabase: () => supabase as unknown as ReturnType<StripeWebhookDeps["getSupabase"]>,
    reversePayment: async () => ({
      ok: true,
      reversed: false,
      alreadyReversed: true,
      ledgerEntriesWritten: 0,
      workqueueItemsClosed: 0,
      auditLogIds: [],
      errors: [],
    }),
  });

  const body = JSON.stringify(disputeClosedEvent({ disputeId: "du_idem", chargeId: "ch_4", status: "lost", amount: 100 }));
  const { header } = signBody(body);
  const res = await processStripeWebhook(body, header, deps);
  assert.equal(res.status, 200);
  assert.equal(wqUpdates[0].status, "resolved");
  assert.match(
    String(wqUpdates[0].description ?? ""),
    /was already reversed/,
  );
});

function disputeClosedEvent(args: {
  disputeId: string;
  chargeId: string;
  status: string;
  amount: number;
}) {
  return {
    id: `evt_${args.disputeId}`,
    type: "charge.dispute.closed",
    data: {
      object: {
        id: args.disputeId,
        amount: args.amount,
        currency: "usd",
        charge: args.chargeId,
        status: args.status,
        reason: "fraudulent",
      },
    },
  };
}

/**
 * Minimal fake supabase that models the surface handleDisputeClosed
 * touches: client_payments lookup, workqueue_items lookup-by-dispute-id,
 * and workqueue_items update. Reversal itself is injected via
 * deps.reversePayment so this fake does NOT need to model the engine's
 * many writes.
 */
function makeFakeSupabaseForDispute(args: {
  clientPayment: {
    id: string;
    organization_id: string;
    client_id: string | null;
    patient_invoice_id: string | null;
  } | null;
  existingWorkqueueItem: { id: string; context_payload: Record<string, unknown> } | null;
  onWorkqueueUpdate?: (row: Record<string, unknown>) => void;
}) {
  return {
    from(table: string) {
      if (table === "client_payments") {
        // .select(...).eq.eq.is.maybeSingle()  (by external_payment_id)
        // .select(...).eq.is.maybeSingle()     (by stripe_charge_id)
        const chain = {
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => ({ data: args.clientPayment, error: null }),
        };
        return { select: () => chain };
      }
      if (table === "workqueue_items") {
        return {
          select: () => {
            // findDisputeWorkqueueItem chain:
            //   .select.eq.eq.is.order.limit  -> Array<row>
            const arr = args.existingWorkqueueItem ? [args.existingWorkqueueItem] : [];
            const chain = {
              eq: () => chain,
              is: () => chain,
              order: () => chain,
              limit: async () => ({ data: arr, error: null }),
            };
            return chain;
          },
          update(row: Record<string, unknown>) {
            validateWritePayload("workqueue_items", row);
            args.onWorkqueueUpdate?.(row);
            const chain = { eq: () => chain };
            // .update().eq().eq() resolves to {error:null}
            return Object.assign(Promise.resolve({ error: null }), chain);
          },
          insert: async (row: Record<string, unknown>) => {
            validateInsert("workqueue_items", row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected from(${table}) in dispute fake`);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function makeDeps(overrides: Partial<StripeWebhookDeps> = {}): StripeWebhookDeps {
  return {
    getSecret: () => SECRET,
    getSupabase: () => null,
    commitPayment: async () =>
      mkResult({ ok: true, alreadyPosted: false, paymentId: "pay_default" }),
    ...overrides,
  };
}

function mkResult(partial: {
  ok: boolean;
  alreadyPosted?: boolean;
  paymentId?: string | null;
  errors?: Array<{ field: string; message: string }>;
}): PatientPaymentResult {
  return {
    ok: partial.ok,
    posted: partial.ok && !partial.alreadyPosted,
    blocked: false,
    alreadyPosted: partial.alreadyPosted ?? false,
    validation: { blocking: [], warning: [] },
    effects: [],
    patientInvoiceCreated: false,
    workqueueItemsClosed: 0,
    auditLogIds: [],
    errors: partial.errors ?? [],
    paymentId: partial.paymentId ?? null,
    appliedAmount: 0,
    unappliedAmount: 0,
    creditId: null,
  };
}

function chargeSucceededEvent(args: {
  chargeId: string;
  paymentIntentId?: string;
  amount: number;
}) {
  return {
    id: `evt_${args.chargeId}`,
    type: "charge.succeeded",
    data: {
      object: {
        id: args.chargeId,
        amount: args.amount,
        currency: "usd",
        payment_intent: args.paymentIntentId ?? null,
        metadata: { organization_id: "org-1", client_id: "client-1" },
      },
    },
  };
}

function makeFakeSupabaseRecorder(calls: string[]) {
  return {
    from(table: string) {
      calls.push(table);
      return {
        insert: async () => ({ error: null }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

/**
 * Minimal fake supabase for exercising commitPatientPayment's stripe
 * dedupe code path (the only path this suite covers). Only models the
 * two builders the engine touches here:
 *   - .from("client_payments").select(...).eq.eq.eq.is.maybeSingle()
 *   - .from("client_payments").insert(...)
 * Everything else throws so accidental engine drift surfaces loudly
 * instead of silently passing.
 */
function makeFakeSupabaseForCommit(handlers: {
  onClientPaymentsLookup: () => { id: string } | null;
  onClientPaymentsInsert: () => { code?: string; message: string } | null;
}) {
  return {
    from(table: string) {
      if (table !== "client_payments") {
        throw new Error(`Unexpected from(${table}) — this fake only models client_payments`);
      }
      return {
        select() {
          // Chain: .eq().eq().eq().is().maybeSingle()
          const chain = {
            eq: () => chain,
            is: () => chain,
            maybeSingle: async () => {
              const row = handlers.onClientPaymentsLookup();
              return { data: row, error: null };
            },
          };
          return chain;
        },
        insert: async (row: Record<string, unknown>) => {
          validateInsert("client_payments", row);
          return { error: handlers.onClientPaymentsInsert() };
        },
      };
    },
  };
}
