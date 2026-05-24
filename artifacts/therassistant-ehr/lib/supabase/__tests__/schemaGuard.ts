/**
 * Schema-aware guard for in-memory supabase fakes (shared across test suites).
 *
 * Originally lived at `lib/payments/postingEngine/__tests__/_schemaGuard.ts`
 * (Task #179). Task #140 surfaced a class of bug where a workqueue insert
 * used the wrong column name (`patient_id`, `queue_type`) or an enum value
 * that does not exist in `public.source_object_type` (e.g. `payment_refund`).
 * The fakes accepted those writes silently, so the bug only manifested in
 * production. Promoting the guard to a shared location lets every module's
 * hand-rolled fake supabase client (claims, eligibility, mailroom, EHR
 * billing, payments-import, ...) catch the same regression class at test
 * time instead of in prod.
 *
 * This guard parses the generated `lib/supabase/database.types.ts` once at
 * load time to extract the column allowlist for each table's `Insert:` block,
 * and pulls runtime enum values from the file's exported `Constants` object.
 * Tests that wire `validateWritePayload` into their fake's insert/update path
 * will fail loudly when a payload uses an unknown column or an invalid enum
 * value.
 *
 * Tables outside the allowlist (e.g. helper-only test tables that don't exist
 * in the real schema) are passed through untouched so existing assertions
 * keep working.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Constants } from "../database.types";

const TYPES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../database.types.ts",
);

/** Runtime enum -> allowed string values, sourced from the generated types file. */
const ENUM_VALUES: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(Constants.public.Enums).map(
    ([name, vals]) => [name, new Set(vals as readonly string[])],
  ),
);

/**
 * Manually-maintained enum-value overlay for enums whose generated
 * `Constants` entry is stale relative to later migrations or whose
 * accepted values have been extended in production code ahead of a
 * matching migration. Keep entries here in sync with new ALTER TYPE
 * migrations until the types file is regenerated.
 */
const EXTRA_ENUM_VALUES: Record<string, string[]> = {};
for (const [name, extras] of Object.entries(EXTRA_ENUM_VALUES)) {
  if (!ENUM_VALUES[name]) ENUM_VALUES[name] = new Set<string>();
  for (const v of extras) ENUM_VALUES[name].add(v);
}

/**
 * Manually-maintained column overlay for tables whose `database.types.ts`
 * entry is stale relative to later migrations, or for tables missing from
 * the generated types entirely.
 *
 * Currently empty: `database.types.ts` has been regenerated against the
 * live Supabase schema (covering migrations through
 * `20260603000000_insurance_policy_subscriber_relationship.sql`), so the
 * parser sees every real column natively and no overlay is required.
 *
 * RULE (Task #303): if you ever need to re-add an entry here, it MUST
 * cite the migration filename that actually creates the column in the
 * database. Adding an entry without a matching `alter table ... add
 * column` in `supabase/migrations/` will mask a Task #300-class prod bug
 * (writes silently dropped because the column does not really exist).
 * The preferred fix is always to regenerate `database.types.ts` rather
 * than add an overlay entry.
 */
const EXTRA_COLUMNS: Record<string, string[]> = {
  // Added by supabase/migrations/20260610000000_cob_signals.sql (Task #457).
  // Generated database.types.ts is regenerated less often than migrations
  // ship; the overlay keeps the schema guard accepting the COB columns
  // until the next types regen.
  eligibility_checks: [
    "other_payers",
    "other_payer_name",
    "other_payer_id",
    "other_payer_effective_date",
    "other_payer_termination_date",
  ],
  // Added by supabase/migrations/20260611010000_clients_emergency_contact.sql
  // (Task: capture full client identity when adding a new client).
  clients: ["emergency_contact_name", "emergency_contact_phone"],
  // Added by supabase/migrations/20260615000000_payer_documentation_transmissions.sql
  // (Task #550: send medical-review docs to the payer's records contact).
  payer_profiles: ["records_email", "records_fax"],
};

const ENUM_COLUMNS: Record<string, Record<string, string>> = {
  workqueue_items: {
    source_object_type: "source_object_type",
    status: "workqueue_status",
    priority: "workqueue_priority",
  },
  appointments: { appointment_status: "appointment_status" },
  encounters: { encounter_status: "encounter_status" },
  era_claim_payments: { posting_status: "payment_posting_status" },
  insurance_manual_payments: { posting_status: "payment_posting_status" },
  client_payments: { posting_status: "payment_posting_status" },
};

let tableColumnsCache: Record<string, Set<string>> | null = null;
let tableRowColumnsCache: Record<string, Set<string>> | null = null;

/**
 * Parse `database.types.ts` and extract the `Insert:` column lists per
 * table. The generated file uses very regular indentation: tables sit at
 * 6 spaces (`      tablename: {`), each `Insert: {` block sits at 8 spaces,
 * and columns inside it sit at 10 spaces. We rely on that shape rather
 * than running a real TS parser.
 */
function loadTableColumns(): Record<string, Set<string>> {
  if (tableColumnsCache) return tableColumnsCache;
  const src = readFileSync(TYPES_PATH, "utf-8");
  const lines = src.split("\n");
  const out: Record<string, Set<string>> = {};
  let currentTable: string | null = null;
  let inInsert = false;
  let cols: Set<string> | null = null;
  for (const line of lines) {
    const tableMatch = line.match(/^ {6}([a-z_][a-z0-9_]*): \{$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      inInsert = false;
      cols = null;
      continue;
    }
    if (!currentTable) continue;
    if (!inInsert) {
      if (line === "        Insert: {") {
        inInsert = true;
        cols = new Set<string>();
      }
      continue;
    }
    if (line === "        }") {
      if (cols && cols.size > 0) out[currentTable] = cols;
      inInsert = false;
      cols = null;
      continue;
    }
    const colMatch = line.match(/^ {10}([a-z_][a-z0-9_]*)\??:/);
    if (colMatch && cols) cols.add(colMatch[1]);
  }
  // Merge the manual overlay for stale/missing tables.
  for (const [table, extras] of Object.entries(EXTRA_COLUMNS)) {
    if (!out[table]) out[table] = new Set<string>();
    for (const c of extras) out[table].add(c);
  }
  tableColumnsCache = out;
  return out;
}

export class SchemaGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaGuardError";
  }
}

/**
 * Parse `database.types.ts` and extract the `Row:` column lists per
 * table. Rows describe what the database can return for a SELECT, so the
 * Row set is the source of truth for validating select column lists
 * (Task #396 — guard against drift like `era_received_date`/`check_number`
 * silently being requested from columns that no longer exist).
 */
function loadTableRowColumns(): Record<string, Set<string>> {
  if (tableRowColumnsCache) return tableRowColumnsCache;
  const src = readFileSync(TYPES_PATH, "utf-8");
  const lines = src.split("\n");
  const out: Record<string, Set<string>> = {};
  let currentTable: string | null = null;
  let inRow = false;
  let cols: Set<string> | null = null;
  for (const line of lines) {
    const tableMatch = line.match(/^ {6}([a-z_][a-z0-9_]*): \{$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      inRow = false;
      cols = null;
      continue;
    }
    if (!currentTable) continue;
    if (!inRow) {
      if (line === "        Row: {") {
        inRow = true;
        cols = new Set<string>();
      }
      continue;
    }
    if (line === "        }") {
      if (cols && cols.size > 0) out[currentTable] = cols;
      inRow = false;
      cols = null;
      continue;
    }
    const colMatch = line.match(/^ {10}([a-z_][a-z0-9_]*):/);
    if (colMatch && cols) cols.add(colMatch[1]);
  }
  for (const [table, extras] of Object.entries(EXTRA_COLUMNS)) {
    if (!out[table]) out[table] = new Set<string>();
    for (const c of extras) out[table].add(c);
  }
  tableRowColumnsCache = out;
  return out;
}

/**
 * Validate a PostgREST `.select(...)` column list against the live row
 * schema. Accepts comma-separated columns, with optional embedded
 * resource clauses like `foreign_table(col1, col2)` which are recursed
 * into using the foreign-table name as the table. Star (`*`) and PostgREST
 * aliases (`alias:col`) are accepted; JSON arrow operators (`col->>x`)
 * and count expressions are tolerated.
 *
 * Unknown columns throw `SchemaGuardError`. Unknown tables are ignored
 * (helper-only tables that don't exist in the real schema pass through).
 */
export function validateSelect(table: string, selectClause: string): void {
  const schema = loadTableRowColumns();
  const cols = schema[table];
  // Split the top-level select on commas, respecting parens depth so that
  // embedded `foreign(...)` clauses stay intact.
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of selectClause) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) parts.push(buf);

  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece || piece === "*") continue;
    // Embedded resource: `foreign[!hint](col1, col2)` or `alias:foreign(...)`
    const embed = piece.match(/^(?:[a-z_][a-z0-9_]*\s*:\s*)?([a-z_][a-z0-9_]*)(?:![a-z_][a-z0-9_]*)?\s*\((.*)\)$/);
    if (embed) {
      validateSelect(embed[1], embed[2]);
      continue;
    }
    // Strip alias prefix and JSON path / cast suffix.
    let name = piece.includes(":") ? piece.split(":").pop()!.trim() : piece;
    name = name.split(/->>?|::/)[0].trim();
    if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) continue;
    if (!cols) continue; // unknown table — pass through
    if (!cols.has(name)) {
      throw new SchemaGuardError(
        `[schemaGuard] select on '${table}' references unknown column '${name}'. ` +
          `Known columns: ${[...cols].sort().join(", ")}`,
      );
    }
  }
}

/**
 * Validate a single insert/update payload against the parsed schema.
 *
 * - Unknown columns throw `SchemaGuardError`.
 * - Enum-typed columns with a value outside the allowed set throw.
 * - Tables that are not in `Database["public"]["Tables"]` (e.g. ad-hoc
 *   tables the fake seeds for convenience) are passed through.
 */
export function validateWritePayload(
  table: string,
  payload: Record<string, unknown>,
): void {
  const schema = loadTableColumns();
  const cols = schema[table];
  if (!cols) return; // table not in schema — don't block
  for (const key of Object.keys(payload)) {
    if (!cols.has(key)) {
      throw new SchemaGuardError(
        `[schemaGuard] insert/update on '${table}' uses unknown column '${key}'. ` +
          `Known columns: ${[...cols].sort().join(", ")}`,
      );
    }
  }
  const enumCols = ENUM_COLUMNS[table];
  if (!enumCols) return;
  for (const [col, enumName] of Object.entries(enumCols)) {
    if (!(col in payload)) continue;
    const v = payload[col];
    if (v === undefined || v === null) continue;
    const allowed = ENUM_VALUES[enumName];
    if (!allowed) continue;
    if (!allowed.has(String(v))) {
      throw new SchemaGuardError(
        `[schemaGuard] invalid enum value '${String(v)}' for ${table}.${col} ` +
          `(enum ${enumName}). Allowed: ${[...allowed].sort().join(", ")}`,
      );
    }
  }
}

/**
 * Validate a possibly-batched insert payload.
 */
export function validateInsert(
  table: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
): void {
  const list = Array.isArray(payload) ? payload : [payload];
  for (const row of list) validateWritePayload(table, row);
}

/** Test-only: clear the parse cache (used by the self-test). */
export function _resetSchemaCacheForTests(): void {
  tableColumnsCache = null;
}
