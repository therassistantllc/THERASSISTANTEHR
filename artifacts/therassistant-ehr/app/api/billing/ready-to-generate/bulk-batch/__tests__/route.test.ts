/**
 * Route-level coverage for POST /api/billing/ready-to-generate/bulk-batch.
 *
 * Pins the one-payer-per-batch invariant — the whole point of this endpoint
 * is that a clearinghouse expects exactly one payer per 837P file. The
 * tests below cover the four behaviors callers depend on:
 *
 *   1. Single-payer selection → one batch (back-compat with the existing UI).
 *   2. Multi-payer selection WITHOUT `splitByPayer:true` → 422 with
 *      `code:"multi_payer_selection"` + per-payer breakdown, and NO writes
 *      to claim_837p_batches / claim_837p_batch_claims / professional_claims.
 *   3. Multi-payer selection WITH `splitByPayer:true` → one batch per payer,
 *      each linking only its own claims and getting its own batch_number,
 *      and every claim's status flipped to 'batched'.
 *   4. Any claim missing `payer_profile_id` blocks the request (422) before
 *      any writes — even when `splitByPayer:true` (we never invent a payer).
 */
import { strict as assert } from "node:assert";
import { before, beforeEach, mock, test } from "node:test";

type ClaimRow = {
  id: string;
  claim_status: string;
  total_charge: number;
  held_at: string | null;
  archived_at: string | null;
  payer_profile_id: string | null;
};

type Inserted = {
  table: string;
  rows: Record<string, unknown>[];
};

const scenario: {
  claims: ClaimRow[];
  inserts: Inserted[];
  deletes: Array<{ table: string; filters: Array<{ field: string; value: unknown }> }>;
  updates: Array<{
    table: string;
    patch: Record<string, unknown>;
    filters: Array<{ field: string; value: unknown }>;
    inIds: string[] | null;
  }>;
  batchInsertError: string | null;
  linkInsertError: string | null;
  claimUpdateError: string | null;
  batchIdSeq: number;
} = {
  claims: [],
  inserts: [],
  deletes: [],
  updates: [],
  batchInsertError: null,
  linkInsertError: null,
  claimUpdateError: null,
  batchIdSeq: 0,
};

function resetScenario() {
  scenario.claims = [];
  scenario.inserts = [];
  scenario.deletes = [];
  scenario.updates = [];
  scenario.batchInsertError = null;
  scenario.linkInsertError = null;
  scenario.claimUpdateError = null;
  scenario.batchIdSeq = 0;
}

// ── Fake supabase ────────────────────────────────────────────────────────
// Minimal chainable builder that supports the exact surface the route uses:
//   .from(table).select(cols).eq(...).in(...)                 (SELECT)
//   .from(table).insert(row|rows).select(cols).single()       (INSERT batch)
//   .from(table).insert(rows)                                  (INSERT links / events)
//   .from(table).update(patch).eq(...).in(...)                (UPDATE claims)
//   .from(table).delete().eq(...).eq(...)                      (DELETE rollback)
function fakeFrom(table: string) {
  const filters: Array<{ field: string; value: unknown }> = [];
  let inIds: string[] | null = null;
  let op: "select" | "insert" | "update" | "delete" | null = null;
  let insertRows: Record<string, unknown>[] = [];
  let updatePatch: Record<string, unknown> = {};
  let selectAfterInsert = false;

  const chain: Record<string, unknown> = {};
  chain.select = (_cols: string) => {
    if (op === null) op = "select";
    if (op === "insert") selectAfterInsert = true;
    return chain;
  };
  chain.eq = (field: string, value: unknown) => {
    filters.push({ field, value });
    return chain;
  };
  chain.in = (_field: string, values: string[]) => {
    inIds = values;
    return chain;
  };
  chain.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
    op = "insert";
    insertRows = Array.isArray(rows) ? rows : [rows];
    scenario.inserts.push({ table, rows: insertRows });
    return chain;
  };
  chain.update = (patch: Record<string, unknown>) => {
    op = "update";
    updatePatch = patch;
    return chain;
  };
  chain.delete = () => {
    op = "delete";
    return chain;
  };
  chain.single = () => {
    if (op === "insert" && table === "claim_837p_batches") {
      if (scenario.batchInsertError) {
        return Promise.resolve({ data: null, error: { message: scenario.batchInsertError } });
      }
      scenario.batchIdSeq += 1;
      const id = `batch-${scenario.batchIdSeq}`;
      const number = (insertRows[0] as Record<string, unknown>).batch_number as string;
      return Promise.resolve({ data: { id, batch_number: number }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  // SELECT (and rollback deletes / link inserts / update flips) all resolve
  // via .then. Insert-with-.select-but-no-.single never happens in this route.
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
    if (op === "select") {
      // SELECT professional_claims for the pre-flight check.
      const rows = scenario.claims.filter((c) => (inIds ? inIds.includes(c.id) : true));
      return Promise.resolve(onFulfilled({ data: rows, error: null }));
    }
    if (op === "insert" && table === "claim_837p_batch_claims") {
      if (scenario.linkInsertError) {
        return Promise.resolve(onFulfilled({ data: null, error: { message: scenario.linkInsertError } }));
      }
      return Promise.resolve(onFulfilled({ data: null, error: null }));
    }
    if (op === "insert" && table === "claim_status_events") {
      return Promise.resolve(onFulfilled({ data: null, error: null }));
    }
    if (op === "update" && table === "professional_claims") {
      scenario.updates.push({ table, patch: updatePatch, filters, inIds });
      if (scenario.claimUpdateError) {
        return Promise.resolve(onFulfilled({ data: null, error: { message: scenario.claimUpdateError } }));
      }
      return Promise.resolve(onFulfilled({ data: null, error: null }));
    }
    if (op === "delete") {
      scenario.deletes.push({ table, filters });
      return Promise.resolve(onFulfilled({ data: null, error: null }));
    }
    // Unhandled — return empty so we don't hang.
    return Promise.resolve(onFulfilled({ data: null, error: null }));
  };
  // Mark unused so the linter doesn't trip on the .select-after-insert
  // branch only used implicitly.
  void selectAfterInsert;
  return chain;
}

before(() => {
  mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseAdminClient: () => ({
        from(table: string) {
          return fakeFrom(table);
        },
      }),
    },
  });
  mock.module("@/lib/claims/rebuild837PBatchFile", {
    namedExports: {
      // Stub the generator so this suite stays focused on the batch-creation
      // invariants (one payer per batch, rollback semantics, etc.). The
      // auto-generate-on-create behavior is covered separately.
      rebuild837PBatchFile: async (args: { batchId: string }) => ({
        ok: true,
        batchId: args.batchId,
        fileName: `${args.batchId}.x12`,
        claimCount: 1,
      }),
    },
  });
  mock.module("@/lib/billing/requireBillingAccess", {
    namedExports: {
      requireBillingAccess: async () => ({
        organizationId: "org-1",
        staffId: "staff-1",
        userId: "user-1",
        roles: [],
        permissions: [],
        isDevPassthrough: false,
      }),
    },
  });
});

beforeEach(() => {
  resetScenario();
});

type PostHandler = (req: Request) => Promise<Response>;
async function loadHandler(): Promise<PostHandler> {
  const mod = await import("../route");
  return mod.POST as PostHandler;
}

function makeReq(body: Record<string, unknown>): Request {
  return new Request("https://app.test/api/billing/ready-to-generate/bulk-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const READY = (id: string, payerProfileId: string | null, charge = 100): ClaimRow => ({
  id,
  claim_status: "ready_for_batch",
  total_charge: charge,
  held_at: null,
  archived_at: null,
  payer_profile_id: payerProfileId,
});

test("single-payer selection: creates one batch and flips claims to batched (back-compat)", async () => {
  scenario.claims = [
    READY("c1", "payer-A", 100),
    READY("c2", "payer-A", 250),
  ];
  const POST = await loadHandler();

  const res = await POST(makeReq({ organizationId: "org-1", claimIds: ["c1", "c2"] }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    success: boolean;
    batchId: string;
    batchNumber: string;
    claimCount: number;
    totalChargeAmount: number;
    batches: Array<{ payerProfileId: string | null; batchId: string; claimCount: number }>;
  };

  assert.equal(body.success, true);
  assert.equal(body.claimCount, 2);
  assert.equal(body.totalChargeAmount, 350);
  assert.equal(body.batches.length, 1);
  assert.equal(body.batches[0].payerProfileId, "payer-A");
  assert.equal(body.batches[0].claimCount, 2);

  // Exactly one batch row + one link insert + one status flip (+ audit insert
  // is best-effort, allowed to be present or absent).
  const batchInserts = scenario.inserts.filter((i) => i.table === "claim_837p_batches");
  const linkInserts = scenario.inserts.filter((i) => i.table === "claim_837p_batch_claims");
  assert.equal(batchInserts.length, 1);
  assert.equal(linkInserts.length, 1);
  assert.equal(linkInserts[0].rows.length, 2);
  assert.equal(scenario.updates.length, 1);
  assert.equal(scenario.updates[0].patch.claim_status, "batched");
  assert.deepEqual(scenario.updates[0].inIds, ["c1", "c2"]);
  // No rollback deletes on the happy path.
  assert.equal(
    scenario.deletes.filter((d) => d.table === "claim_837p_batches").length,
    0,
  );
});

test("multi-payer selection without splitByPayer is rejected 422 with per-payer breakdown and no writes", async () => {
  scenario.claims = [
    READY("c1", "payer-A", 100),
    READY("c2", "payer-B", 200),
    READY("c3", "payer-A", 50),
  ];
  const POST = await loadHandler();
  const res = await POST(makeReq({ organizationId: "org-1", claimIds: ["c1", "c2", "c3"] }));
  assert.equal(res.status, 422);

  const body = (await res.json()) as {
    success: boolean;
    code: string;
    error: string;
    payerBreakdown: Array<{ payerProfileId: string | null; claimCount: number; totalChargeAmount: number }>;
  };
  assert.equal(body.success, false);
  assert.equal(body.code, "multi_payer_selection");
  assert.match(body.error, /splitByPayer/);
  // Breakdown is keyed by payer, with the right counts + sums.
  const byPayer = new Map(body.payerBreakdown.map((r) => [r.payerProfileId, r]));
  assert.equal(byPayer.get("payer-A")?.claimCount, 2);
  assert.equal(byPayer.get("payer-A")?.totalChargeAmount, 150);
  assert.equal(byPayer.get("payer-B")?.claimCount, 1);
  assert.equal(byPayer.get("payer-B")?.totalChargeAmount, 200);

  // No batch / link / update should have happened.
  assert.equal(scenario.inserts.filter((i) => i.table === "claim_837p_batches").length, 0);
  assert.equal(scenario.inserts.filter((i) => i.table === "claim_837p_batch_claims").length, 0);
  assert.equal(scenario.updates.length, 0);
});

test("multi-payer selection with splitByPayer:true creates one batch per payer", async () => {
  scenario.claims = [
    READY("c1", "payer-A", 100),
    READY("c2", "payer-B", 200),
    READY("c3", "payer-A", 50),
    READY("c4", "payer-B", 75),
  ];
  const POST = await loadHandler();
  const res = await POST(
    makeReq({
      organizationId: "org-1",
      claimIds: ["c1", "c2", "c3", "c4"],
      splitByPayer: true,
    }),
  );
  assert.equal(res.status, 200);

  const body = (await res.json()) as {
    success: boolean;
    claimCount: number;
    totalChargeAmount: number;
    batches: Array<{
      payerProfileId: string | null;
      batchId: string;
      batchNumber: string;
      claimCount: number;
      totalChargeAmount: number;
    }>;
  };
  assert.equal(body.success, true);
  assert.equal(body.claimCount, 4);
  assert.equal(body.totalChargeAmount, 425);
  assert.equal(body.batches.length, 2);

  const byPayer = new Map(body.batches.map((b) => [b.payerProfileId, b]));
  assert.equal(byPayer.get("payer-A")?.claimCount, 2);
  assert.equal(byPayer.get("payer-A")?.totalChargeAmount, 150);
  assert.equal(byPayer.get("payer-B")?.claimCount, 2);
  assert.equal(byPayer.get("payer-B")?.totalChargeAmount, 275);
  // Batch numbers must be distinct (one per payer).
  assert.notEqual(byPayer.get("payer-A")?.batchNumber, byPayer.get("payer-B")?.batchNumber);

  // Two batch inserts and two link inserts, each link insert carrying only
  // its own payer's claims.
  const batchInserts = scenario.inserts.filter((i) => i.table === "claim_837p_batches");
  const linkInserts = scenario.inserts.filter((i) => i.table === "claim_837p_batch_claims");
  assert.equal(batchInserts.length, 2);
  assert.equal(linkInserts.length, 2);
  for (const li of linkInserts) {
    const ids = li.rows.map((r) => r.professional_claim_id as string).sort();
    // Each link insert must reference exactly two claims that share a payer.
    assert.equal(ids.length, 2);
    const payers = new Set(ids.map((id) => scenario.claims.find((c) => c.id === id)!.payer_profile_id));
    assert.equal(payers.size, 1, `link insert mixed payers: ${[...payers].join(",")}`);
  }

  // Two status-flip updates, one per payer's id-set.
  assert.equal(scenario.updates.length, 2);
  for (const u of scenario.updates) {
    assert.equal(u.patch.claim_status, "batched");
    assert.equal(u.inIds?.length, 2);
  }
});

test("any claim without a payer_profile_id blocks the request (422) even with splitByPayer:true", async () => {
  scenario.claims = [
    READY("c1", "payer-A", 100),
    READY("c2", null, 50), // orphan — no payer assigned
  ];
  const POST = await loadHandler();
  const res = await POST(
    makeReq({ organizationId: "org-1", claimIds: ["c1", "c2"], splitByPayer: true }),
  );
  assert.equal(res.status, 422);
  const body = (await res.json()) as {
    success: boolean;
    error: string;
    payerBreakdown: Array<{ payerProfileId: string | null; claimCount: number }>;
  };
  assert.equal(body.success, false);
  assert.match(body.error, /no payer/i);
  assert.ok(
    body.payerBreakdown.some((r) => r.payerProfileId === null),
    "payerBreakdown must surface the orphan bucket so the UI can flag the bad rows",
  );
  // Nothing should have been written.
  assert.equal(scenario.inserts.filter((i) => i.table === "claim_837p_batches").length, 0);
  assert.equal(scenario.updates.length, 0);
});
