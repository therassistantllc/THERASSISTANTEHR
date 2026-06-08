#!/usr/bin/env node
/*
 * Scheduled monthly billing-code refresh.
 *
 * Wraps `import-billing-codes.ts` with:
 *   - Best-effort downloads of the public CMS files (ICD-10-CM + HCPCS L2).
 *     CPT is AMA-licensed and is never auto-fetched here.
 *   - A structured per-system outcome (parsed row count + optional error).
 *   - An alert path (Resend email + workqueue item) that fires when:
 *       * any system errored (download, parse, or upsert), OR
 *       * any system returned 0 rows and a new release was already overdue
 *         (ICD-10-CM by Oct 15, HCPCS by the 15th of Jan/Apr/Jul/Oct).
 *
 * Intended invocation (monthly cron):
 *   tsx scripts/refresh-billing-codes.ts
 *
 * Override download URLs via env if CMS reshuffles them:
 *   ICD10_DOWNLOAD_URL   — direct URL to the icd10cm-codes-YYYY.txt file
 *   HCPCS_DOWNLOAD_URL   — direct URL to the HCPC<YYYY>_ANWEB CSV
 *
 * Alert delivery requires:
 *   RESEND_API_KEY                       — Resend secret
 *   BILLING_CODES_REFRESH_ALERT_EMAIL    — comma-separated ops recipients
 *   NEXT_PUBLIC_SUPABASE_URL + service-role key (for workqueue insert)
 *
 * Exit codes:
 *   0  — refresh succeeded and no alert was warranted.
 *   1  — an alert was warranted (the cron should surface this to operators).
 *   2  — alert was warranted but BOTH alert channels failed (most urgent;
 *        operators must check this script's logs directly).
 */

import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseIcd10, parseHcpcs } from "./import-billing-codes";
import {
  evaluateRefreshOutcome,
  type CodeSystem,
  type PerSystemResult,
} from "../lib/billingCodes/refreshAlertLogic";
import { dispatchRefreshAlert } from "../lib/billingCodes/refreshAlert";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ICD10_URL = (() => {
  const y = new Date().getUTCFullYear();
  return (
    process.env.ICD10_DOWNLOAD_URL ||
    `https://www.cms.gov/files/zip/icd-10-cm-${y}-code-descriptions.zip`
  );
})();

const DEFAULT_HCPCS_URL = (() => {
  const y = new Date().getUTCFullYear();
  return (
    process.env.HCPCS_DOWNLOAD_URL ||
    `https://www.cms.gov/files/zip/${y}-alpha-numeric-hcpcs-file.zip`
  );
})();

async function download(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download ${url} failed: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  // Sanity check: a 0-byte file would silently parse to 0 rows and look like
  // "CMS dropped no file" — treat empty payloads as an error instead.
  const stat = statSync(destPath);
  if (stat.size === 0) {
    throw new Error(`download ${url} produced an empty file`);
  }
}

async function upsertRows(
  table: "diagnosis_codes" | "procedure_codes",
  rows: Array<{ code: string; code_system: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or service-role key");
  }
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const batch = 500;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const { error } = await sb.from(table).upsert(chunk, { onConflict: "code,code_system" });
    if (error) throw new Error(`upsert ${table} failed at row ${i}: ${error.message}`);
  }
}

async function runIcd10(workDir: string): Promise<PerSystemResult> {
  const codeSystem: CodeSystem = "ICD-10-CM";
  try {
    const target = join(workDir, "icd10.txt");
    await download(DEFAULT_ICD10_URL, target);
    const rows = parseIcd10(target);
    await upsertRows("diagnosis_codes", rows);
    return { codeSystem, parsedRows: rows.length, loadedReleaseLabel: String(new Date().getUTCFullYear()) };
  } catch (err) {
    return { codeSystem, parsedRows: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runHcpcs(workDir: string): Promise<PerSystemResult> {
  const codeSystem: CodeSystem = "HCPCS";
  try {
    const target = join(workDir, "hcpcs.csv");
    await download(DEFAULT_HCPCS_URL, target);
    const rows = parseHcpcs(target);
    await upsertRows("procedure_codes", rows);
    return { codeSystem, parsedRows: rows.length, loadedReleaseLabel: String(new Date().getUTCFullYear()) };
  } catch (err) {
    return { codeSystem, parsedRows: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<number> {
  const runStartedAt = new Date();
  const workDir = mkdtempSync(join(tmpdir(), "billing-codes-refresh-"));

  console.log(`[${runStartedAt.toISOString()}] scheduled billing-code refresh starting`);
  console.log(`  ICD-10 URL: ${DEFAULT_ICD10_URL}`);
  console.log(`  HCPCS URL:  ${DEFAULT_HCPCS_URL}`);

  const results: PerSystemResult[] = [];
  results.push(await runIcd10(workDir));
  results.push(await runHcpcs(workDir));

  const runFinishedAt = new Date();
  for (const r of results) {
    if (r.error) {
      console.error(`  [FAIL] ${r.codeSystem}: ${r.error}`);
    } else {
      console.log(`  [OK]   ${r.codeSystem}: ${r.parsedRows} rows`);
    }
  }

  const { shouldAlert, reasons } = evaluateRefreshOutcome({ now: runFinishedAt, results });
  if (!shouldAlert) {
    console.log(`[${runFinishedAt.toISOString()}] refresh OK, no alert`);
    return 0;
  }

  console.error(`[${runFinishedAt.toISOString()}] ALERT: ${reasons.length} reason(s)`);
  for (const r of reasons) {
    console.error(`  - ${JSON.stringify(r)}`);
  }

  const outcome = await dispatchRefreshAlert({
    reasons,
    results,
    runStartedAt,
    runFinishedAt,
  });
  console.error(
    `  email: ${outcome.emailed.ok ? `sent to ${outcome.emailed.recipients.join(", ")}` : `FAILED (${outcome.emailed.error})`}`,
  );
  console.error(
    `  workqueue: ${outcome.workqueue.ok ? `created ${outcome.workqueue.created} item(s)` : `FAILED (${outcome.workqueue.error})`}`,
  );

  if (!outcome.emailed.ok && !outcome.workqueue.ok) {
    console.error(
      "BOTH alert channels failed. Operators must investigate this script's logs directly.",
    );
    return 2;
  }
  return 1;
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e instanceof Error ? e.stack || e.message : e);
      process.exit(2);
    });
}
