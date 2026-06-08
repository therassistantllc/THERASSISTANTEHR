/**
 * Schema-drift guard for the posted-payments dashboard query (Task #396).
 *
 * The dashboard's ERA branch used to select `check_number` and
 * `era_received_date` from `era_claim_payments`, but the live schema only
 * has `check_eft_number` / `check_issue_date` (the X12-payer columns
 * `payer_name` / `payer_identifier` live on `era_import_batches`, not on
 * the claim row). The drift either silently returned null or 500'd the
 * dashboard depending on PostgREST's mood.
 *
 * This suite captures the exact select strings the query layer hands to
 * supabase-js and asserts every column resolves against the parsed
 * `database.types.ts` Row schema, so any future drift fails the test
 * instead of reaching production.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { queryPaymentsDashboard } from "../dashboardQuery";
import {
  SchemaGuardError,
  validateSelect,
} from "../../supabase/__tests__/schemaGuard";

interface CapturedSelect {
  table: string;
  columns: string;
}

function makeCapturingSupabase(): { client: never; selects: CapturedSelect[] } {
  const selects: CapturedSelect[] = [];

  function makeBuilder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    // The dashboard pre-resolves provider NPIs to claim ids and payer
    // filters to batch ids before issuing the ERA row query, and
    // short-circuits to zero rows if either lookup returns []. Seed a
    // synthetic id row for those helper tables so the ERA row loader
    // is actually reached (otherwise the capturing test would silently
    // miss drift in the row-loader select string).
    const seedRows: Record<string, Array<Record<string, unknown>>> = {
      professional_claims: [{ id: "00000000-0000-0000-0000-000000000001" }],
      era_import_batches: [{ id: "00000000-0000-0000-0000-000000000002" }],
    };
    b.eq = ret;
    b.in = ret;
    b.is = ret;
    b.gte = ret;
    b.lte = ret;
    b.ilike = ret;
    b.neq = ret;
    b.or = ret;
    b.not = ret;
    b.match = ret;
    b.contains = ret;
    b.order = ret;
    b.limit = ret;
    b.range = ret;
    b.single = async () => ({ data: null, error: null });
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (cb: (r: unknown) => unknown) =>
      Promise.resolve({
        data: seedRows[table] ?? [],
        count: (seedRows[table] ?? []).length,
        error: null,
      }).then(cb);
    b.select = (cols: string) => {
      selects.push({ table, columns: cols });
      return b;
    };
    return b;
  }

  const client = {
    from: (table: string) => ({
      select: (cols: string) => {
        const b = makeBuilder(table);
        return (b.select as (c: string) => unknown)(cols);
      },
    }),
  };
  return { client: client as never, selects };
}

describe("queryPaymentsDashboard — schema-drift guard", () => {
  it("every column referenced in a .select() exists on the live row schema", async () => {
    const cap = makeCapturingSupabase();
    await queryPaymentsDashboard(cap.client, {
      organizationId: "org-1",
      payerProfileId: "PAYER123",
      providerNpi: "1234567890",
      clientId: "client-1",
      eftCheckNumber: "999",
      depositDateFrom: "2026-01-01",
      depositDateTo: "2026-12-31",
      paymentDateFrom: "2026-01-01",
      paymentDateTo: "2026-12-31",
      eraImportDateFrom: "2026-01-01",
      eraImportDateTo: "2026-12-31",
    });
    assert.ok(cap.selects.length > 0, "expected at least one select to be captured");
    for (const { table, columns } of cap.selects) {
      validateSelect(table, columns);
    }

    // The capturing fake must actually reach the ERA row-loader path so
    // future column drift in `loadEraRows`' select string fails this test
    // (rather than being silently short-circuited by an earlier helper).
    const eraRowSelects = cap.selects.filter(
      (s) =>
        s.table === "era_claim_payments" &&
        s.columns.includes("clp04_payment_amount") &&
        s.columns.includes("era_import_batches"),
    );
    assert.ok(
      eraRowSelects.length > 0,
      `expected the ERA row select (with embedded era_import_batches join) to be captured, ` +
        `got tables: ${cap.selects.map((s) => s.table).join(", ")}`,
    );
    // And the captured ERA row select must NOT carry any of the historically
    // drifted column names at the top level (Task #396). Strip embedded
    // `foreign(...)` clauses first so legitimate uses of payer_name etc.
    // inside the `era_import_batches(...)` join don't trip this check.
    // This binds the assertion to the actual select string emitted by
    // `loadEraRows`, not a hardcoded copy.
    for (const { columns } of eraRowSelects) {
      const topLevel = columns.replace(/[a-z_]+\([^)]*\)/g, "");
      for (const ghost of [
        "check_number",
        "era_received_date",
        "payer_name",
        "payer_identifier",
      ]) {
        assert.ok(
          !new RegExp(`\\b${ghost}\\b`).test(topLevel),
          `ERA row select still references drifted top-level column '${ghost}': ${columns}`,
        );
      }
    }
  });

  it("flags the historical Task #396 regression (check_number / era_received_date)", () => {
    assert.throws(
      () =>
        validateSelect(
          "era_claim_payments",
          "id, organization_id, check_number, era_received_date",
        ),
      SchemaGuardError,
    );
  });

  it("flags payer_name / payer_identifier on era_claim_payments (they live on era_import_batches)", () => {
    assert.throws(
      () => validateSelect("era_claim_payments", "id, payer_name"),
      SchemaGuardError,
    );
    assert.throws(
      () => validateSelect("era_claim_payments", "id, payer_identifier"),
      SchemaGuardError,
    );
  });

  it("accepts the corrected ERA select shape", () => {
    validateSelect(
      "era_claim_payments",
      "id, organization_id, client_id, professional_claim_id, posting_status, claim_match_status, clp04_payment_amount, check_eft_number, check_issue_date, era_import_batch_id, created_at, era_import_batches(imported_at, payment_date, payer_name, payer_identifier)",
    );
  });
});
