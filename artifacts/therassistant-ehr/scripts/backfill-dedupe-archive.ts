#!/usr/bin/env node
/*
 * One-shot reconciliation for the partial unique indexes added in Task #184
 * (migration 20260601000000_find_or_create_dedupe_indexes.sql).
 *
 * Each of those `create unique index` statements will fail if duplicate live
 * rows already exist for the same business key (the very race the index is
 * meant to prevent could have already fired before the index ships). This
 * script sweeps each (table, business-key) pair, picks the oldest
 * `created_at` row as the winner, and archives the losers by stamping
 * `archived_at = now()` so the partial index (which is gated on
 * `archived_at is null`) can be created cleanly.
 *
 * Idempotent: a second run finds zero remaining duplicates because the
 * losers from the first run are no longer "live".
 *
 * Usage:
 *   tsx scripts/backfill-dedupe-archive.ts            # dry-run, reports only
 *   tsx scripts/backfill-dedupe-archive.ts --apply    # actually archive
 *
 * Run against staging first, verify the report, then run against prod
 * BEFORE deploying the migration.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)
 *
 * Exit codes:
 *   0 — completed (dry-run with or without duplicates, or apply succeeded)
 *   1 — one or more groups failed to archive
 *   2 — env/setup error
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type DedupeKey = string[];

interface DedupeTarget {
  table: string;
  keyColumns: DedupeKey;
  /** extra filter so we only consider rows the partial index covers. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraFilters?: (q: any) => any;
  /** human label for logs. */
  label: string;
}

const TARGETS: DedupeTarget[] = [
  {
    table: "professional_claims",
    keyColumns: ["organization_id", "encounter_id"],
    extraFilters: (q) => q.not("encounter_id", "is", null),
    label: "professional_claims (org, encounter_id)",
  },
  {
    table: "payment_postings",
    keyColumns: ["payment_import_item_id"],
    extraFilters: (q) => q.not("payment_import_item_id", "is", null),
    label: "payment_postings (payment_import_item_id)",
  },
  {
    table: "payment_import_batches",
    keyColumns: ["organization_id", "source_file_hash"],
    extraFilters: (q) => q.not("source_file_hash", "is", null),
    label: "payment_import_batches (org, source_file_hash)",
  },
  {
    table: "era_posting_ledger_entries",
    keyColumns: ["organization_id", "era_claim_payment_id", "entry_type"],
    label: "era_posting_ledger_entries (org, era_claim_payment_id, entry_type)",
  },
  {
    table: "patient_invoices",
    keyColumns: ["organization_id", "era_claim_payment_id"],
    extraFilters: (q) => q.not("era_claim_payment_id", "is", null),
    label: "patient_invoices (org, era_claim_payment_id)",
  },
];

interface Row {
  id: string;
  created_at: string;
  [k: string]: unknown;
}

interface TargetResult {
  label: string;
  groupsWithDuplicates: number;
  totalLosers: number;
  archivedLosers: number;
  errors: string[];
  /** sample of the first few duplicate groups for the operator log. */
  sampleGroups: Array<{ key: Record<string, unknown>; winnerId: string; loserIds: string[] }>;
}

function buildClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE in env",
    );
    process.exit(2);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchLiveRows(
  sb: SupabaseClient,
  target: DedupeTarget,
): Promise<Row[]> {
  // Page through; tables can be large.
  const PAGE = 1000;
  const cols = ["id", "created_at", ...target.keyColumns].join(", ");
  const all: Row[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = sb
      .from(target.table)
      .select(cols)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (target.extraFilters) q = target.extraFilters(q);
    const { data, error } = await q;
    if (error) {
      throw new Error(`fetch ${target.table} failed: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as Row[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function groupDuplicates(
  rows: Row[],
  keyColumns: DedupeKey,
): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    // Skip rows missing any key column — partial index ignores them too.
    if (keyColumns.some((c) => r[c] === null || r[c] === undefined)) continue;
    const k = keyColumns.map((c) => String(r[c])).join("\u0001");
    const bucket = groups.get(k);
    if (bucket) bucket.push(r);
    else groups.set(k, [r]);
  }
  // Keep only buckets with >1 row.
  for (const [k, v] of groups) {
    if (v.length < 2) groups.delete(k);
  }
  return groups;
}

async function archiveLosers(
  sb: SupabaseClient,
  table: string,
  loserIds: string[],
): Promise<void> {
  if (loserIds.length === 0) return;
  const stamped = new Date().toISOString();
  // Chunk to keep the URL/payload small.
  const CHUNK = 100;
  for (let i = 0; i < loserIds.length; i += CHUNK) {
    const chunk = loserIds.slice(i, i + CHUNK);
    const { error } = await sb
      .from(table)
      .update({ archived_at: stamped })
      .in("id", chunk)
      .is("archived_at", null); // belt-and-braces: don't clobber a row already archived
    if (error) {
      throw new Error(
        `archive ${table} chunk starting at ${i} failed: ${error.message}`,
      );
    }
  }
}

async function processTarget(
  sb: SupabaseClient,
  target: DedupeTarget,
  apply: boolean,
): Promise<TargetResult> {
  const result: TargetResult = {
    label: target.label,
    groupsWithDuplicates: 0,
    totalLosers: 0,
    archivedLosers: 0,
    errors: [],
    sampleGroups: [],
  };
  let rows: Row[];
  try {
    rows = await fetchLiveRows(sb, target);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
  const groups = groupDuplicates(rows, target.keyColumns);
  result.groupsWithDuplicates = groups.size;

  for (const [, bucket] of groups) {
    // Rows already ordered by created_at asc, id asc → first is the winner.
    const [winner, ...losers] = bucket;
    result.totalLosers += losers.length;
    if (result.sampleGroups.length < 5) {
      const keyObj: Record<string, unknown> = {};
      for (const c of target.keyColumns) keyObj[c] = winner[c];
      result.sampleGroups.push({
        key: keyObj,
        winnerId: winner.id,
        loserIds: losers.map((l) => l.id),
      });
    }
    if (apply) {
      try {
        await archiveLosers(
          sb,
          target.table,
          losers.map((l) => l.id),
        );
        result.archivedLosers += losers.length;
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  return result;
}

function printReport(results: TargetResult[], apply: boolean): void {
  console.log("");
  console.log(`=== Dedupe ${apply ? "APPLY" : "DRY-RUN"} report ===`);
  for (const r of results) {
    console.log("");
    console.log(`- ${r.label}`);
    console.log(`    duplicate groups: ${r.groupsWithDuplicates}`);
    console.log(`    loser rows:       ${r.totalLosers}`);
    if (apply) console.log(`    archived:         ${r.archivedLosers}`);
    if (r.sampleGroups.length > 0) {
      console.log(`    sample groups (up to 5):`);
      for (const g of r.sampleGroups) {
        console.log(
          `      key=${JSON.stringify(g.key)} winner=${g.winnerId} losers=${JSON.stringify(g.loserIds)}`,
        );
      }
    }
    for (const e of r.errors) console.log(`    ERROR: ${e}`);
  }
  console.log("");
}

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const sb = buildClient();
  console.log(
    `[${new Date().toISOString()}] Task #184 dedupe sweep starting (${apply ? "APPLY" : "DRY-RUN"})`,
  );
  const results: TargetResult[] = [];
  for (const target of TARGETS) {
    console.log(`  scanning ${target.label} …`);
    results.push(await processTarget(sb, target, apply));
  }
  printReport(results, apply);
  const anyErrors = results.some((r) => r.errors.length > 0);
  return anyErrors ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
