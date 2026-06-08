/**
 * Lint-style regression guard for Task #223.
 *
 * `workqueue_items.source_object_type` is a Postgres ENUM
 * (public.source_object_type). Payment-domain logical labels —
 * `era_claim_payment`, `client_payment`, `insurance_manual_payment`,
 * `payment_recoupment`, `payment_refund` — are NOT members of that enum.
 *
 * Canonical shape (set in Task #140, sweep-fixed in #178 and #223):
 *   source_object_type = 'payment_posting'
 *   context_payload.logical_source_object_type = <logical label>
 *
 * Any code that uses one of the logical labels as the literal value of
 * `source_object_type` — whether on a `.eq("source_object_type", ...)`
 * filter or as the `source_object_type: ...` field of an insert payload
 * — will silently match/insert zero rows. This test scans the codebase
 * to keep that bug from sneaking back in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

const BAD_LABELS = [
  "era_claim_payment",
  "client_payment",
  "insurance_manual_payment",
  "payment_recoupment",
  "payment_refund",
] as const;

// Files allowed to mention the bad labels in proximity to
// `source_object_type` — comments referencing the historical bug,
// canonical mappers, the memory file, and this lint itself.
const ALLOWLIST = new Set<string>([
  "lib/payments/postingEngine/workqueueRules.ts",
  "lib/payments/postingEngine/index.ts",
  "lib/payments/postingEngine/reversal.ts",
  "lib/payments/postingEngine/__tests__/workqueueRules.test.ts",
  "lib/payments/postingEngine/__tests__/reversalEngine.test.ts",
  "lib/payments/postingEngine/__tests__/_schemaGuard.ts",
  "lib/payments/postingEngine/__tests__/_schemaGuard.test.ts",
  "lib/payments/__tests__/dryRunPreviewRoute.test.ts",
  "lib/payments/__tests__/workqueueEnumLeakLint.test.ts",
  "lib/workqueue/eraMismatchWorkqueueService.ts",
  "lib/workqueue/era835ExceptionWorkqueueService.ts",
]);

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib"].map((d) => path.join(ROOT, d));

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      await walk(p, out);
    } else if (e.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Detect the two real bug shapes:
 *   1. .eq("source_object_type", "<bad label>")
 *   2. source_object_type: "<bad label>"  (insert/update payload)
 *
 * Both checks are line-local and substring-based — good enough to catch
 * the regression and intentionally noisy enough that "I'll just inline
 * it differently" still trips a reviewer.
 */
function findBadLines(content: string): Array<{ line: number; text: string; label: string }> {
  const hits: Array<{ line: number; text: string; label: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const label of BAD_LABELS) {
      // .eq("source_object_type", "<label>") — read filter
      const eqRe = new RegExp(
        `\\.eq\\(\\s*["']source_object_type["']\\s*,\\s*["']${label}["']\\s*\\)`,
      );
      // source_object_type: "<label>"  — insert/update payload field
      const propRe = new RegExp(
        `source_object_type\\s*:\\s*["']${label}["']`,
      );
      if (eqRe.test(line) || propRe.test(line)) {
        hits.push({ line: i + 1, text: line.trim(), label });
      }
    }
  }
  return hits;
}

test(
  "no remaining workqueue queries/inserts use payment-domain logical labels as source_object_type",
  async () => {
    const allFiles: string[] = [];
    for (const dir of SCAN_DIRS) {
      try {
        await walk(dir, allFiles);
      } catch {
        // Skip missing scan dirs in unusual environments.
      }
    }

    const offenders: Array<{ file: string; line: number; text: string; label: string }> = [];
    for (const file of allFiles) {
      const rel = path.relative(ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      const content = await fs.readFile(file, "utf-8");
      const hits = findBadLines(content);
      for (const h of hits) offenders.push({ file: rel, ...h });
    }

    assert.equal(
      offenders.length,
      0,
      `Found ${offenders.length} workqueue source_object_type filter(s)/insert(s) using a ` +
        "payment-domain logical label. These silently fail the Postgres enum cast and " +
        "return zero rows. Use source_object_type='payment_posting' + " +
        "contains(context_payload, { logical_source_object_type: <label> }) instead.\n\n" +
        offenders
          .map((o) => `  ${o.file}:${o.line}  [${o.label}]  ${o.text}`)
          .join("\n"),
    );
  },
);
