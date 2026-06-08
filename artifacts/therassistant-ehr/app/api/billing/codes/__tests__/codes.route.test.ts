/**
 * Coverage for the billing reference-code lookup endpoints used by
 * Charge Capture's CodeCombobox + save-time validator.
 *
 * Pins three contracts the UI depends on:
 *
 *   1. Both `/api/billing/codes/diagnoses` and
 *      `/api/billing/codes/procedures` return inactive rows when
 *      `includeInactive` is not "0" (the default), with `is_active`
 *      and `expiration_date` on every item — without those fields
 *      CodeCombobox cannot distinguish retired vs. header.
 *   2. Results are ordered with `is_active=true` first (so the
 *      combobox surfaces the billable code before any
 *      retired/header sibling).
 *   3. `includeInactive=0` adds an `is_active=true` filter so callers
 *      that want active-only data still get it.
 */
import { strict as assert } from "node:assert";
import { before, beforeEach, mock, test } from "node:test";

type Row = Record<string, unknown>;
type OrderCall = { field: string; ascending: boolean };

interface Scenario {
  table: string | null;
  rows: Row[];
  selectArg: string | null;
  filters: Array<{ field: string; value: unknown }>;
  orders: OrderCall[];
  limit: number | null;
  orFilter: string | null;
}

const scenario: Scenario = {
  table: null,
  rows: [],
  selectArg: null,
  filters: [],
  orders: [],
  limit: null,
  orFilter: null,
};

function resetScenario() {
  scenario.table = null;
  scenario.rows = [];
  scenario.selectArg = null;
  scenario.filters = [];
  scenario.orders = [];
  scenario.limit = null;
  scenario.orFilter = null;
}

function fakeBuilder(table: string) {
  scenario.table = table;
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    scenario.selectArg = cols;
    return chain;
  };
  chain.eq = (field: string, value: unknown) => {
    scenario.filters.push({ field, value });
    return chain;
  };
  chain.or = (expr: string) => {
    scenario.orFilter = expr;
    return chain;
  };
  chain.order = (field: string, opts: { ascending: boolean }) => {
    scenario.orders.push({ field, ascending: opts.ascending });
    return chain;
  };
  chain.limit = (n: number) => {
    scenario.limit = n;
    return chain;
  };
  // Sort rows the way the order() calls dictate so the test sees the
  // route's intended ordering reflected in the response.
  chain.then = (onFulfilled: (v: { data: Row[]; error: null }) => unknown) => {
    const data = [...scenario.rows].sort((a, b) => {
      for (const o of scenario.orders) {
        const av = a[o.field];
        const bv = b[o.field];
        if (av === bv) continue;
        const cmp = av === null || av === undefined
          ? 1
          : bv === null || bv === undefined
            ? -1
            : av < bv
              ? -1
              : 1;
        return o.ascending ? cmp : -cmp;
      }
      return 0;
    });
    return Promise.resolve(onFulfilled({ data, error: null }));
  };
  return chain;
}

before(() => {
  mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseAdminClient: () => ({
        from(table: string) {
          return fakeBuilder(table);
        },
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

type GetHandler = (req: Request) => Promise<Response>;

async function loadDiagnoses(): Promise<GetHandler> {
  const mod = await import("../diagnoses/route");
  return mod.GET as GetHandler;
}

async function loadProcedures(): Promise<GetHandler> {
  const mod = await import("../procedures/route");
  return mod.GET as GetHandler;
}

// Three rows: an active code, a retired one with an expiration date,
// and a header (inactive, no expiration date). The route should pass
// them all through with their is_active/expiration_date intact, and
// order the active one ahead of the inactive ones.
const DX_ROWS: Row[] = [
  { code: "F33.0", description: "MDD recurrent, mild", code_system: "ICD10", is_active: true, expiration_date: null },
  { code: "F33", description: "Major depressive disorder, recurrent (header)", code_system: "ICD10", is_active: false, expiration_date: null },
  { code: "F32.9", description: "MDD unspecified (retired)", code_system: "ICD10", is_active: false, expiration_date: "2024-09-30" },
];

const CPT_ROWS: Row[] = [
  { code: "90837", description: "Psychotherapy, 60 min", code_system: "HCPCS", is_active: true, expiration_date: null },
  { code: "90806", description: "Psychotherapy 45-50 min (retired)", code_system: "HCPCS", is_active: false, expiration_date: "2012-12-31" },
  { code: "99201", description: "Office visit new pt (deleted)", code_system: "HCPCS", is_active: false, expiration_date: null },
];

function assertActiveFirstWithFields(items: Row[]) {
  assert.ok(items.length >= 2, "expected multiple rows in the response");
  for (const item of items) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(item, "is_active"),
      `every item must carry is_active so the UI can flag inactive rows: ${JSON.stringify(item)}`,
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(item, "expiration_date"),
      `every item must carry expiration_date so the UI can split retired vs. header: ${JSON.stringify(item)}`,
    );
  }
  // Find the first active row; every preceding row must also be active.
  const firstInactiveIdx = items.findIndex((r) => r.is_active === false);
  if (firstInactiveIdx === -1) return; // all active is also fine
  for (let i = 0; i < firstInactiveIdx; i++) {
    assert.equal(
      items[i].is_active,
      true,
      `expected active rows before inactive ones; got ${JSON.stringify(items[i])} before an inactive row`,
    );
  }
}

test("GET /api/billing/codes/diagnoses returns inactive rows by default with is_active + expiration_date, active first", async () => {
  scenario.rows = DX_ROWS;
  const GET = await loadDiagnoses();
  const res = await GET(new Request("https://app.test/api/billing/codes/diagnoses?q=F"));
  assert.equal(res.status, 200);

  const body = (await res.json()) as { success: boolean; items: Row[] };
  assert.equal(body.success, true);
  assert.equal(scenario.table, "diagnosis_codes");
  assert.match(scenario.selectArg ?? "", /is_active/);
  assert.match(scenario.selectArg ?? "", /expiration_date/);

  // Default (no includeInactive=0) must NOT add an is_active=true filter.
  assert.equal(
    scenario.filters.some((f) => f.field === "is_active"),
    false,
    "default request must include inactive rows (no is_active=true filter)",
  );

  // Ordering: is_active DESC then code ASC (active rows surface first).
  assert.deepEqual(
    scenario.orders,
    [
      { field: "is_active", ascending: false },
      { field: "code", ascending: true },
    ],
  );

  assertActiveFirstWithFields(body.items);

  // Every classification needed by CodeCombobox must be representable:
  // at least one active row, at least one retired (inactive + date),
  // at least one header (inactive + null date).
  const retired = body.items.find((r) => r.is_active === false && r.expiration_date);
  const header = body.items.find((r) => r.is_active === false && !r.expiration_date);
  assert.ok(retired, "expected at least one retired row (is_active=false, expiration_date set)");
  assert.ok(header, "expected at least one header row (is_active=false, expiration_date=null)");
});

test("GET /api/billing/codes/procedures returns inactive rows by default with is_active + expiration_date, active first", async () => {
  scenario.rows = CPT_ROWS;
  const GET = await loadProcedures();
  const res = await GET(new Request("https://app.test/api/billing/codes/procedures?q=9"));
  assert.equal(res.status, 200);

  const body = (await res.json()) as { success: boolean; items: Row[] };
  assert.equal(body.success, true);
  assert.equal(scenario.table, "procedure_codes");
  assert.match(scenario.selectArg ?? "", /is_active/);
  assert.match(scenario.selectArg ?? "", /expiration_date/);

  assert.equal(
    scenario.filters.some((f) => f.field === "is_active"),
    false,
    "default request must include inactive rows (no is_active=true filter)",
  );
  assert.deepEqual(
    scenario.orders,
    [
      { field: "is_active", ascending: false },
      { field: "code", ascending: true },
    ],
  );

  assertActiveFirstWithFields(body.items);

  const retired = body.items.find((r) => r.is_active === false && r.expiration_date);
  const nonBillable = body.items.find((r) => r.is_active === false && !r.expiration_date);
  assert.ok(retired, "expected at least one retired CPT row (is_active=false, expiration_date set)");
  assert.ok(nonBillable, "expected at least one non-billable CPT row (is_active=false, expiration_date=null)");
});

test("includeInactive=0 filters to active rows only (both endpoints)", async () => {
  // Diagnoses
  scenario.rows = DX_ROWS;
  const dxGet = await loadDiagnoses();
  await dxGet(
    new Request("https://app.test/api/billing/codes/diagnoses?q=F&includeInactive=0"),
  );
  assert.ok(
    scenario.filters.some((f) => f.field === "is_active" && f.value === true),
    "diagnoses: includeInactive=0 must apply is_active=true filter",
  );

  // Procedures
  resetScenario();
  scenario.rows = CPT_ROWS;
  const cptGet = await loadProcedures();
  await cptGet(
    new Request("https://app.test/api/billing/codes/procedures?q=9&includeInactive=0"),
  );
  assert.ok(
    scenario.filters.some((f) => f.field === "is_active" && f.value === true),
    "procedures: includeInactive=0 must apply is_active=true filter",
  );
});
