#!/usr/bin/env node
/*
 * Import full national ICD-10-CM, CPT, and HCPCS Level II code sets into the
 * `diagnosis_codes` and `procedure_codes` reference tables.
 *
 * The script is idempotent — it upserts on (code, code_system) so it can be
 * re-run for yearly updates without producing duplicates or wiping unrelated
 * rows. Effective and expiration dates from the source files are honored.
 *
 * Source files (you must download them; CPT is AMA-licensed and cannot be
 * auto-fetched, ICD-10-CM and HCPCS are public CMS releases):
 *
 *   ICD-10-CM master file
 *     CMS "icd10cm-codes-YYYY.txt" (one row per code, tab/space separated:
 *       <code><whitespace><long description>)
 *     or "icd10cm-order-YYYY.txt" (fixed-width with short + long descriptions).
 *     Download: https://www.cms.gov/medicare/coding-billing/icd-10-codes
 *
 *   HCPCS Level II quarterly release
 *     CMS "HCPC<YEAR>_ANWEB" CSV/TSV with at least the columns:
 *       HCPC, LONG DESCRIPTION, SHORT DESCRIPTION,
 *       ACT EFF DATE (YYYYMMDD), TERM DATE (YYYYMMDD optional).
 *     Download: https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update
 *
 *   CPT (AMA-licensed)
 *     CSV with header row containing at least: code,description and optionally
 *       short_description, effective_date (YYYY-MM-DD), expiration_date.
 *     Must be obtained from an AMA license; this importer accepts the file but
 *       does not redistribute the codes.
 *
 * Usage:
 *   tsx scripts/import-billing-codes.ts \
 *     --icd10 path/to/icd10cm-codes-2026.txt \
 *     --hcpcs path/to/HCPC2026_ANWEB.csv \
 *     --cpt   path/to/cpt-2026.csv \
 *     [--dry-run] [--batch 500]
 *
 * Any subset of the three flags may be supplied; omitted code systems are
 * skipped. Requires NEXT_PUBLIC_SUPABASE_URL and a service-role key
 * (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE) in the environment.
 */

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";

type CliArgs = {
  icd10?: string;
  hcpcs?: string;
  cpt?: string;
  batch: number;
  dryRun: boolean;
};

type DiagnosisRow = {
  code: string;
  code_system: "ICD-10-CM";
  description: string;
  description_short: string | null;
  is_active: boolean;
  effective_date: string | null;
  expiration_date: string | null;
};

type ProcedureRow = {
  code: string;
  code_system: "CPT" | "HCPCS";
  description: string;
  description_short: string | null;
  is_active: boolean;
  effective_date: string | null;
  expiration_date: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { batch: 500, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--icd10": out.icd10 = next(); break;
      case "--hcpcs": out.hcpcs = next(); break;
      case "--cpt": out.cpt = next(); break;
      case "--batch": out.batch = Math.max(50, Number(next()) || 500); break;
      case "--dry-run": out.dryRun = true; break;
      case "-h":
      case "--help":
        console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 50).join("\n"));
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

/** Insert a dot after the 3rd char per CMS convention (A001 -> A00.1). */
export function dotIcd10(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (s.length <= 3 || s.includes(".")) return s;
  return `${s.slice(0, 3)}.${s.slice(3)}`;
}

/** CMS dates come as YYYYMMDD; normalize to YYYY-MM-DD or null. */
function cmsDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "00000000") return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/**
 * Parse ICD-10-CM. Supports two CMS formats:
 *  1) "icd10cm-codes-YYYY.txt" — `<code> <long description>` per line.
 *  2) "icd10cm-order-YYYY.txt" — fixed width:
 *       cols  1-5  order number
 *       cols  7-13 code (7 chars, no dot)
 *       col   15   header flag (0 = billable, 1 = header-only)
 *       cols 17-76 short description
 *       cols 78+   long description
 */
export function parseIcd10(path: string): DiagnosisRow[] {
  const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim().length);
  const rows: DiagnosisRow[] = [];
  const isOrderFile =
    /icd10cm[-_]order/i.test(path) ||
    lines.some((l) => l.length > 78 && /^\d{5}\s+[A-Z]/.test(l));

  for (const line of lines) {
    let code = "";
    let shortDesc: string | null = null;
    let longDesc = "";
    let isActive = true;

    if (isOrderFile) {
      // Fixed-width order file
      const codeRaw = line.slice(6, 13).trim();
      if (!codeRaw) continue;
      const headerFlag = line.slice(14, 15).trim();
      shortDesc = line.slice(16, 76).trim() || null;
      longDesc = line.slice(77).trim();
      code = dotIcd10(codeRaw);
      // Header-only (non-billable) parents are kept so search can resolve them,
      // but marked inactive so they don't pass save-time validation.
      isActive = headerFlag !== "1";
    } else {
      // "icd10cm-codes-YYYY.txt" — first token = code, rest = description.
      const m = line.match(/^(\S+)\s+(.+)$/);
      if (!m) continue;
      code = dotIcd10(m[1]);
      longDesc = m[2].trim();
    }
    if (!code || !longDesc) continue;
    rows.push({
      code,
      code_system: "ICD-10-CM",
      description: longDesc,
      description_short: shortDesc,
      is_active: isActive,
      effective_date: null,
      expiration_date: null,
    });
  }
  return rows;
}

/** Split a CSV/TSV line, respecting double-quoted fields. */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseDelimitedFile(path: string): { headers: string[]; rows: string[][] } {
  const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const delim = extname(path).toLowerCase() === ".tsv" || raw.split("\n", 1)[0].includes("\t") ? "\t" : ",";
  const lines = raw.split("\n").filter((l) => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitDelimited(lines[0], delim).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((l) => splitDelimited(l, delim));
  return { headers, rows };
}

function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.findIndex((h) => h === c || h.replace(/[\s_-]/g, "") === c.replace(/[\s_-]/g, ""));
    if (i >= 0) return i;
  }
  return -1;
}

/** Parse CMS HCPCS Level II CSV/TSV ("HCPC<YYYY>_ANWEB" or equivalent). */
export function parseHcpcs(path: string): ProcedureRow[] {
  const { headers, rows } = parseDelimitedFile(path);
  if (!headers.length) return [];

  const cCode = findCol(headers, ["hcpc", "hcpcs", "code", "hcpcs code"]);
  const cLong = findCol(headers, ["long description", "longdescription", "long_desc", "description"]);
  const cShort = findCol(headers, ["short description", "shortdescription", "short_desc"]);
  const cEff = findCol(headers, ["act eff date", "acteffdate", "effective date", "effective_date", "add date"]);
  const cTerm = findCol(headers, ["term date", "termdate", "expiration date", "expiration_date"]);

  if (cCode < 0 || cLong < 0) {
    throw new Error(
      `HCPCS file is missing required columns (code + long description). Headers seen: ${headers.join(", ")}`,
    );
  }

  const out: ProcedureRow[] = [];
  for (const r of rows) {
    const code = (r[cCode] ?? "").trim().toUpperCase();
    const longDesc = (r[cLong] ?? "").trim();
    if (!code || !longDesc) continue;
    const termDate = cTerm >= 0 ? cmsDate(r[cTerm]) : null;
    out.push({
      code,
      code_system: "HCPCS",
      description: longDesc,
      description_short: cShort >= 0 ? (r[cShort] ?? "").trim() || null : null,
      is_active: !termDate || new Date(termDate) >= new Date(),
      effective_date: cEff >= 0 ? cmsDate(r[cEff]) : null,
      expiration_date: termDate,
    });
  }
  return out;
}

/** Parse a CPT CSV provided under AMA license. Required columns: code, description. */
export function parseCpt(path: string): ProcedureRow[] {
  const { headers, rows } = parseDelimitedFile(path);
  if (!headers.length) return [];

  const cCode = findCol(headers, ["code", "cpt", "cpt code"]);
  const cLong = findCol(headers, ["description", "long description", "long_desc"]);
  const cShort = findCol(headers, ["short description", "short_desc", "shortdescription"]);
  const cEff = findCol(headers, ["effective date", "effective_date", "act eff date"]);
  const cTerm = findCol(headers, ["expiration date", "expiration_date", "term date"]);

  if (cCode < 0 || cLong < 0) {
    throw new Error(
      `CPT file is missing required columns (code + description). Headers seen: ${headers.join(", ")}`,
    );
  }

  const out: ProcedureRow[] = [];
  for (const r of rows) {
    const code = (r[cCode] ?? "").trim().toUpperCase();
    const longDesc = (r[cLong] ?? "").trim();
    if (!code || !longDesc) continue;
    const termDate = cTerm >= 0 ? cmsDate(r[cTerm]) : null;
    out.push({
      code,
      code_system: "CPT",
      description: longDesc,
      description_short: cShort >= 0 ? (r[cShort] ?? "").trim() || null : null,
      is_active: !termDate || new Date(termDate) >= new Date(),
      effective_date: cEff >= 0 ? cmsDate(r[cEff]) : null,
      expiration_date: termDate,
    });
  }
  return out;
}

async function upsertBatched<T extends { code: string; code_system: string }>(
  table: "diagnosis_codes" | "procedure_codes",
  rows: T[],
  batch: number,
  dryRun: boolean,
): Promise<{ inserted: number }> {
  if (dryRun || rows.length === 0) return { inserted: rows.length };

  // Stamp `updated_at` on every row so the in-app code-set freshness
  // panel (Task #197) reflects when this refresh ran. The DB trigger
  // also touches `updated_at` on UPDATE, but setting it explicitly
  // here also covers fresh INSERTs and keeps the column consistent.
  const stampedAt = new Date().toISOString();
  rows = rows.map((r) => ({ ...r, updated_at: stampedAt })) as T[];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE) in env.",
    );
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let total = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const { error } = await sb.from(table).upsert(chunk, { onConflict: "code,code_system" });
    if (error) throw new Error(`Upsert into ${table} failed at row ${i}: ${error.message}`);
    total += chunk.length;
    process.stdout.write(`  ${table}: ${total}/${rows.length}\r`);
  }
  process.stdout.write("\n");
  return { inserted: total };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.icd10 && !args.hcpcs && !args.cpt) {
    console.error("Nothing to import. Pass at least one of --icd10, --hcpcs, --cpt.");
    process.exit(2);
  }

  if (args.icd10) {
    statSync(args.icd10);
    console.log(`Parsing ICD-10-CM from ${args.icd10}…`);
    const rows = parseIcd10(args.icd10);
    console.log(`  Parsed ${rows.length} ICD-10-CM rows.`);
    const { inserted } = await upsertBatched("diagnosis_codes", rows, args.batch, args.dryRun);
    console.log(`  ${args.dryRun ? "Would upsert" : "Upserted"} ${inserted} into diagnosis_codes.`);
  }
  if (args.hcpcs) {
    statSync(args.hcpcs);
    console.log(`Parsing HCPCS from ${args.hcpcs}…`);
    const rows = parseHcpcs(args.hcpcs);
    console.log(`  Parsed ${rows.length} HCPCS rows.`);
    const { inserted } = await upsertBatched("procedure_codes", rows, args.batch, args.dryRun);
    console.log(`  ${args.dryRun ? "Would upsert" : "Upserted"} ${inserted} into procedure_codes (HCPCS).`);
  }
  if (args.cpt) {
    statSync(args.cpt);
    console.log(`Parsing CPT from ${args.cpt}…`);
    const rows = parseCpt(args.cpt);
    console.log(`  Parsed ${rows.length} CPT rows.`);
    const { inserted } = await upsertBatched("procedure_codes", rows, args.batch, args.dryRun);
    console.log(`  ${args.dryRun ? "Would upsert" : "Upserted"} ${inserted} into procedure_codes (CPT).`);
  }

  console.log("Done.");
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
