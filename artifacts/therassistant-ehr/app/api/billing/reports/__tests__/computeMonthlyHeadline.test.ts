/**
 * Task #779: the 6-month trend numbers must be historically accurate.
 *
 * `computeMonthlyHeadline` now sources past-month Outstanding AR and
 * Average Days in AR from the audited `billing_claim_status_snapshot`
 * RPC (backed by `professional_claim_status_history`). These tests pin:
 *
 *   1. When the RPC returns a snapshot, only the rows whose status was
 *      OUTSTANDING at monthEnd count toward outstanding AR / avg days,
 *      regardless of what those same claims look like today.
 *   2. When the RPC errors (e.g. the migration hasn't shipped to the
 *      live DB yet), the helper falls back to the legacy
 *      "today's status, submitted on/before monthEnd" approximation
 *      so the report still renders.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { computeMonthlyHeadline } from "../route";

type RpcRow = {
  professional_claim_id: string;
  claim_status: string;
  submitted_at: string | null;
  total_charge: number | string | null;
};

type FallbackRow = {
  id: string;
  total_charge: number | string | null;
  submitted_at: string | null;
  claim_status: string;
};

type FakeOptions = {
  rpc: { data: RpcRow[] | null; error: { message: string } | null };
  fallbackRows?: FallbackRow[];
};

// Minimal chainable fake that responds to:
//   .from("professional_claims").select(...).eq(...).gte(...).lt(...)   → submitted
//   .from("professional_claims").select(..., {count, head}).eq(...)…    → counts
//   .from("patient_invoice_payments").select(...).eq(...).…             → payments
//   .from("professional_claims").select(...,...,claim_status).in(...).not(...).lt(...)
//     → fallback outstanding rows
//   .rpc("billing_claim_status_snapshot", params)                       → snapshot
function makeFake(opts: FakeOptions) {
  const fallbackRows = opts.fallbackRows ?? [];
  function selectBuilder(table: string, options?: { count?: string; head?: boolean }) {
    const wantsCount = options?.count === "exact";
    const head = options?.head === true;
    const builder = {
      eq() { return builder; },
      gte() { return builder; },
      lt() { return builder; },
      lte() { return builder; },
      in() { return builder; },
      not() { return builder; },
      is() { return builder; },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        let result: unknown;
        if (head && wantsCount) {
          result = { count: 0, data: null, error: null };
        } else if (table === "professional_claims") {
          // Heuristic: the only non-head select on professional_claims we
          // care about is the fallback outstanding query.
          result = { data: fallbackRows, error: null };
        } else if (table === "patient_invoice_payments") {
          result = { data: [], error: null };
        } else {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  const fake = {
    from(table: string) {
      return {
        select(_cols: string, options?: { count?: string; head?: boolean }) {
          return selectBuilder(table, options);
        },
      };
    },
    rpc(name: string, _params: unknown) {
      if (name !== "billing_claim_status_snapshot") {
        return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
      }
      return Promise.resolve(opts.rpc);
    },
  };
  return fake;
}

const ORG = "11111111-1111-1111-1111-111111111111";

describe("computeMonthlyHeadline (Task #779: historically accurate trend)", () => {
  it("uses the audited snapshot — claims paid AFTER monthEnd still count as outstanding for that past month", async () => {
    // March 2026 close. The snapshot RPC reports two claims as
    // outstanding at month-end (one submitted 60 days prior, one 20
    // days prior). Today both might be paid — irrelevant, because the
    // helper must trust the snapshot, not today's status.
    const fake = makeFake({
      rpc: {
        data: [
          {
            professional_claim_id: "c1",
            claim_status: "submitted",
            submitted_at: "2026-01-30T00:00:00.000Z",
            total_charge: 400,
          },
          {
            professional_claim_id: "c2",
            claim_status: "accepted_payer",
            submitted_at: "2026-03-11T00:00:00.000Z",
            total_charge: 250,
          },
          // A snapshot row that was NOT outstanding (e.g. paid by month-end)
          // must be excluded from outstanding AR even though it exists in
          // the snapshot.
          {
            professional_claim_id: "c3",
            claim_status: "paid",
            submitted_at: "2026-03-05T00:00:00.000Z",
            total_charge: 999,
          },
        ],
        error: null,
      },
    });

    const headline = await computeMonthlyHeadline({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fake as any,
      organizationId: ORG,
      month: "2026-03",
      claimAppointmentFilter: null,
      includePatientPayments: true,
    });

    assert.equal(headline.outstandingAR, 650, "outstanding AR sums charges of OUTSTANDING-status snapshot rows only");
    assert.ok(headline.averageDaysInAR !== null);
    // monthEnd = 2026-04-01. c1: 61 days, c2: 21 days → avg 41 (rounded to 1dp).
    assert.equal(headline.averageDaysInAR, 41);
  });

  it("falls back to live-status approximation when the snapshot RPC errors", async () => {
    const fake = makeFake({
      rpc: { data: null, error: { message: "function billing_claim_status_snapshot(...) does not exist" } },
      fallbackRows: [
        {
          id: "c1",
          claim_status: "submitted",
          submitted_at: "2026-01-30T00:00:00.000Z",
          total_charge: 400,
        },
      ],
    });

    const headline = await computeMonthlyHeadline({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fake as any,
      organizationId: ORG,
      month: "2026-03",
      claimAppointmentFilter: null,
      includePatientPayments: true,
    });

    assert.equal(headline.outstandingAR, 400, "fallback path still computes outstanding AR");
    assert.equal(headline.averageDaysInAR, 61);
  });

  it("returns zeroes when the snapshot is empty (no historical claims for the period)", async () => {
    const fake = makeFake({ rpc: { data: [], error: null } });

    const headline = await computeMonthlyHeadline({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fake as any,
      organizationId: ORG,
      month: "2026-03",
      claimAppointmentFilter: null,
      includePatientPayments: true,
    });

    assert.equal(headline.outstandingAR, 0);
    assert.equal(headline.averageDaysInAR, null);
  });
});
