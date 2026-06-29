/**
 * Schema-aware guard for in-memory Supabase fakes.
 *
 * The live THERASSISTANT EHR schema was cleaned up to the tenant/session/claims
 * model. This guard must not keep stale overlays for deleted tables because that
 * masks production drift in tests. Unknown helper-only tables still pass through,
 * but known table columns are validated when they can be parsed from generated
 * types or the checked-in schema dump.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Constants } from "../database.types";

const TYPES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../database.types.ts",
);

const SCHEMA_SQL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../schema.sql",
);

/** Runtime enum -> allowed string values, sourced from the generated types file. */
const ENUM_VALUES: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(Constants.public.Enums).map(([name, vals]) => [
    name,
    new Set(vals as readonly string[]),
  ]),
);

/**
 * Temporary enum overlay for production enum values that are ahead of generated
 * types. Keep this empty unless a migration exists and the generated types are
 * being regenerated separately.
 */
const EXTRA_ENUM_VALUES: Record<string, string[]> = {};
for (const [name, extras] of Object.entries(EXTRA_ENUM_VALUES)) {
  if (!ENUM_VALUES[name]) ENUM_VALUES[name] = new Set<string>();
  for (const v of extras) ENUM_VALUES[name].add(v);
}

/**
 * Temporary column overlay for generated-type lag only.
 *
 * Do not add deleted legacy tables here. The old cleanup-era tables
 * `encounters`, `encounter_clinical_notes`, `professional_claims`,
 * `claim_lines`, `era_import_batches`, and `era_claim_payments` are deliberately
 * absent from the overlay so tests do not accept writes to tables that no longer
 * exist in the live Supabase schema.
 */
const EXTRA_COLUMNS: Record<string, string[]> = {};

function loadSchemaSqlColumns(): Record<string, Set<string>> {
  let src = "";
  try {
    src = readFileSync(SCHEMA_SQL_PATH, "utf-8");
  } catch {
    return {};
  }

  const out: Record<string, Set<string>> = {};
  const tableRe =
    /CREATE TABLE IF NOT EXISTS "public"\."([a-z_][a-z0-9_]*)" \(\n([\s\S]*?)\n\);/g;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(src)) !== null) {
    const [, table, body] = match;
    const cols = new Set<string>();
    for (const line of body.split("\n")) {
      const col = line.match(/^\s+"([a-z_][a-z0-9_]*)"\s+/);
      if (col) cols.add(col[1]);
    }
    if (cols.size > 0) out[table] = cols;
  }
  return out;
}

const ENUM_COLUMNS: Record<string, Record<string, string>> = {
  workqueue_items: {
    source_object_type: "source_object_type",
    status: "workqueue_status",
    priority: "workqueue_priority",
  },
  appointments: { appointment_status: "appointment_status" },
  sessions: { session_status: "session_status" },
  session_notes: { note_status: "note_status" },
  insurance_manual_payments: { posting_status: "payment_posting_status" },
  client_payments: { posting_status: "payment_posting_status" },
};

let tableColumnsCache: Record<string, Set<string>> | null = null;
let tableRowColumnsCache: Record<string, Set<string>> | null = null;

function mergeExtraColumns(out: Record<string, Set<string>>): void {
  for (const [table, extras] of Object.entries(EXTRA_COLUMNS)) {
    if (!out[table]) out[table] = new Set<string>();
    for (const c of extras) out[table].add(c);
  }
}

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

  for (const [table, sqlCols] of Object.entries(loadSchemaSqlColumns())) {
    if (!out[table]) out[table] = new Set<string>();
    for (const c of sqlCols) out[table].add(c);
  }
  mergeExtraColumns(out);
  tableColumnsCache = out;
  return out;
}

export class SchemaGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaGuardError";
  }
}

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

  for (const [table, sqlCols] of Object.entries(loadSchemaSqlColumns())) {
    if (!out[table]) out[table] = new Set<string>();
    for (const c of sqlCols) out[table].add(c);
  }
  mergeExtraColumns(out);
  tableRowColumnsCache = out;
  return out;
}

export function validateSelect(table: string, selectClause: string): void {
  const schema = loadTableRowColumns();
  const cols = schema[table];
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
    const embed = piece.match(
      /^(?:[a-z_][a-z0-9_]*\s*:\s*)?([a-z_][a-z0-9_]*)(?:![a-z_][a-z0-9_]*)?\s*\((.*)\)$/,
    );
    if (embed) {
      validateSelect(embed[1], embed[2]);
      continue;
    }
    let name = piece.includes(":") ? piece.split(":").pop()!.trim() : piece;
    name = name.split(/->>?|::/)[0].trim();
    if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) continue;
    if (!cols) continue;
    if (!cols.has(name)) {
      throw new SchemaGuardError(
        `[schemaGuard] select on '${table}' references unknown column '${name}'. ` +
          `Known columns: ${[...cols].sort().join(", ")}`,
      );
    }
  }
}

export function validateWritePayload(
  table: string,
  payload: Record<string, unknown>,
): void {
  const schema = loadTableColumns();
  const cols = schema[table];
  if (!cols) return;
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

export function validateInsert(
  table: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
): void {
  const list = Array.isArray(payload) ? payload : [payload];
  for (const row of list) validateWritePayload(table, row);
}

/** Test-only: clear the parse cache used by schema guard self-tests. */
export function _resetSchemaCacheForTests(): void {
  tableColumnsCache = null;
  tableRowColumnsCache = null;
}
