/**
 * Task #184 regression: the generic findOrCreateRow helper must converge
 * two concurrent callers on a single inserted row when the DB raises
 * 23505 on the second insert (the partial unique index race).
 *
 * Mirrors lib/encounters/__tests__/findOrCreate.test.ts but for the
 * generic helper used by claims / payments / ledger entries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findOrCreateRow, UNIQUE_VIOLATION } from "../findOrCreate";

type Row = { id: string };

/**
 * Fake "table" that enforces a single-row uniqueness constraint and
 * raises a Postgres-style { code: "23505" } on duplicate inserts. A
 * shared `gate` lets a test interleave two callers' SELECT/INSERTs.
 */
function makeFakeTable(opts: { gate?: () => Promise<void> } = {}) {
  const rows: Row[] = [];
  let nextId = 0;
  const gate = opts.gate ?? (async () => {});

  return {
    rows,
    findExisting: async () => {
      await gate();
      return { data: (rows[0] ?? null) as Row | null, error: null };
    },
    insertNew: async () => {
      await gate();
      if (rows.length > 0) {
        return { data: null, error: { message: "duplicate key", code: UNIQUE_VIOLATION } };
      }
      const row: Row = { id: `row-${++nextId}` };
      rows.push(row);
      return { data: row, error: null };
    },
  };
}

test("findOrCreateRow: serial second call returns the existing row without inserting", async () => {
  const table = makeFakeTable();

  const r1 = await findOrCreateRow<Row>({
    label: "thing",
    findExisting: table.findExisting,
    insertNew: table.insertNew,
  });
  const r2 = await findOrCreateRow<Row>({
    label: "thing",
    findExisting: table.findExisting,
    insertNew: table.insertNew,
  });

  assert.equal(r1.ok && r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.row.id, r2.row.id);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false);
  assert.equal(table.rows.length, 1);
});

test("findOrCreateRow: two concurrent callers converge on a single row", async () => {
  let pending: Array<() => void> = [];
  const gate = () => new Promise<void>((resolve) => pending.push(resolve));

  const table = makeFakeTable({ gate });

  const p1 = findOrCreateRow<Row>({
    label: "thing",
    findExisting: table.findExisting,
    insertNew: table.insertNew,
  });
  const p2 = findOrCreateRow<Row>({
    label: "thing",
    findExisting: table.findExisting,
    insertNew: table.insertNew,
  });

  let settled = false;
  const done = Promise.all([p1, p2]).then((r) => {
    settled = true;
    return r;
  });

  while (!settled) {
    await new Promise((r) => setImmediate(r));
    const toRelease = pending;
    pending = [];
    toRelease.forEach((r) => r());
  }

  const [r1, r2] = await done;
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.row.id, r2.row.id, "both callers must converge on the same row id");
  assert.equal(table.rows.length, 1, "exactly one row written to the DB");
  // Exactly one caller observed the insert as 'created'; the loser re-selected.
  assert.equal([r1.created, r2.created].filter(Boolean).length, 1);
});

test("findOrCreateRow: surfaces non-23505 insert errors verbatim", async () => {
  const r = await findOrCreateRow<Row>({
    label: "thing",
    findExisting: async () => ({ data: null, error: null }),
    insertNew: async () => ({ data: null, error: { message: "fk violation", code: "23503" } }),
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /fk violation/);
  assert.equal(r.code, "23503");
});

test("findOrCreateRow: surfaces 23505 with no re-selected row as a real failure", async () => {
  // Pathological case: insert raises 23505 but the second SELECT still
  // sees no row (could happen with a deleted-and-reinserted window or a
  // mismatched predicate). The helper must NOT silently report success.
  const r = await findOrCreateRow<Row>({
    label: "thing",
    findExisting: async () => ({ data: null, error: null }),
    insertNew: async () => ({ data: null, error: { message: "duplicate key", code: UNIQUE_VIOLATION } }),
  });
  assert.equal(r.ok, false);
});

test("regression: migration adds the five partial unique indexes for the sweep", () => {
  const sql = readFileSync(
    "supabase/migrations/20260601000000_find_or_create_dedupe_indexes.sql",
    "utf8",
  );
  // One partial unique index per table touched by the sweep.
  assert.match(sql, /idx_professional_claims_unique_active_encounter[\s\S]*organization_id[\s\S]*encounter_id/);
  assert.match(sql, /idx_payment_postings_unique_active_import_item[\s\S]*payment_import_item_id/);
  assert.match(sql, /idx_payment_import_batches_unique_active_file_hash[\s\S]*source_file_hash/);
  assert.match(sql, /idx_era_posting_ledger_entries_unique_active[\s\S]*era_claim_payment_id[\s\S]*entry_type/);
  assert.match(sql, /idx_patient_invoices_unique_active_era_payment[\s\S]*era_claim_payment_id/);
  // All indexes must be partial on archived_at IS NULL so archived rows
  // don't block re-creation.
  const partialCount = (sql.match(/where\s+archived_at\s+is\s+null/gi) ?? []).length;
  assert.equal(partialCount, 5);
});

test("regression: call sites import the shared findOrCreate helper", () => {
  const claimsRoute = readFileSync(
    "app/api/claims/create-from-encounter/route.ts",
    "utf8",
  );
  assert.match(claimsRoute, /from "@\/lib\/db\/findOrCreate"/);
  assert.match(claimsRoute, /findOrCreateRow/);

  const paymentsRoute = readFileSync("app/api/payments/post/route.ts", "utf8");
  assert.match(paymentsRoute, /from "@\/lib\/db\/findOrCreate"/);
  assert.match(paymentsRoute, /findOrCreateRow/);

  const eraRoute = readFileSync(
    "app/api/clearinghouse/availity/era-835/route.ts",
    "utf8",
  );
  assert.match(eraRoute, /UNIQUE_VIOLATION/);

  const postingEngine = readFileSync("lib/payments/postingEngine/index.ts", "utf8");
  assert.match(postingEngine, /UNIQUE_VIOLATION/);
});
