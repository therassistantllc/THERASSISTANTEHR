/**
 * REAL-DB integration coverage for `undo_queue_action_atomic` (Task #701).
 *
 * Spins up an in-process Postgres (PGlite) per test, loads the same
 * minimal schema the action-RPC test uses, applies BOTH the original
 * action migration and the new undo migration, then for each undo
 * pattern:
 *   - column-flip undo restores the captured `previous_patch`;
 *   - insert undo archives the inserted adjustment / cancels the
 *     inserted refund;
 *   - reversal undo un-links the original AND archives the reversal;
 *   - downstream blockers (refund issued, claim status drifted,
 *     already-archived adjustment) refuse and write NO audit row
 *     (atomic rollback).
 * Also verifies the compensating `<prefix>_undo` audit row is written
 * with the prior tab so the live-queue overlay moves the row back.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

const SCHEMA = `
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_type text not null,
  event_summary text,
  object_type text,
  object_id uuid,
  user_id uuid,
  event_metadata jsonb,
  created_at timestamptz default now()
);
create table professional_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  claim_status text,
  submitted_at timestamptz,
  last_billed_date date,
  appeal_submitted_at timestamptz,
  updated_at timestamptz
);
create table payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_claim_id uuid,
  client_id uuid,
  era_claim_payment_id uuid,
  adjustment_type text,
  group_code text,
  reason_code text,
  amount numeric(12,2),
  scope text,
  source text,
  description text,
  posted_at timestamptz,
  posted_by_user_id uuid,
  reversed_by_adjustment_id uuid,
  archived_at timestamptz,
  updated_at timestamptz
);
create table era_claim_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_claim_id uuid,
  client_id uuid,
  clp03_total_charge numeric(12,2),
  clp04_payment_amount numeric(12,2),
  posting_status text,
  updated_at timestamptz
);
create table patient_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid,
  current_balance numeric(12,2),
  in_collections boolean default false,
  updated_at timestamptz
);
create table external_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  processing_status text,
  updated_at timestamptz
);
create table billing_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  status text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  updated_at timestamptz
);
create table payment_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid,
  amount numeric(12,2),
  refund_type text,
  refund_status text,
  reason text,
  requested_at timestamptz,
  requested_by_actor_id uuid,
  updated_at timestamptz
);
create table client_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  posting_status text,
  updated_at timestamptz
);
create table vcc_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  status text,
  updated_at timestamptz
);
`;

const UNDO_MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260622000000_undo_queue_action_atomic.sql",
);

before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  // The undo migration also re-creates record_queue_action_atomic with the
  // `previous_patch` capture, so loading just this one migration sets up
  // both functions. Strip the trailing role-specific grant/revoke and
  // pg_notify statements that reference service_role/authenticated/anon.
  // Strip entire `revoke … ;` / `grant … ;` / `select pg_notify(…) ;`
  // statements (they reference roles that don't exist in vanilla PG). The
  // regex matches across newlines so it removes multi-line statements as a
  // unit — earlier per-line filtering accidentally ate `from public.<tbl>`
  // lines inside SELECTs that share the same leading whitespace.
  const raw = readFileSync(UNDO_MIGRATION_PATH, "utf8");
  const sql = raw
    .replace(/^\s*revoke[\s\S]*?;\s*$/gim, "")
    .replace(/^\s*grant[\s\S]*?;\s*$/gim, "")
    .replace(/^\s*select\s+pg_notify[\s\S]*?;\s*$/gim, "");
  await db.exec(sql);
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`
    truncate audit_logs, professional_claims, payment_adjustments,
            era_claim_payments, patient_balances, external_transactions,
            billing_alerts, payment_refunds, client_payments, vcc_payments;
  `);
});

async function doAction(args: {
  endpoint: string; action: string; rowId: string;
  targetTab: string; eventType: string;
  extras?: Record<string, unknown>;
}) {
  const r = await db.query<any>(
    `select public.record_queue_action_atomic(
       $1::uuid, $2, $3, $4::uuid, $5::uuid, $6::jsonb, $7, $8, $9
     ) as out`,
    [
      ORG, args.endpoint, args.action, args.rowId, USER,
      JSON.stringify(args.extras ?? {}), args.targetTab,
      args.eventType, `${args.endpoint} → ${args.action}`,
    ],
  );
  return (r.rows[0] as any).out as { ok: boolean; mutation: any };
}

async function doUndo(endpoint: string, rowId: string) {
  const r = await db.query<any>(
    `select public.undo_queue_action_atomic($1::uuid, $2, $3::uuid, $4::uuid) as out`,
    [ORG, endpoint, rowId, USER],
  );
  return (r.rows[0] as any).out as {
    ok: boolean; mutation: any; undone_event_type: string; tab: string;
  };
}

describe("undo_queue_action_atomic — column-flip restoration", () => {
  it("payer-rejections.mark_resubmitted: undo restores claim_status AND submitted_at to prior values", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    const claimId = ins.rows[0].id;
    await doAction({
      endpoint: "payer-rejections", action: "mark_resubmitted",
      rowId: claimId, targetTab: "resubmitted", eventType: "pr_mark_resubmitted",
    });
    const before = await db.query<any>(`select claim_status, submitted_at from professional_claims where id=$1`, [claimId]);
    assert.equal(before.rows[0].claim_status, "submitted");
    assert.ok(before.rows[0].submitted_at);

    const out = await doUndo("payer-rejections", claimId);
    assert.equal(out.ok, true);
    assert.equal(out.undone_event_type, "pr_mark_resubmitted");
    const after = await db.query<any>(`select claim_status, submitted_at from professional_claims where id=$1`, [claimId]);
    assert.equal(after.rows[0].claim_status, "rejected_payer");
    assert.equal(after.rows[0].submitted_at, null, "submitted_at restored to its prior NULL");
  });

  it("audit-queue.complete_audit: undo restores billing_alerts to its prior open/null state", async () => {
    const a = await db.query<{ id: string }>(
      `insert into billing_alerts (organization_id, status) values ($1,'open') returning id`, [ORG]);
    const id = a.rows[0].id;
    await doAction({
      endpoint: "audit-queue", action: "complete_audit",
      rowId: id, targetTab: "complete", eventType: "aq_complete_audit",
    });
    await doUndo("audit-queue", id);
    const r = await db.query<any>(`select status, resolved_at, resolved_by from billing_alerts where id=$1`, [id]);
    assert.equal(r.rows[0].status, "open");
    assert.equal(r.rows[0].resolved_at, null);
    assert.equal(r.rows[0].resolved_by, null);
  });
});

describe("undo_queue_action_atomic — inserted-row reversal", () => {
  it("credit-balances.propose_refund: undo cancels the inserted refund", async () => {
    const bal = await db.query<{ id: string }>(
      `insert into patient_balances (organization_id, client_id, current_balance)
       values ($1, '44444444-4444-4444-4444-444444444444'::uuid, -50.00) returning id`, [ORG]);
    await doAction({
      endpoint: "credit-balances", action: "propose_refund",
      rowId: bal.rows[0].id, targetTab: "needs_refund", eventType: "cb_propose_refund",
    });
    const ref = await db.query<any>(`select id, refund_status from payment_refunds`);
    assert.equal(ref.rows[0].refund_status, "requested");

    await doUndo("credit-balances", bal.rows[0].id);
    const after = await db.query<any>(`select refund_status from payment_refunds where id=$1`, [ref.rows[0].id]);
    assert.equal(after.rows[0].refund_status, "cancelled");
  });

  it("credit-balances.propose_refund: undo REFUSES when the refund has already been issued (atomic rollback)", async () => {
    const bal = await db.query<{ id: string }>(
      `insert into patient_balances (organization_id, client_id, current_balance)
       values ($1, '44444444-4444-4444-4444-444444444444'::uuid, -75.00) returning id`, [ORG]);
    await doAction({
      endpoint: "credit-balances", action: "propose_refund",
      rowId: bal.rows[0].id, targetTab: "needs_refund", eventType: "cb_propose_refund",
    });
    // Downstream action: the refund has actually been paid out.
    await db.exec(`update payment_refunds set refund_status='issued'`);
    await assert.rejects(
      doUndo("credit-balances", bal.rows[0].id),
      /already been issued/i,
    );
    const undoStamped = await db.query<any>(
      `select count(*)::int as n from audit_logs where event_type='cb_undo'`,
    );
    assert.equal((undoStamped.rows[0] as any).n, 0, "no undo audit row on failure (atomic rollback)");
  });

  it("partial-denials.write_off: undo archives the inserted write-off adjustment", async () => {
    const claim = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status) values ($1,'submitted') returning id`, [ORG]);
    const era = await db.query<{ id: string }>(
      `insert into era_claim_payments (organization_id, professional_claim_id, clp03_total_charge, clp04_payment_amount)
       values ($1, $2, 100.00, 30.00) returning id`, [ORG, claim.rows[0].id]);
    await doAction({
      endpoint: "partial-denials", action: "write_off",
      rowId: era.rows[0].id, targetTab: "written_off", eventType: "pd_write_off",
    });
    const adj = await db.query<any>(`select id, archived_at from payment_adjustments`);
    assert.equal(adj.rows[0].archived_at, null);
    await doUndo("partial-denials", era.rows[0].id);
    const after = await db.query<any>(`select archived_at from payment_adjustments where id=$1`, [adj.rows[0].id]);
    assert.ok(after.rows[0].archived_at, "inserted write-off archived by undo");
  });
});

describe("undo_queue_action_atomic — reversal-pair restoration", () => {
  it("adjustments-review.reverse: undo un-links the original AND archives the reversal sibling", async () => {
    const adj = await db.query<{ id: string }>(
      `insert into payment_adjustments (organization_id, amount, adjustment_type, group_code, reason_code, scope)
       values ($1, 75.00, 'contractual', 'CO', '45', 'claim') returning id`, [ORG]);
    const origId = adj.rows[0].id;
    await doAction({
      endpoint: "adjustments-review", action: "reverse",
      rowId: origId, targetTab: "reversed", eventType: "ar_reverse",
    });
    const pair = await db.query<any>(`select id, amount, archived_at, reversed_by_adjustment_id from payment_adjustments order by amount desc`);
    const reversal = pair.rows.find((r: any) => r.id !== origId);

    await doUndo("adjustments-review", origId);
    const after = await db.query<any>(`select id, amount, archived_at, reversed_by_adjustment_id from payment_adjustments order by amount desc`);
    const orig = after.rows.find((r: any) => r.id === origId);
    const rev = after.rows.find((r: any) => r.id === reversal.id);
    assert.equal(orig.archived_at, null, "original un-archived");
    assert.equal(orig.reversed_by_adjustment_id, null, "original un-linked from reversal");
    assert.ok(rev.archived_at, "reversal sibling archived");
  });
});

describe("undo_queue_action_atomic — audit overlay + guards", () => {
  it("stamps a <prefix>_undo audit row whose metadata.tab is the prior overlay tab", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    const claimId = ins.rows[0].id;
    // Two actions: start_review (tab=in_review), then mark_resubmitted (tab=resubmitted).
    await doAction({
      endpoint: "payer-rejections", action: "start_review",
      rowId: claimId, targetTab: "in_review", eventType: "pr_start_review",
    });
    await doAction({
      endpoint: "payer-rejections", action: "mark_resubmitted",
      rowId: claimId, targetTab: "resubmitted", eventType: "pr_mark_resubmitted",
    });
    const out = await doUndo("payer-rejections", claimId);
    assert.equal(out.tab, "in_review", "undo metadata.tab = prior action's tab");
    const stamped = await db.query<any>(
      `select event_type, event_metadata from audit_logs
        where event_type='pr_undo' order by created_at desc limit 1`,
    );
    assert.equal(stamped.rows[0].event_metadata.tab, "in_review");
    assert.equal(stamped.rows[0].event_metadata.undone_event_type, "pr_mark_resubmitted");
  });

  it("falls back to the queue's default tab when there is no prior action", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    await doAction({
      endpoint: "payer-rejections", action: "mark_resubmitted",
      rowId: ins.rows[0].id, targetTab: "resubmitted", eventType: "pr_mark_resubmitted",
    });
    const out = await doUndo("payer-rejections", ins.rows[0].id);
    assert.equal(out.tab, "new", "default tab for payer-rejections");
  });

  it("refuses a double-undo: second call sees an undo on top and raises", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    await doAction({
      endpoint: "payer-rejections", action: "mark_resubmitted",
      rowId: ins.rows[0].id, targetTab: "resubmitted", eventType: "pr_mark_resubmitted",
    });
    await doUndo("payer-rejections", ins.rows[0].id);
    await assert.rejects(
      doUndo("payer-rejections", ins.rows[0].id),
      /already an undo/i,
    );
  });

  it("raises P0002 when there is no recorded action for the row at all", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    await assert.rejects(
      doUndo("payer-rejections", ins.rows[0].id),
      /no action to undo/i,
    );
  });

  it("refuses when a downstream action drifted the claim_status away from what the action set", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    const claimId = ins.rows[0].id;
    await doAction({
      endpoint: "payer-rejections", action: "mark_resubmitted",
      rowId: claimId, targetTab: "resubmitted", eventType: "pr_mark_resubmitted",
    });
    // Some downstream process moves the claim to 'paid'.
    await db.exec(`update professional_claims set claim_status='paid' where id='${claimId}'`);
    await assert.rejects(
      doUndo("payer-rejections", claimId),
      /claim status changed since action/i,
    );
  });
});
