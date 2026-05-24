/**
 * Static-source schema-drift sweep for the posted-payments family of tables
 * (Task #508 follow-up to Task #396).
 *
 * Task #396 fixed a single dashboard select that referenced columns
 * (`check_number` / `era_received_date` / `payer_name` / `payer_identifier`)
 * that don't exist on `era_claim_payments`. The fix added a `validateSelect`
 * helper, but only the dashboard query was wired up to a captured-select
 * test — every other module reading from the posted-payments tables was
 * one typo away from the same silent 500/null-row regression.
 *
 * Rather than spin up per-module capturing fakes for every reader (many
 * of them are large legacy modules with branchy queries that wouldn't be
 * easy to exercise), this suite walks the source tree, finds every
 * `.from('<table>').select(...)` chain that targets a posted-payments
 * table, and runs the literal select string through `validateSelect`.
 * Drift fails the test loudly.
 *
 * Limitations: only literal string selects survive the scan. Selects that
 * are interpolated or built dynamically are skipped (extremely rare in
 * this codebase). Adding a dynamically-built select for one of these
 * tables should be accompanied by a focused captured-select test.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  SchemaGuardError,
  validateSelect,
} from "../../supabase/__tests__/schemaGuard";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// /artifacts/therassistant-ehr — the artifact root.
const ARTIFACT_ROOT = path.resolve(HERE, "..", "..", "..");

const TABLES = [
  "era_claim_payments",
  "era_import_batches",
  "insurance_manual_payments",
  "client_payments",
  "payment_recoupments",
  "payment_refunds",
] as const;

/**
 * Walk the artifact source tree and yield every file likely to contain a
 * supabase select against the target tables. Restricted to `lib/` and
 * `app/` to skip generated types, tests, fixtures, and node_modules.
 */
function listSourceFiles(): string[] {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const pattern = `from\\(['"\`](${TABLES.join("|")})['"\`]\\)`;
  const res = spawnSync(
    "rg",
    ["-l", "--type", "ts", "-e", pattern, "lib", "app"],
    { cwd: ARTIFACT_ROOT, encoding: "utf8" },
  );
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`ripgrep failed: ${res.stderr}`);
  }
  return (res.stdout ?? "")
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    // Skip test files — they often build intentionally-malformed selects
    // (e.g. the dashboard schema-drift test asserts SchemaGuardError on
    // historically-drifted columns).
    .filter((p) => !/(__tests__|\.test\.ts$)/.test(p))
    .map((rel) => path.join(ARTIFACT_ROOT, rel));
}

interface Found {
  file: string;
  line: number;
  table: string;
  select: string;
}

/**
 * Extract `.from('<table>').select('<literal>')` chains. Only the
 * immediate verb after `.from(...)` is inspected — if the chain is
 * `.from(t).update(...)` or `.from(t).insert(...)`, no select is
 * captured. This avoids false positives where a later `.select(...)`
 * in the same file gets paired with an earlier `.from(...)`.
 */
function extractLiteralSelects(file: string): Found[] {
  const src = readFileSync(file, "utf8");
  const results: Found[] = [];
  const fromRe = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) {
    const table = m[1];
    if (!TABLES.includes(table as (typeof TABLES)[number])) continue;
    const tail = src.slice(m.index + m[0].length, m.index + 4000);
    const verb = tail.match(/\.(select|insert|update|delete|upsert|rpc|from)\(/);
    if (!verb || verb[1] !== "select") continue;
    const after = tail.slice(verb.index);
    // Only literal-string selects survive. Template-literal or
    // identifier-arg selects (rare) are skipped.
    const sm = after.match(/^\.select\(\s*(['"])([\s\S]*?)\1/);
    if (!sm) continue;
    const line = src.slice(0, m.index).split("\n").length;
    results.push({ file, line, table, select: sm[2] });
  }
  return results;
}

describe("posted-payments column drift sweep (Task #508)", () => {
  it("every literal .select() against the posted-payments tables resolves against the row schema", () => {
    const files = listSourceFiles();
    assert.ok(
      files.length > 0,
      "expected to find at least one source file referencing the posted-payments tables",
    );
    const all: Found[] = [];
    for (const f of files) all.push(...extractLiteralSelects(f));
    assert.ok(
      all.length > 0,
      "expected to extract at least one literal .select() across the sweep",
    );

    const failures: string[] = [];
    for (const found of all) {
      try {
        validateSelect(found.table, found.select);
      } catch (err) {
        const rel = path.relative(ARTIFACT_ROOT, found.file);
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`  ${rel}:${found.line}  [${found.table}]  ${msg}`);
      }
    }

    if (failures.length > 0) {
      assert.fail(
        `posted-payments column drift detected in ${failures.length} select(s):\n` +
          failures.join("\n"),
      );
    }
  });

  it("flags the Task #508 regression set (sanity check)", () => {
    // If someone re-introduces any of the historically-drifted column
    // names against the wrong table, validateSelect must still flag it.
    for (const [table, badCol] of [
      ["insurance_manual_payments", "professional_claim_id"],
      ["insurance_manual_payments", "payer_payment_amount"],
      ["insurance_manual_payments", "contractual_adjustment_amount"],
      ["era_claim_payments", "claim_id"],
      ["era_claim_payments", "check_number"],
      ["era_import_batches", "payer_profile_id"],
      ["client_payments", "payment_date"],
      ["client_payments", "paid_at"],
      ["client_payments", "stripe_payment_intent_id"],
    ] as const) {
      assert.throws(
        () => validateSelect(table, `id, ${badCol}`),
        SchemaGuardError,
        `expected validateSelect to reject ${table}.${badCol}`,
      );
    }
  });
});
