/**
 * Unit tests for `dispatchClaimStatusInquiry` (Task #446).
 *
 * Verifies that:
 *   1. A queued inquiry is flipped to "sent" before the wire call.
 *   2. The 277 round-trip updates the SAME inquiry row in place with
 *      payer_status_code/text/responded_at and inquiry_status="received".
 *   3. A claim_status_events row is written so the Payer Received
 *      detail panel's 276/277 history reflects the new event.
 *   4. Adapter failures flip the inquiry to "failed" and still log an
 *      error event for visibility.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { dispatchClaimStatusInquiry } from "../claimStatusDispatcher";
import type {
  ClaimStatusRequestInput,
  ClaimStatusResponseNormalized,
} from "@/types/clearinghouse";
import type { ClearinghouseAdapter } from "@/lib/clearinghouse/ClearinghouseAdapter";

interface Op {
  table: string;
  kind: "insert" | "update";
  payload: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown }>;
}

interface FakeRows {
  professional_claims?: Record<string, unknown> | null;
  payer_profiles?: Record<string, unknown> | null;
  insurance_policies?: Record<string, unknown> | null;
  clearinghouse_connections?: Record<string, unknown> | null;
}

function makeFakeSupabase(rows: FakeRows) {
  const ops: Op[] = [];

  function builderFor(table: string) {
    const filters: Array<{ col: string; val: unknown }> = [];
    const ctx: {
      maybeSingle: boolean;
      single: boolean;
      action: null | { kind: "insert" | "update"; payload: Record<string, unknown> };
      selectAfterAction: boolean;
      recorded: boolean;
    } = {
      maybeSingle: false,
      single: false,
      action: null,
      selectAfterAction: false,
      recorded: false,
    };

    const recordAction = () => {
      if (ctx.action && !ctx.recorded) {
        ops.push({
          table,
          kind: ctx.action.kind,
          payload: ctx.action.payload,
          filters: [...filters],
        });
        ctx.recorded = true;
      }
    };

    const finishRead = () => {
      const seed = rows[table as keyof FakeRows];
      return ctx.maybeSingle || ctx.single
        ? { data: seed ?? null, error: null }
        : { data: seed ? [seed] : [], error: null };
    };

    const finish = () => {
      if (ctx.action) {
        recordAction();
        const returned =
          ctx.action.kind === "insert"
            ? { ...ctx.action.payload, id: ctx.action.payload.id ?? "fake-insert-id" }
            : { ...ctx.action.payload };
        if (ctx.selectAfterAction) {
          return ctx.single || ctx.maybeSingle
            ? { data: returned, error: null }
            : { data: [returned], error: null };
        }
        return { data: null, error: null };
      }
      return finishRead();
    };

    // Thenable proxy: only resolves when awaited (so .eq() chains get
    // captured into `filters` before the action is recorded).
    const proxy: Record<string, unknown> = {};
    proxy.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(finish()).then(onFulfilled, onRejected);
    proxy.catch = (onRejected: (e: unknown) => unknown) =>
      Promise.resolve(finish()).catch(onRejected);
    proxy.select = () => {
      if (ctx.action) ctx.selectAfterAction = true;
      return proxy;
    };
    proxy.eq = (col: string, val: unknown) => {
      filters.push({ col, val });
      return proxy;
    };
    proxy.in = (col: string, val: unknown) => {
      filters.push({ col, val });
      return proxy;
    };
    proxy.order = () => proxy;
    proxy.limit = () => proxy;
    proxy.is = () => proxy;
    proxy.maybeSingle = () => {
      ctx.maybeSingle = true;
      return Promise.resolve(finish());
    };
    proxy.single = () => {
      ctx.single = true;
      return Promise.resolve(finish());
    };
    proxy.insert = (payload: Record<string, unknown>) => {
      ctx.action = { kind: "insert", payload };
      return proxy;
    };
    proxy.update = (payload: Record<string, unknown>) => {
      ctx.action = { kind: "update", payload };
      return proxy;
    };
    return proxy;
  }

  const supabase = {
    from(table: string) {
      return builderFor(table);
    },
  };
  return { supabase, ops };
}

function makeAdapter(
  normalized: ClaimStatusResponseNormalized,
  opts: { throwOnSend?: boolean } = {},
): ClearinghouseAdapter {
  return {
    async runEligibility270() {
      throw new Error("not used in this test");
    },
    async runClaimStatus276(input: ClaimStatusRequestInput) {
      if (opts.throwOnSend) throw new Error("availity 503");
      return {
        controlNumber: "CTRL-000123",
        correlationId: `corr-${input.claimId}`,
        rawRequest: "ISA*...*276~",
        rawResponse: "ISA*...*277~",
        normalized,
      };
    },
  };
}

const CLAIM_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const INQUIRY_ID = "33333333-3333-3333-3333-333333333333";

const CLAIM_ROW = {
  id: CLAIM_ID,
  organization_id: ORG_ID,
  patient_id: "44444444-4444-4444-4444-444444444444",
  encounter_id: "55555555-5555-5555-5555-555555555555",
  payer_profile_id: "66666666-6666-6666-6666-666666666666",
  claim_status: "accepted_payer",
  total_charge: 250.0,
};

describe("dispatchClaimStatusInquiry", () => {
  it("flips queued → sent → received and updates the SAME inquiry row in place", async () => {
    const { supabase, ops } = makeFakeSupabase({
      professional_claims: CLAIM_ROW,
      payer_profiles: { payer_name: "Demo HMO", availity_payer_id: "DEMO01" },
      insurance_policies: { subscriber_id: "MBR-9", policy_number: "POL-9" },
    });

    const result = await dispatchClaimStatusInquiry({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      organizationId: ORG_ID,
      claimId: CLAIM_ID,
      inquiryId: INQUIRY_ID,
      adapter: makeAdapter({
        status: "pending",
        statusCategoryCode: "A1",
        statusCode: "20",
        payerMessage: "Pending payer adjudication.",
        rawStatus: { vendor: "test" },
      }),
    });

    assert.equal(result.inquiryStatus, "received");
    assert.equal(result.normalized?.status, "pending");

    const inquiryUpdates = ops.filter(
      (o) => o.table === "claim_status_inquiries" && o.kind === "update",
    );
    assert.equal(inquiryUpdates.length, 2, "expected sent + received updates");

    const sentUpdate = inquiryUpdates[0];
    assert.equal(sentUpdate.payload.inquiry_status, "sent");
    assert.ok(
      sentUpdate.filters.some((f) => f.col === "id" && f.val === INQUIRY_ID),
      "sent update must target the queued inquiry id",
    );

    const finalUpdate = inquiryUpdates[1];
    assert.equal(finalUpdate.payload.inquiry_status, "received");
    assert.equal(finalUpdate.payload.payer_status_code, "20");
    assert.equal(finalUpdate.payload.payer_status_text, "Pending payer adjudication.");
    assert.ok(finalUpdate.payload.responded_at, "responded_at must be set");
    assert.ok(
      finalUpdate.filters.some((f) => f.col === "id" && f.val === INQUIRY_ID),
      "final update must target the same queued inquiry id",
    );
    assert.ok(
      finalUpdate.filters.some((f) => f.col === "organization_id" && f.val === ORG_ID),
      "final update must be org-scoped",
    );

    const events = ops.filter(
      (o) => o.table === "claim_status_events" && o.kind === "insert",
    );
    assert.equal(events.length, 1, "expected one claim_status_events row");
    assert.equal(events[0].payload.source, "clearinghouse");
    assert.equal(events[0].payload.status, "pending");
    assert.equal(events[0].payload.claim_id, CLAIM_ID);

    const transactions = ops.filter(
      (o) => o.table === "edi_transactions" && o.kind === "insert",
    );
    assert.equal(transactions.length, 2, "expected a 276 and a 277 audit row");
    assert.deepEqual(
      transactions.map((t) => t.payload.transaction_type).sort(),
      ["276", "277"],
    );
  });

  it("flips queued → sent → failed and logs an error event when the adapter throws", async () => {
    const { supabase, ops } = makeFakeSupabase({
      professional_claims: CLAIM_ROW,
      payer_profiles: { payer_name: "Demo HMO", availity_payer_id: "DEMO01" },
      insurance_policies: { subscriber_id: "MBR-9", policy_number: "POL-9" },
    });

    const result = await dispatchClaimStatusInquiry({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      organizationId: ORG_ID,
      claimId: CLAIM_ID,
      inquiryId: INQUIRY_ID,
      adapter: makeAdapter(
        { status: "unknown", payerMessage: null, rawStatus: {} },
        { throwOnSend: true },
      ),
    });

    assert.equal(result.inquiryStatus, "failed");
    assert.match(result.errorMessage ?? "", /availity 503/);

    const inquiryUpdates = ops.filter(
      (o) => o.table === "claim_status_inquiries" && o.kind === "update",
    );
    const statuses = inquiryUpdates.map((u) => u.payload.inquiry_status);
    assert.deepEqual(statuses, ["sent", "failed"]);

    const events = ops.filter(
      (o) => o.table === "claim_status_events" && o.kind === "insert",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.status, "error");
    assert.match(String(events[0].payload.status_message ?? ""), /availity 503/);
  });
});
