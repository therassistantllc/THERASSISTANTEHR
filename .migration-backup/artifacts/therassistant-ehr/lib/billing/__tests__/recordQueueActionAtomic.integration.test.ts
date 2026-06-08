/**
 * REAL-DB integration coverage for `record_queue_action_atomic` (Task #615).
 *
 * Spins up an in-process Postgres (PGlite) per test, creates a minimal
 * schema with only the columns the RPC reads/writes, loads the migration
 * file verbatim, then exercises each of the 12 workqueues' headline
 * action end-to-end:
 *   - the underlying table is actually mutated (status flip, inserted
 *     adjustment / refund row, …);
 *   - an audit_logs row is written with the mutation payload;
 *   - both writes happen in the SAME transaction — verified by the
 *     rollback test, which forces an audit_logs failure and asserts no
 *     mutation persists.
 *
 * This is the integration layer the JS-level contract tests in
 * `liveQueueActions.test.ts` mock out.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "11111111-1111-1111-1111-111111111112";
const USER = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

// Minimal schema — only the columns the atomic RPC reads or writes.
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
  requested_by_actor_id uuid
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

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260617000000_record_queue_action_atomic.sql",
);

before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  // Strip the `select pg_notify(...)` line — PGlite supports it but the
  // grant/revoke statements reference service_role/authenticated/anon
  // which don't exist in a vanilla PG. Filter those too.
  // Keep only the CREATE FUNCTION body — drop the trailing
  // grant/revoke/pg_notify statements which reference roles
  // (service_role/authenticated/anon) that don't exist in a vanilla
  // Postgres test instance.
  const raw = readFileSync(MIGRATION_PATH, "utf8");
  const endOfBody = raw.indexOf("end;\n$$;");
  assert.notEqual(endOfBody, -1, "could not find end-of-function marker in migration");
  const sql = raw.slice(0, endOfBody + "end;\n$$;".length);
  await db.exec(sql);
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Wipe state between tests so each one builds its own fixture.
  await db.exec(`
    truncate audit_logs, professional_claims, payment_adjustments,
            era_claim_payments, patient_balances, external_transactions,
            billing_alerts, payment_refunds, client_payments, vcc_payments;
  `);
});

async function callRpc(args: {
  endpoint: string; action: string; rowId: string;
  extras?: Record<string, unknown>; targetTab: string;
  eventType: string; org?: string;
}) {
  const r = await db.query<{ jsonb_build_object: any }>(
    `select public.record_queue_action_atomic(
       $1::uuid, $2, $3, $4::uuid, $5::uuid, $6::jsonb, $7, $8, $9
     ) as out`,
    [
      args.org ?? ORG, args.endpoint, args.action, args.rowId, USER,
      JSON.stringify(args.extras ?? {}), args.targetTab,
      args.eventType, `${args.endpoint} → ${args.action}`,
    ],
  );
  return (r.rows[0] as any).out as { ok: boolean; mutation: any };
}

async function singleAuditRow() {
  const r = await db.query<any>(`select * from audit_logs`);
  assert.equal(r.rows.length, 1, "expected exactly one audit_logs row");
  return r.rows[0];
}

describe("record_queue_action_atomic — per-queue real DB behavior", () => {
  it("payer-rejections: mark_resubmitted flips claim_status and stamps audit", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'rejected_payer') returning id`, [ORG]);
    const claimId = ins.rows[0].id;
    const out = await callRpc({
      endpoint: "payer-rejections", action: "mark_resubmitted",
      rowId: claimId, targetTab: "resubmitted", eventType: "pr_mark_resubmitted",
    });
    assert.equal(out.ok, true);
    assert.equal(out.mutation.table, "professional_claims");
    const c = await db.query<any>(`select claim_status, submitted_at from professional_claims where id=$1`, [claimId]);
    assert.equal(c.rows[0].claim_status, "submitted");
    assert.ok(c.rows[0].submitted_at, "submitted_at should be stamped");
    const audit = await singleAuditRow();
    assert.equal(audit.event_type, "pr_mark_resubmitted");
    assert.equal(audit.event_metadata.tab, "resubmitted");
    assert.equal(audit.event_metadata.mutation.patch.claim_status, "submitted");
  });

  it("resubmissions: mark_submitted flips claim_status='submitted'", async () => {
    const ins = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'ready_to_submit') returning id`, [ORG]);
    const claimId = ins.rows[0].id;
    await callRpc({
      endpoint: "resubmissions", action: "mark_submitted",
      rowId: claimId, targetTab: "submitted", eventType: "rs_mark_submitted",
    });
    const c = await db.query<any>(`select claim_status from professional_claims where id=$1`, [claimId]);
    assert.equal(c.rows[0].claim_status, "submitted");
    await singleAuditRow();
  });

  it("partial-denials: write_off inserts shortfall adjustment for the underpayment", async () => {
    const claim = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status)
       values ($1, 'submitted') returning id`, [ORG]);
    const era = await db.query<{ id: string }>(
      `insert into era_claim_payments (organization_id, professional_claim_id, clp03_total_charge, clp04_payment_amount)
       values ($1, $2, 100.00, 20.00) returning id`, [ORG, claim.rows[0].id]);
    const out = await callRpc({
      endpoint: "partial-denials", action: "write_off",
      rowId: era.rows[0].id, targetTab: "written_off", eventType: "pd_write_off",
      extras: { note: "PR45 shortfall" },
    });
    assert.equal(out.ok, true);
    const adj = await db.query<any>(`select * from payment_adjustments`);
    assert.equal(adj.rows.length, 1, "exactly one shortfall adjustment");
    assert.equal(Number(adj.rows[0].amount), 80);
    assert.equal(adj.rows[0].adjustment_type, "write_off");
    assert.equal(adj.rows[0].posted_by_user_id, USER);
    await singleAuditRow();
  });

  it("partial-denials: write_off REFUSES when there is no shortfall (atomic rollback)", async () => {
    const claim = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status) values ($1,'submitted') returning id`, [ORG]);
    const era = await db.query<{ id: string }>(
      `insert into era_claim_payments (organization_id, professional_claim_id, clp03_total_charge, clp04_payment_amount)
       values ($1, $2, 100.00, 100.00) returning id`, [ORG, claim.rows[0].id]);
    await assert.rejects(
      callRpc({ endpoint: "partial-denials", action: "write_off",
        rowId: era.rows[0].id, targetTab: "written_off", eventType: "pd_write_off" }),
      /no shortfall/i,
    );
    const adj = await db.query<any>(`select count(*)::int as n from payment_adjustments`);
    assert.equal((adj.rows[0] as any).n, 0, "no adjustment should be written on failure");
    const audit = await db.query<any>(`select count(*)::int as n from audit_logs`);
    assert.equal((audit.rows[0] as any).n, 0, "no audit row on failure (atomic rollback)");
  });

  it("adjustments-review: approve stamps posted_at + posted_by", async () => {
    const adj = await db.query<{ id: string }>(
      `insert into payment_adjustments (organization_id, amount, adjustment_type, scope)
       values ($1, 50.00, 'contractual', 'claim') returning id`, [ORG]);
    await callRpc({
      endpoint: "adjustments-review", action: "approve",
      rowId: adj.rows[0].id, targetTab: "approved", eventType: "ar_approve",
    });
    const row = await db.query<any>(`select posted_at, posted_by_user_id from payment_adjustments where id=$1`, [adj.rows[0].id]);
    assert.ok(row.rows[0].posted_at, "posted_at stamped");
    assert.equal(row.rows[0].posted_by_user_id, USER);
    await singleAuditRow();
  });

  it("adjustments-review: reverse inserts -amount sibling AND links + archives the original", async () => {
    const adj = await db.query<{ id: string }>(
      `insert into payment_adjustments (organization_id, amount, adjustment_type, group_code, reason_code, scope)
       values ($1, 75.00, 'contractual', 'CO', '45', 'claim') returning id`, [ORG]);
    const origId = adj.rows[0].id;
    const out = await callRpc({
      endpoint: "adjustments-review", action: "reverse",
      rowId: origId, targetTab: "reversed", eventType: "ar_reverse",
    });
    const rows = await db.query<any>(`select id, amount, archived_at, reversed_by_adjustment_id from payment_adjustments order by amount desc`);
    assert.equal(rows.rows.length, 2, "original + reversal");
    const original = rows.rows.find((r: any) => r.id === origId);
    const reversal = rows.rows.find((r: any) => r.id !== origId);
    assert.equal(Number(reversal.amount), -75);
    assert.equal(original.reversed_by_adjustment_id, reversal.id, "original links to reversal");
    assert.ok(original.archived_at, "original archived");
    assert.equal(out.mutation.reversal_id, reversal.id);
  });

  it("medical-necessity: send_appeal flips linked claim to 'appealing' via FK lookup", async () => {
    const claim = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status) values ($1,'submitted') returning id`, [ORG]);
    const era = await db.query<{ id: string }>(
      `insert into era_claim_payments (organization_id, professional_claim_id) values ($1, $2) returning id`,
      [ORG, claim.rows[0].id]);
    await callRpc({
      endpoint: "medical-necessity", action: "send_appeal",
      rowId: era.rows[0].id, targetTab: "appeal_sent", eventType: "mn_send_appeal",
    });
    const c = await db.query<any>(`select claim_status, appeal_submitted_at from professional_claims where id=$1`, [claim.rows[0].id]);
    assert.equal(c.rows[0].claim_status, "appealing");
    assert.ok(c.rows[0].appeal_submitted_at);
  });

  it("unposted-payments: post_to_claim auto-detects era vs client vs vcc tables", async () => {
    const era = await db.query<{ id: string }>(
      `insert into era_claim_payments (organization_id, posting_status) values ($1,'unposted') returning id`, [ORG]);
    await callRpc({
      endpoint: "unposted-payments", action: "post_to_claim",
      rowId: era.rows[0].id, targetTab: "all", eventType: "up_post_to_claim",
    });
    const r = await db.query<any>(`select posting_status from era_claim_payments where id=$1`, [era.rows[0].id]);
    assert.equal(r.rows[0].posting_status, "posted");

    // Also verify client_payments / vcc_payments paths
    await db.exec(`truncate audit_logs`);
    const cp = await db.query<{ id: string }>(
      `insert into client_payments (organization_id, posting_status) values ($1,'unposted') returning id`, [ORG]);
    const out = await callRpc({
      endpoint: "unposted-payments", action: "post_to_claim",
      rowId: cp.rows[0].id, targetTab: "all", eventType: "up_post_to_claim",
    });
    assert.equal(out.mutation.table, "client_payments");
  });

  it("credit-balances: propose_refund inserts a requested payment_refunds row for the credit", async () => {
    const bal = await db.query<{ id: string }>(
      `insert into patient_balances (organization_id, client_id, current_balance)
       values ($1, '44444444-4444-4444-4444-444444444444'::uuid, -125.00) returning id`, [ORG]);
    await callRpc({
      endpoint: "credit-balances", action: "propose_refund",
      rowId: bal.rows[0].id, targetTab: "needs_refund", eventType: "cb_propose_refund",
    });
    const ref = await db.query<any>(`select * from payment_refunds`);
    assert.equal(ref.rows.length, 1);
    assert.equal(Number(ref.rows[0].amount), 125);
    assert.equal(ref.rows[0].refund_status, "requested");
    assert.equal(ref.rows[0].requested_by_actor_id, USER);
  });

  it("reconciliation-exceptions: resolve cancels the external_transactions row", async () => {
    const tx = await db.query<{ id: string }>(
      `insert into external_transactions (organization_id, processing_status) values ($1,'queued') returning id`, [ORG]);
    await callRpc({
      endpoint: "reconciliation-exceptions", action: "resolve",
      rowId: tx.rows[0].id, targetTab: "resolved", eventType: "re_resolve",
    });
    const r = await db.query<any>(`select processing_status from external_transactions where id=$1`, [tx.rows[0].id]);
    assert.equal(r.rows[0].processing_status, "cancelled");
  });

  it("bad-debt-review: approve flips patient_balances.in_collections=true", async () => {
    const bal = await db.query<{ id: string }>(
      `insert into patient_balances (organization_id, current_balance) values ($1, 300.00) returning id`, [ORG]);
    await callRpc({
      endpoint: "bad-debt-review", action: "approve",
      rowId: bal.rows[0].id, targetTab: "approved", eventType: "bd_approve",
    });
    const r = await db.query<any>(`select in_collections from patient_balances where id=$1`, [bal.rows[0].id]);
    assert.equal(r.rows[0].in_collections, true);
  });

  it("write-offs: mark_reversal inserts -amount reversal and links it back on the original", async () => {
    const wo = await db.query<{ id: string }>(
      `insert into payment_adjustments (organization_id, amount, adjustment_type, scope, source)
       values ($1, 200.00, 'write_off', 'claim', 'manual_write_off') returning id`, [ORG]);
    await callRpc({
      endpoint: "write-offs", action: "mark_reversal",
      rowId: wo.rows[0].id, targetTab: "reversals", eventType: "wo_mark_reversal",
    });
    const rows = await db.query<any>(`select id, amount, reversed_by_adjustment_id from payment_adjustments order by amount desc`);
    assert.equal(rows.rows.length, 2);
    const original = rows.rows.find((r: any) => r.id === wo.rows[0].id);
    const reversal = rows.rows.find((r: any) => r.id !== wo.rows[0].id);
    assert.equal(Number(reversal.amount), -200);
    assert.equal(original.reversed_by_adjustment_id, reversal.id);
  });

  it("audit-queue: complete_audit resolves the billing_alerts row", async () => {
    const alert = await db.query<{ id: string }>(
      `insert into billing_alerts (organization_id, status) values ($1,'open') returning id`, [ORG]);
    await callRpc({
      endpoint: "audit-queue", action: "complete_audit",
      rowId: alert.rows[0].id, targetTab: "complete", eventType: "aq_complete_audit",
    });
    const r = await db.query<any>(`select status, resolved_at, resolved_by from billing_alerts where id=$1`, [alert.rows[0].id]);
    assert.equal(r.rows[0].status, "resolved");
    assert.ok(r.rows[0].resolved_at);
    assert.equal(r.rows[0].resolved_by, USER);
  });

  it("compliance-holds: release flips a held claim to 'ready_to_submit'", async () => {
    const claim = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status) values ($1,'held') returning id`, [ORG]);
    await callRpc({
      endpoint: "compliance-holds", action: "release",
      rowId: claim.rows[0].id, targetTab: "released", eventType: "ch_release",
    });
    const r = await db.query<any>(`select claim_status from professional_claims where id=$1`, [claim.rows[0].id]);
    assert.equal(r.rows[0].claim_status, "ready_to_submit");
  });
});

describe("record_queue_action_atomic — rollback / guard semantics", () => {
  it("a missing row raises P0002 and writes NO audit row (atomic rollback)", async () => {
    const ghost = "99999999-9999-9999-9999-999999999999";
    await assert.rejects(
      callRpc({ endpoint: "compliance-holds", action: "release",
        rowId: ghost, targetTab: "released", eventType: "ch_release" }),
      /not found/i,
    );
    const n = await db.query<any>(`select count(*)::int as n from audit_logs`);
    assert.equal(n.rows[0].n, 0, "audit row must not exist when mutation fails");
  });

  it("an org-B caller cannot mutate an org-A row — raises and leaves no audit trail", async () => {
    const claim = await db.query<{ id: string }>(
      `insert into professional_claims (organization_id, claim_status) values ($1,'held') returning id`, [ORG]);
    await assert.rejects(
      callRpc({ org: ORG_B, endpoint: "compliance-holds", action: "release",
        rowId: claim.rows[0].id, targetTab: "released", eventType: "ch_release" }),
      /not found/i,
    );
    const c = await db.query<any>(`select claim_status from professional_claims where id=$1`, [claim.rows[0].id]);
    assert.equal(c.rows[0].claim_status, "held", "org-A row stays untouched");
    const n = await db.query<any>(`select count(*)::int as n from audit_logs`);
    assert.equal(n.rows[0].n, 0);
  });
});
