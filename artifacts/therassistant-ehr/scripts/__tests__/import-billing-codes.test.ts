import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseIcd10, parseHcpcs, parseCpt, dotIcd10 } from "../import-billing-codes";

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "codes-"));
  const p = join(dir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

test("dotIcd10 inserts the dot after the 3rd character", () => {
  assert.equal(dotIcd10("F432"), "F43.2");
  assert.equal(dotIcd10("F43.2"), "F43.2"); // already dotted
  assert.equal(dotIcd10("a000"), "A00.0");
  assert.equal(dotIcd10("F90"), "F90"); // 3-char headers stay as-is
});

test("parseIcd10 handles simple 'icd10cm-codes' format", () => {
  const path = tmpFile(
    "icd10cm-codes-2026.txt",
    [
      "F320    Major depressive disorder, single episode, mild",
      "F329    Major depressive disorder, single episode, unspecified",
      "F411    Generalized anxiety disorder",
      "",
    ].join("\n"),
  );
  const rows = parseIcd10(path);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    code: "F32.0",
    code_system: "ICD-10-CM",
    description: "Major depressive disorder, single episode, mild",
    description_short: null,
    is_active: true,
    effective_date: null,
    expiration_date: null,
  });
  assert.equal(rows[2].code, "F41.1");
});

test("parseIcd10 handles fixed-width 'icd10cm-order' format and header flags", () => {
  // CMS column layout (1-indexed): order 1-5, code 7-13 (7 chars), header 15,
  // short 17-76 (60 chars), long 78+.
  const pad = (s: string, n: number) => s.padEnd(n, " ");
  const mkRow = (order: string, code: string, header: "0" | "1", short: string, long: string) =>
    `${pad(order, 5)} ${pad(code, 7)} ${header} ${pad(short, 60)} ${long}`;
  const billable = mkRow(
    "00001",
    "A000",
    "0",
    "Cholera due to V cholerae 01, biovar cholerae",
    "Cholera due to Vibrio cholerae 01, biovar cholerae",
  );
  const header = mkRow("00050", "A00", "1", "Cholera", "Cholera");
  const path = tmpFile("icd10cm-order-2026.txt", `${billable}\n${header}\n`);
  const rows = parseIcd10(path);
  assert.equal(rows.length, 2);
  const billableRow = rows.find((r) => r.code === "A00.0");
  const headerRow = rows.find((r) => r.code === "A00");
  assert.ok(billableRow, "billable row parsed");
  assert.ok(headerRow, "header row parsed");
  assert.equal(billableRow!.is_active, true);
  assert.equal(headerRow!.is_active, false, "header-only codes are flagged inactive");
  assert.match(billableRow!.description, /Cholera due to Vibrio cholerae/);
  assert.equal(billableRow!.description_short?.startsWith("Cholera due to"), true);
});

test("parseHcpcs parses CSV with CMS column names and honors term dates", () => {
  const csv = [
    "HCPC,SHORT DESCRIPTION,LONG DESCRIPTION,ACT EFF DATE,TERM DATE",
    'H0001,"Alcohol/drug assessment","Alcohol and/or drug assessment",20200101,',
    'J9999,"Old code","Discontinued procedure",20100101,20180630',
    'H2011,"Crisis intv 15 min","Crisis intervention service, per 15 minutes",20150101,',
  ].join("\n");
  const path = tmpFile("HCPC2026_ANWEB.csv", csv);
  const rows = parseHcpcs(path);
  assert.equal(rows.length, 3);
  const h0001 = rows.find((r) => r.code === "H0001")!;
  assert.equal(h0001.code_system, "HCPCS");
  assert.equal(h0001.effective_date, "2020-01-01");
  assert.equal(h0001.expiration_date, null);
  assert.equal(h0001.is_active, true);

  const expired = rows.find((r) => r.code === "J9999")!;
  assert.equal(expired.expiration_date, "2018-06-30");
  assert.equal(expired.is_active, false, "terminated codes are inactive");
});

test("parseCpt accepts a minimal CSV (code,description)", () => {
  const csv = [
    "code,description",
    "90791,Psychiatric diagnostic evaluation",
    "90837,Psychotherapy 60 minutes",
  ].join("\n");
  const path = tmpFile("cpt.csv", csv);
  const rows = parseCpt(path);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, "90791");
  assert.equal(rows[0].code_system, "CPT");
  assert.equal(rows[1].description, "Psychotherapy 60 minutes");
});

test("parseCpt throws when required columns are missing", () => {
  const path = tmpFile("bad.csv", "foo,bar\n1,2\n");
  assert.throws(() => parseCpt(path), /missing required columns/i);
});
