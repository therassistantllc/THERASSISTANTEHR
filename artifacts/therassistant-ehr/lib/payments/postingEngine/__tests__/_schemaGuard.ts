/**
 * Schema-aware guard for the in-memory supabase fakes used by the posting
 * engine test suites (Task #179).
 *
 * Task #140 surfaced a class of bug where a workqueue insert used the wrong
 * column name (`patient_id`, `queue_type`) or an enum value that does not
 * exist in `public.source_object_type` (e.g. `payment_refund`). The fakes
 * accepted those writes silently, so the bug only manifested in production.
 *
 * This guard parses the generated `lib/supabase/database.types.ts` once at
 * load time to extract the column allowlist for each table's `Insert:` block,
 * and pulls runtime enum values from the file's exported `Constants` object.
 * Tests that wire `validateWritePayload` into their fake's insert/update path
 * will fail loudly when a payload uses an unknown column or an invalid enum
 * value — surfacing schema drift at test time instead of in prod.
 *
 * Tables outside the allowlist (e.g. helper-only test tables that don't exist
 * in the real schema) are passed through untouched so existing assertions
 * keep working.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Constants } from "../../../supabase/database.types";

const TYPES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/database.types.ts",
);

/** Runtime enum -> allowed string values, sourced from the generated types file. */
const ENUM_VALUES: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(Constants.public.Enums).map(
    ([name, vals]) => [name, new Set(vals as readonly string[])],
  ),
);

/**
 * Manually-maintained map of enum-typed columns we want to validate.
 *
 * Only payment-posting-engine tables need entries here; column-name
 * validation alone already catches the Task #140 regression family for
 * every other table. New enum-typed columns can be added as they surface.
 */
/**
 * Manually-maintained column overlay for tables whose `database.types.ts`
 * entry is stale relative to later migrations, or for tables missing from
 * the generated types entirely.
 *
 * Background: `database.types.ts` was last regenerated before migration
 * `20260524000000_payment_posting_reversal_refunds.sql`, which:
 *   - added reversed_at / reversal_reason / reversed_by_actor_id /
 *     voided_at / void_reason / voided_by_actor_id to
 *     era_claim_payments, client_payments, insurance_manual_payments;
 *   - created payment_refunds and payment_recoupments outright.
 *
 * Regenerating the types file requires a live DB connection that isn't
 * available here, so we hand-maintain the delta. Keep this list in sync
 * with new migrations until the types are regenerated.
 */
const EXTRA_COLUMNS: Record<string, string[]> = {
  era_claim_payments: [
    "reversed_at",
    "reversal_reason",
    "reversed_by_actor_id",
    "voided_at",
    "void_reason",
    "voided_by_actor_id",
  ],
  client_payments: [
    "posting_status",
    "stripe_charge_id",
    "stripe_payment_intent_id",
    "patient_invoice_id",
    "payer_profile_id",
    "reversed_at",
    "reversal_reason",
    "reversed_by_actor_id",
    "voided_at",
    "void_reason",
    "voided_by_actor_id",
  ],
  insurance_manual_payments: [
    "payer_profile_id",
    "check_number",
    "payment_date",
    "mailroom_item_id",
    "posted_actor_id",
    "posting_status",
    "reversed_at",
    "reversal_reason",
    "reversed_by_actor_id",
    "voided_at",
    "void_reason",
    "voided_by_actor_id",
  ],
  era_posting_ledger_entries: [
    "source_type",
    "source_id",
    "posted_at",
  ],
  client_credits: [
    "id",
    "organization_id",
    "client_id",
    "source_payment_id",
    "initial_amount",
    "applied_amount",
    "balance_amount",
    "note",
    "created_at",
    "updated_at",
    "archived_at",
  ],
  client_credit_applications: [
    "id",
    "organization_id",
    "client_credit_id",
    "patient_invoice_id",
    "professional_claim_id",
    "applied_amount",
    "applied_at",
    "applied_actor_id",
    "note",
    "created_at",
    "archived_at",
  ],
  payment_transfers: [
    "id",
    "organization_id",
    "client_id",
    "from_invoice_id",
    "from_claim_id",
    "to_invoice_id",
    "to_claim_id",
    "amount",
    "reason",
    "transferred_actor_id",
    "transferred_at",
    "created_at",
    "archived_at",
  ],
  payment_refunds: [
    "id",
    "organization_id",
    "refund_type",
    "source_era_claim_payment_id",
    "source_client_payment_id",
    "source_insurance_manual_payment_id",
    "client_id",
    "professional_claim_id",
    "payer_profile_id",
    "amount",
    "reason",
    "refund_status",
    "stripe_refund_id",
    "stripe_charge_id",
    "patient_invoice_id",
    "workqueue_item_id",
    "issued_at",
    "issued_by_actor_id",
    "requested_at",
    "requested_by_actor_id",
    "note",
    "created_at",
    "updated_at",
    "archived_at",
  ],
  payment_recoupments: [
    "id",
    "organization_id",
    "source_era_claim_payment_id",
    "source_client_payment_id",
    "offset_era_claim_payment_id",
    "professional_claim_id",
    "client_id",
    "payer_profile_id",
    "amount",
    "reason_code",
    "reason",
    "workqueue_item_id",
    "recouped_at",
    "recouped_by_actor_id",
    "created_at",
    "archived_at",
  ],
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
