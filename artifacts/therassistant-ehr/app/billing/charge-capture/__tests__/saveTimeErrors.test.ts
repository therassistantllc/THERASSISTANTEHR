/**
 * Coverage for the save-time error format Charge Capture shows when a
 * code fails validation.
 *
 * The validator now distinguishes three failure modes for a single
 * code — unknown, retired, header (non-billable) — and the format the
 * save banner uses must keep them visually distinct so the biller
 * knows what to do. This test wires up `validateCode` against a
 * mocked `/api/billing/codes/{diagnoses,procedures}` response, then
 * runs the result through `describeCodeForSaveError` (the same helper
 * `ChargeCaptureClient` uses on save) and pins the strings:
 *
 *   - terminated CPT      -> "<code> (retired YYYY-MM-DD)"
 *   - ICD-10 parent/header -> "<code> (header — not billable)"
 *   - inactive CPT w/ no exp date -> "<code> (header — not billable)"
 *   - unknown code         -> "<code> (not found)"
 *
 * If anyone changes the wording, this test catches it before billers
 * see the regression.
 */
import { strict as assert } from "node:assert";
import { before, beforeEach, test } from "node:test";

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type CodeRow = {
  code: string;
  description: string;
  code_system: string;
  is_active: boolean;
  expiration_date: string | null;
};

// Rows the fake codes API will return, keyed by code (upper).
const dxRows = new Map<string, CodeRow>();
const cptRows = new Map<string, CodeRow>();

function installFakeFetch() {
  const fake: FakeFetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, "https://app.test");
    const q = (parsed.searchParams.get("q") ?? "").toUpperCase();
    const isDx = parsed.pathname.endsWith("/api/billing/codes/diagnoses");
    const table = isDx ? dxRows : cptRows;
    const match = table.get(q);
    const items = match ? [match] : [];
    return new Response(JSON.stringify({ success: true, items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  (globalThis as { fetch: FakeFetch }).fetch = fake;
}

before(() => {
  installFakeFetch();
});

beforeEach(() => {
  dxRows.clear();
  cptRows.clear();
});

async function loadHelpers() {
  // Import fresh so the in-module validation cache starts empty for each
  // test (the cache is shared at module scope, but new entries per code
  // don't bleed across tests since we use unique codes per assertion).
  const mod = await import("../CodeCombobox");
  return {
    validateCode: mod.validateCode,
    describeCodeForSaveError: mod.describeCodeForSaveError,
  };
}

test("terminated CPT renders as 'retired YYYY-MM-DD' in the save-time error", async () => {
  cptRows.set("90806", {
    code: "90806",
    description: "Psychotherapy 45-50 min",
    code_system: "HCPCS",
    is_active: false,
    expiration_date: "2012-12-31",
  });

  const { validateCode, describeCodeForSaveError } = await loadHelpers();
  const v = await validateCode("procedure", "90806");
  assert.equal(v.status, "retired");

  const msg = describeCodeForSaveError("90806", v);
  assert.equal(msg, "90806 (retired 2012-12-31)");
});

test("ICD-10 parent/header renders as 'header — not billable' in the save-time error", async () => {
  dxRows.set("F33", {
    code: "F33",
    description: "Major depressive disorder, recurrent",
    code_system: "ICD10",
    is_active: false,
    expiration_date: null,
  });

  const { validateCode, describeCodeForSaveError } = await loadHelpers();
  const v = await validateCode("diagnosis", "F33");
  assert.equal(v.status, "header");

  const msg = describeCodeForSaveError("F33", v);
  assert.equal(msg, "F33 (header — not billable)");
});

test("inactive CPT with no expiration date also renders as 'header — not billable'", async () => {
  cptRows.set("99201", {
    code: "99201",
    description: "Office visit new pt (deleted)",
    code_system: "HCPCS",
    is_active: false,
    expiration_date: null,
  });

  const { validateCode, describeCodeForSaveError } = await loadHelpers();
  const v = await validateCode("procedure", "99201");
  assert.equal(v.status, "header");

  const msg = describeCodeForSaveError("99201", v);
  assert.equal(msg, "99201 (header — not billable)");
});

test("unknown code renders as 'not found' in the save-time error", async () => {
  // No row registered -> /codes API returns items: [] -> validateCode = unknown.
  const { validateCode, describeCodeForSaveError } = await loadHelpers();
  const v = await validateCode("diagnosis", "Z99999");
  assert.equal(v.status, "unknown");

  const msg = describeCodeForSaveError("Z99999", v);
  assert.equal(msg, "Z99999 (not found)");
});

test("active code yields no save-time error wording (status active, plain code)", async () => {
  dxRows.set("F33.0", {
    code: "F33.0",
    description: "MDD recurrent, mild",
    code_system: "ICD10",
    is_active: true,
    expiration_date: null,
  });
  const { validateCode, describeCodeForSaveError } = await loadHelpers();
  const v = await validateCode("diagnosis", "F33.0");
  assert.equal(v.status, "active");
  // Active codes are never surfaced in the error string, but the helper
  // is still defined for them and should return the bare code.
  assert.equal(describeCodeForSaveError("F33.0", v), "F33.0");
});
