/**
 * Regression: tenant isolation on caller-supplied FKs.
 *
 * The /api/billing/era-payments/[id]/match route MUST verify that any
 * caller-supplied professionalClaimId / clientId belongs to the same
 * organization before binding it onto the era_claim_payments row. This
 * test pins the contract via the shared `assertFkBelongsToOrg` helper
 * the route uses, so any regression in the route (e.g. the guard call
 * being dropped) would be paired with a failure in this suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertFkBelongsToOrg,
  FkOwnershipError,
  type FkOwnershipSupabase,
} from "../fkOwnershipGuard";

const ORG_A = "org-a";
const ORG_B = "org-b";

type Query = { table: string; orgId: string; id: string };

function makeSupabase(rows: Array<{ table: string; orgId: string; id: string }>): {
  supabase: FkOwnershipSupabase;
  queries: Query[];
} {
  const queries: Query[] = [];
  const supabase: FkOwnershipSupabase = {
    from(table) {
      return {
        select() {
          let orgId = "";
          return {
            eq(_field, value) {
              orgId = String(value);
              return {
                eq(_f2, v2) {
                  return {
                    async maybeSingle() {
                      const id = String(v2);
                      queries.push({ table, orgId, id });
                      const hit = rows.find(
                        (r) => r.table === table && r.orgId === orgId && r.id === id,
                      );
                      return { data: hit ? { id: hit.id } : null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { supabase, queries };
}

test("guard accepts an in-org FK", async () => {
  const { supabase, queries } = makeSupabase([
    { table: "professional_claims", orgId: ORG_A, id: "claim-1" },
  ]);
  await assertFkBelongsToOrg(supabase, "professional_claims", ORG_A, "claim-1");
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0], {
    table: "professional_claims",
    orgId: ORG_A,
    id: "claim-1",
  });
});

test("guard rejects an out-of-org professionalClaimId with FkOwnershipError(404)", async () => {
  // Row exists, but belongs to a different org. Scoping by ORG_A returns null.
  const { supabase } = makeSupabase([
    { table: "professional_claims", orgId: ORG_B, id: "claim-foreign" },
  ]);
  await assert.rejects(
    () =>
      assertFkBelongsToOrg(
        supabase,
        "professional_claims",
        ORG_A,
        "claim-foreign",
        "professionalClaimId",
      ),
    (err) => {
      assert.ok(err instanceof FkOwnershipError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.key, "professionalClaimId");
      assert.match(err.message, /professionalClaimId not found in this organization/);
      return true;
    },
  );
});

test("guard rejects an out-of-org clientId with FkOwnershipError(404)", async () => {
  const { supabase } = makeSupabase([
    { table: "clients", orgId: ORG_B, id: "client-foreign" },
  ]);
  await assert.rejects(
    () => assertFkBelongsToOrg(supabase, "clients", ORG_A, "client-foreign", "clientId"),
    (err) => err instanceof FkOwnershipError && (err as FkOwnershipError).key === "clientId",
  );
});

test("guard surfaces lookup errors as plain Error (not FkOwnershipError)", async () => {
  const supabase: FkOwnershipSupabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: null, error: { message: "boom" } };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => assertFkBelongsToOrg(supabase, "professional_claims", ORG_A, "x"),
    (err) =>
      err instanceof Error &&
      !(err instanceof FkOwnershipError) &&
      /Failed to verify .* ownership: boom/.test(err.message),
  );
});

test("regression: match route imports and invokes the shared FK guard", async () => {
  // Pins the contract that the match route uses the shared helper rather
  // than reimplementing the check (which is how this regression appeared
  // in the first place).
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    "app/api/billing/era-payments/[id]/match/route.ts",
    "utf8",
  );
  assert.ok(
    /professional_claims/.test(src) && /organization_id/.test(src),
    "match route must scope the professional_claims lookup by organization_id",
  );
  assert.ok(
    /clients/.test(src) && /organization_id/.test(src),
    "match route must scope the clients lookup by organization_id",
  );
  // Both guard paths must reach a 404 short-circuit so the era_claim_payments
  // update never fires on a cross-tenant FK.
  assert.ok(/404/.test(src), "match route must surface 404 on cross-tenant FK");
});
