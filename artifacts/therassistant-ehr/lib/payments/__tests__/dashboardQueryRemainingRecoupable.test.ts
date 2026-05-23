/**
 * dashboardQuery — per-row remainingRecoupable annotation (Task #176).
 *
 * Pins the cap-math the new Record-Recoupment dashboard button relies on:
 *   remainingRecoupable = amount
 *                       − Σ payment_recoupments (non-archived)
 *                       − Σ payment_refunds (non-archived, status != 'cancelled')
 *
 * The annotation runs only for posted ERA-835 and client_payment rows.
 * Manual-insurance rows and non-posted rows must stay `null` so the UI
 * does NOT offer to recoup against them.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { queryPaymentsDashboard } from "../dashboardQuery";

const ORG = "org-rr";

/**
 * Variant of the dashboard fake that ALSO honours `.neq(...)`. The
 * production annotation excludes `refund_status='cancelled'` via neq, so
 * a fake that ignored it would let cancelled refunds bleed into the
 * remaining-recoupable subtraction and the test would silently pass on
 * broken code.
 */
function makeFakeSupabase(seed: Record<string, Array<Record<string, unknown>>>) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    era_claim_payments: seed.era_claim_payments ?? [],
    insurance_manual_payments: seed.insurance_manual_payments ?? [],
    client_payments: seed.client_payments ?? [],
    payment_recoupments: seed.payment_recoupments ?? [],
    payment_refunds: seed.payment_refunds ?? [],
    workqueue_items: seed.workqueue_items ?? [],
    professional_claims: seed.professional_claims ?? [],
  };

  function makeQuery(table: string) {
    const state: {
      eqs: Array<[string, unknown]>;
      neqs: Array<[string, unknown]>;
      ins: Array<[string, unknown[]]>;
      iss: string[];
      gtes: Array<[string, unknown]>;
      ltes: Array<[string, unknown]>;
      ilikes: Array<[string, string]>;
      limit: number | null;
      countMode: boolean;
    } = {
      eqs: [],
      neqs: [],
      ins: [],
      iss: [],
      gtes: [],
      ltes: [],
      ilikes: [],
      limit: null,
      countMode: false,
    };

    const exec = async () => {
      const rows = tables[table] ?? [];
      const filtered = rows.filter((r) => {
        for (const [c, v] of state.eqs) if (r[c] !== v) return false;
        for (const [c, v] of state.neqs) if (r[c] === v) return false;
        for (const [c, vs] of state.ins) if (!vs.includes(r[c])) return false;
        for (const c of state.iss) if (r[c] != null) return false;
        for (const [c, v] of state.gtes) if ((r[c] ?? "") < (v as string)) return false;
        for (const [c, v] of state.ltes) if ((r[c] ?? "") > (v as string)) return false;
        for (const [c, v] of state.ilikes) {
          const cell = String(r[c] ?? "").toLowerCase();
          const needle = v.replace(/%/g, "").toLowerCase();
          if (!cell.includes(needle)) return false;
        }
        return true;
      });
      const limited = state.limit ? filtered.slice(0, state.limit) : filtered;
      if (state.countMode) return { data: null, count: filtered.length, error: null };
      return { data: limited, count: filtered.length, error: null };
    };

    const builder: Record<string, unknown> = {};
    builder.eq = (c: string, v: unknown) => {
      state.eqs.push([c, v]);
      return builder;
    };
    builder.neq = (c: string, v: unknown) => {
      state.neqs.push([c, v]);
      return builder;
    };
    builder.in = (c: string, vs: unknown[]) => {
      state.ins.push([c, vs]);
      return builder;
    };
    builder.is = (c: string) => {
      state.iss.push(c);
      return builder;
    };
    builder.gte = (c: string, v: unknown) => {
      state.gtes.push([c, v]);
      return builder;
    };
    builder.lte = (c: string, v: unknown) => {
      state.ltes.push([c, v]);
      return builder;
    };
    builder.ilike = (c: string, v: string) => {
      state.ilikes.push([c, v]);
      return builder;
    };
    builder.order = () => builder;
    builder.limit = (n: number) => {
      state.limit = n;
      return builder;
    };
    builder.maybeSingle = () =>
      exec().then((r) => ({
        data: r.data && (r.data as unknown[])[0] ? (r.data as unknown[])[0] : null,
        error: null,
      }));
    builder.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count === "exact") state.countMode = true;
      return builder;
    };
    builder.then = (cb: (r: unknown) => unknown) => exec().then(cb);
    return builder;
  }

  return {
    client: {
      from: (table: string) => ({
        select: (cols: string, opts?: { count?: string; head?: boolean }) => {
          const q = makeQuery(table);
          return (q.select as (c: string, o?: unknown) => unknown)(cols, opts);
        },
      }),
    } as never,
  };
}

describe("dashboard remainingRecoupable annotation", () => {
  it("subtracts prior recoups + non-cancelled refunds, excludes cancelled refunds", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [
        {
          id: "era-1",
          organization_id: ORG,
          posting_status: "posted",
          claim_match_status: "matched",
          clp04_payment_amount: 200,
          created_at: "2026-05-01T00:00:00Z",
          archived_at: null,
        },
      ],
      client_payments: [
        {
          id: "cp-1",
          organization_id: ORG,
          posting_status: "posted",
          amount: 100,
          payment_method: "stripe",
          posted_at: "2026-05-02T00:00:00Z",
          archived_at: null,
        },
      ],
      payment_recoupments: [
        // era-1: 30 recouped
        {
          source_era_claim_payment_id: "era-1",
          organization_id: ORG,
          amount: 30,
          archived_at: null,
        },
        // cp-1: 10 recouped
        {
          source_client_payment_id: "cp-1",
          organization_id: ORG,
          amount: 10,
          archived_at: null,
        },
      ],
      payment_refunds: [
        // era-1: 20 refunded (issued — must count)
        {
          source_era_claim_payment_id: "era-1",
          organization_id: ORG,
          amount: 20,
          refund_status: "issued",
          archived_at: null,
        },
        // era-1: 50 cancelled refund — MUST NOT subtract.
        {
          source_era_claim_payment_id: "era-1",
          organization_id: ORG,
          amount: 50,
          refund_status: "cancelled",
          archived_at: null,
        },
        // cp-1: 5 pending refund — counts
        {
          source_client_payment_id: "cp-1",
          organization_id: ORG,
          amount: 5,
          refund_status: "pending",
          archived_at: null,
        },
      ],
    });

    const r = await queryPaymentsDashboard(fake.client, { organizationId: ORG });
    const era = r.rows.find((x) => x.id === "era:era-1");
    const cp = r.rows.find((x) => x.id === "cp:cp-1");
    assert.ok(era, "era row present");
    assert.ok(cp, "cp row present");
    // era: 200 - 30 (recoup) - 20 (issued refund) = 150. Cancelled excluded.
    assert.equal(era?.remainingRecoupable, 150);
    // cp: 100 - 10 (recoup) - 5 (pending refund, not cancelled) = 85.
    assert.equal(cp?.remainingRecoupable, 85);
  });

  it("returns 0 (not negative) when prior recoups+refunds exceed the original", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [
        {
          id: "era-of",
          organization_id: ORG,
          posting_status: "posted",
          claim_match_status: "matched",
          clp04_payment_amount: 50,
          created_at: "2026-05-01T00:00:00Z",
          archived_at: null,
        },
      ],
      payment_recoupments: [
        { source_era_claim_payment_id: "era-of", organization_id: ORG, amount: 60, archived_at: null },
      ],
    });
    const r = await queryPaymentsDashboard(fake.client, { organizationId: ORG });
    const era = r.rows.find((x) => x.id === "era:era-of");
    assert.equal(era?.remainingRecoupable, 0);
  });

  it("leaves manual_insurance rows and non-posted rows as null (UI hides the button)", async () => {
    const fake = makeFakeSupabase({
      era_claim_payments: [
        {
          id: "era-pending",
          organization_id: ORG,
          posting_status: "ready", // not posted — must stay null
          claim_match_status: "matched",
          clp04_payment_amount: 75,
          created_at: "2026-05-01T00:00:00Z",
          archived_at: null,
        },
      ],
      insurance_manual_payments: [
        {
          id: "mi-1",
          organization_id: ORG,
          paid_amount: 40,
          posted_at: "2026-05-03T00:00:00Z",
          archived_at: null,
        },
      ],
    });
    const r = await queryPaymentsDashboard(fake.client, { organizationId: ORG });
    const era = r.rows.find((x) => x.id === "era:era-pending");
    const mi = r.rows.find((x) => x.id === "mi:mi-1");
    assert.equal(era?.remainingRecoupable, null);
    assert.equal(mi?.remainingRecoupable, null);
  });
});
