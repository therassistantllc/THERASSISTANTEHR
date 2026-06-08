/**
 * /api/billing/fee-schedules/extract
 *
 * Accepts a payer-contract fee schedule as a PDF upload (multipart
 * `file` field) and returns the extracted CPT + allowed-amount rows so the
 * admin can preview/edit them in the bulk-import grid before committing to
 * `fee_schedules`.
 *
 * Heuristics (intentionally lenient — contracts vary wildly):
 *  - CPT/HCPCS pattern: 5 digits, or one letter followed by 4 digits.
 *  - Allowed amount: the right-most money value on the same row/line. If
 *    a row has multiple money values, the last one is treated as `allowed`
 *    and the first as `billed_rate` (a common "billed → allowed" layout).
 *  - Modifiers: 2-char alpha or numeric tokens right after the CPT
 *    (e.g. "90837 95 HJ"). Captured opportunistically; admins can fix in
 *    the preview grid.
 */
import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export interface ExtractedRow {
  procedureCode: string;
  modifiers: string[];
  placeOfService: string | null;
  allowedAmount: number;
  billedRate: number | null;
  notes: string | null;
}

const CPT_RE = /\b([A-Z][0-9]{4}|[0-9]{5})\b/;
const MONEY_RE = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
const MOD_RE = /^(?:[A-Z]{2}|[0-9]{2})$/;
const POS_RE = /^(?:0[1-9]|[1-9][0-9])$/;

function toMoney(raw: string): number | null {
  const n = Number(raw.replace(/[,$\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function parseLine(line: string): ExtractedRow | null {
  const cptMatch = line.match(CPT_RE);
  if (!cptMatch) return null;
  const cpt = cptMatch[1].toUpperCase();
  // Strip the CPT itself so we don't re-read it as money.
  const afterCpt = line.slice((cptMatch.index ?? 0) + cpt.length);

  // Collect monetary tokens. Require at least one decimal or comma so we
  // don't pick up bare integers like "11" (POS) or "60" (units/minutes).
  const moneys: number[] = [];
  let m: RegExpExecArray | null;
  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(line)) !== null) {
    const raw = m[1];
    if (!raw.includes(".") && !raw.includes(",")) continue;
    const n = toMoney(raw);
    if (n != null && n > 0 && n < 100000) moneys.push(n);
  }
  if (moneys.length === 0) return null;

  const allowed = moneys[moneys.length - 1];
  const billed = moneys.length > 1 ? moneys[0] : null;

  // Modifiers / POS — look at the immediate tokens after the CPT, before
  // we hit the first money value.
  const tokens = afterCpt
    .split(/[\s|,/]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  const modifiers: string[] = [];
  let placeOfService: string | null = null;
  for (const tok of tokens) {
    if (/\$|\./.test(tok)) break;
    if (MOD_RE.test(tok)) {
      if (placeOfService == null && POS_RE.test(tok) && modifiers.length === 0) {
        // Numeric two-digit right after CPT is more often a modifier than POS;
        // leave as modifier — admin can move to POS in the preview grid.
      }
      if (modifiers.length < 4) modifiers.push(tok);
    }
  }

  return {
    procedureCode: cpt,
    modifiers,
    placeOfService,
    allowedAmount: allowed,
    billedRate: billed,
    notes: null,
  };
}

function dedupe(rows: ExtractedRow[]): ExtractedRow[] {
  const seen = new Map<string, ExtractedRow>();
  for (const r of rows) {
    const key = `${r.procedureCode}|${r.modifiers.join(",")}|${r.placeOfService ?? ""}|${r.allowedAmount}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.procedureCode.localeCompare(b.procedureCode),
  );
}

async function extractFromPdf(buf: Buffer): Promise<ExtractedRow[]> {
  // pdf-parse v2 — dynamic import so the Next.js bundler doesn't try to
  // statically resolve the worker.
  const mod = (await import("pdf-parse")) as any;
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? mod.default;
  if (!PDFParse) throw new Error("pdf-parse module unavailable");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  const text = String(result?.text ?? "");
  const rows: ExtractedRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parseLine(line);
    if (parsed) rows.push(parsed);
  }
  return dedupe(rows);
}

export async function POST(request: Request) {
  try {
    const guard = await requireBillingAccess({
      requestedOrganizationId:
        new URL(request.url).searchParams.get("organizationId") ?? null,
    });
    if (guard instanceof NextResponse) return guard;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: "Upload must be multipart/form-data" },
        { status: 400 },
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No `file` field in upload" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: `File too large (max ${MAX_BYTES} bytes)` },
        { status: 413 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();

    let rows: ExtractedRow[] = [];
    let kind: "pdf" | "unknown" = "unknown";
    if (name.endsWith(".pdf") || type === "application/pdf") {
      kind = "pdf";
      rows = await extractFromPdf(buf);
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported file. Upload a PDF file.",
        },
        { status: 415 },
      );
    }

    return NextResponse.json({
      success: true,
      kind,
      filename: file.name,
      rows,
      count: rows.length,
    });
  } catch (e) {
    console.error("Fee schedule extract error:", e);
    return NextResponse.json(
      {
        success: false,
        error: "Extraction failed",
      },
      { status: 500 },
    );
  }
}
