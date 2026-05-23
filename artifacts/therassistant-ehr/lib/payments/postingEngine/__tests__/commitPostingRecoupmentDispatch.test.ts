/**
 * commitPosting → recordRecoupment dispatch coverage (Task #176).
 *
 * Pins that when `source.type === 'recoupment'` the dispatcher forwards
 * into recordRecoupment AND surfaces the resulting recoupment / ledger /
 * workqueue ids on `CommitPostingResult.recoupment`. Without this test a
 * silent regression in the wiring (e.g. dropping the result-shape
 * conversion) would leave the dashboard UI unable to link the new
 * recoupment row from its success toast.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { commitPosting } from "../index";
import type { PostingActor } from "../types";
import { validateInsert, validateWritePayload } from "./_schemaGuard";

const ORG = "org-1";
const ACTOR: PostingActor = {
  staffId: "staff-1",
  userId: "user-1",
  role: "biller",
  source: "test:dispatch",
};

/**
 * Minimal supabase fake — supports the subset of chainable calls that
 * recordRecoupment + writePaymentAuditLog actually perform. We only need
 * enough fidelity to verify the dispatch wiring; deeper recordRecoupment
 * behavior lives in reversalEngine.test.ts.
 */
function makeFakeSupabase(seed: Record<string, Array<Record<string, unknown>>>) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    era_claim_payments: seed.era_claim_payments ?? [],
    client_payments: seed.client_payments ?? [],
    payment_recoupments: [],
    payment_refunds: [],
    era_posting_ledger_entries: [],
    workqueue_items: [],
    audit_logs: [],
    professional_claims: seed.professional_claims ?? [],
  };

  function builder(table: string) {
    const ctx: {
      filters: Array<[string, unknown]>;
      isNull: string[];
      mode: "select" | "insert" | "update" | null;
      insertPayload: Record<string, unknown> | null;
      updatePayload: Record<string, unknown> | null;
      single: boolean;
      maybe: boolean;
    } = {
      filters: [],
      isNull: [],
      mode: null,
      insertPayload: null,
      updatePayload: null,
      single: false,
      maybe: false,
    };

    const exec = () => {
      const rows = tables[table] ?? [];
      return rows.filter((r) => {
        for (const [k, v] of ctx.filters) if (r[k] !== v) return false;
        for (const k of ctx.isNull) if (r[k] != null) return false;
        return true;
      });
    };

    const thenable = {
      then(cb: (r: { data: unknown; error: null }) => unknown) {
        if (ctx.mode === "insert") {
          const id = `${table}-${(tables[table].length + 1).toString().padStart(3, "0")}`;
          const row = { id, ...(ctx.insertPayload ?? {}) } as Record<string, unknown>;
          tables[table] = [...(tables[table] ?? []), row];
          const data = ctx.single || ctx.maybe ? row : [row];
          return Promise.resolve({ data, error: null }).then(cb);
        }
        if (ctx.mode === "update") {
          const targets = exec();
          for (const r of targets) Object.assign(r, ctx.updatePayload);
          return Promise.resolve({ data: targets, error: null }).then(cb);
        }
        const res = exec();
        if (ctx.single || ctx.maybe) {
          return Promise.resolve({ data: res[0] ?? null, error: null }).then(cb);
        }
        return Promise.resolve({ data: res, error: null }).then(cb);
      },
    };

    const chain: Record<string, unknown> = {
      select() {
        if (ctx.mode === null) ctx.mode = "select";
        return chain;
      },
      insert(p: Record<string, unknown>) {
        validateInsert(table, p);
        ctx.mode = "insert";
        ctx.insertPayload = p;
        return chain;
      },
      update(p: Record<string, unknown>) {
        validateWritePayload(table, p);
        ctx.mode = "update";
        ctx.updatePayload = p;
        return chain;
      },
      eq(k: string, v: unknown) {
        ctx.filters.push([k, v]);
        return chain;
      },
      neq() {
        return chain;
      },
      is(k: string, _v: unknown) {
        ctx.isNull.push(k);
        return chain;
      },
      in() {
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
    client: { from: (t: string) => builder(t) } as never,
  };
}

describe("commitPosting recoupment dispatch", () => {
  it("forwards to recordRecoupment and surfaces ids on result.recoupment", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [
        {
          id: "era-d1",
          organization_id: ORG,
          client_id: "c-1",
          professional_claim_id: "claim-d1",
          clp01_claim_control_number: "PCN-DISP",
          clp04_payment_amount: 200,
          posting_status: "posted",
          archived_at: null,
        },
      ],
    });

    const r = await commitPosting(
      {
        organizationId: ORG,
        actor: ACTOR,
        source: {
          type: "recoupment",
          target: { kind: "era_835", id: "era-d1" },
          amount: 50,
          reason: "Payer takeback per remit",
          reasonCode: "WO",
        },
      },
      fake.client,
    );

    assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
    assert.equal(r.posted, true);
    // recoupment surface object is the contract the dashboard UI relies on.
    assert.ok(r.recoupment, "result.recoupment must be populated for recoupment dispatch");
    assert.ok(r.recoupment?.recoupmentId, "recoupmentId must be returned");
    assert.ok(r.recoupment?.ledgerEntryId, "ledgerEntryId must be returned");
    assert.ok(r.recoupment?.workqueueItemId, "workqueueItemId must be returned");

    // Ids must match what the underlying tables actually contain.
    const recoupRow = fake.tables.payment_recoupments[0] as Record<string, unknown>;
    const ledgerRow = fake.tables.era_posting_ledger_entries[0] as Record<string, unknown>;
    const wqRow = fake.tables.workqueue_items[0] as Record<string, unknown>;
    assert.equal(r.recoupment?.recoupmentId, recoupRow.id);
    assert.equal(r.recoupment?.ledgerEntryId, ledgerRow.id);
    assert.equal(r.recoupment?.workqueueItemId, wqRow.id);

    // Negative-ledger sign is enforced by recordRecoupment but the dispatch
    // path must not silently re-write the amount; pin it here so a future
    // dispatcher refactor can't accidentally invert the sign.
    assert.equal(Number(ledgerRow.amount), -50);
    assert.equal(ledgerRow.source_type, "recoupment");
  });

  it("propagates recordRecoupment errors with ok=false and recoupment surface empty", async () => {
    // No matching era_claim_payments row → recordRecoupment fails with
    // 'Original payment not found'. The dispatcher must surface that
    // verbatim rather than masking it as a generic engine error.
    const fake = makeFakeSupabase({ era_claim_payments: [] });

    const r = await commitPosting(
      {
        organizationId: ORG,
        actor: ACTOR,
        source: {
          type: "recoupment",
          target: { kind: "era_835", id: "era-missing" },
          amount: 10,
          reason: "x",
        },
      },
      fake.client,
    );

    assert.equal(r.ok, false);
    assert.equal(r.posted, false);
    assert.ok(r.errors.length > 0);
    assert.equal(r.recoupment?.recoupmentId, null);
    assert.equal(r.recoupment?.ledgerEntryId, null);
    assert.equal(r.recoupment?.workqueueItemId, null);
  });
});
