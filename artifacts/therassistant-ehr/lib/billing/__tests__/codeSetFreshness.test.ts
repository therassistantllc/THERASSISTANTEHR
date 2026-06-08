/**
 * Tests for code-set freshness staleness logic (Task #197).
 *
 * Exercises the pure `computeCodeSetStatus` + `latestCmsReleaseDate`
 * functions so we know the in-app "Stale" badge fires correctly
 * relative to each code system's CMS release cadence.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  computeCodeSetStatus,
  latestCmsReleaseDate,
  type CodeSetRow,
} from "../codeSetFreshness";

function row(
  table: CodeSetRow["table"],
  codeSystem: CodeSetRow["codeSystem"],
  lastLoadedAt: string | null,
  activeCount = 0,
): CodeSetRow {
  return { table, codeSystem, lastLoadedAt, activeCount };
}

describe("latestCmsReleaseDate", () => {
  it("returns the previous Oct 1 for ICD-10-CM before this year's release", () => {
    const got = latestCmsReleaseDate("ICD-10-CM", new Date("2026-09-30T00:00:00Z"));
    assert.equal(got.toISOString().slice(0, 10), "2025-10-01");
  });

  it("returns this year's Oct 1 once the ICD-10-CM release has landed", () => {
    const got = latestCmsReleaseDate("ICD-10-CM", new Date("2026-10-15T00:00:00Z"));
    assert.equal(got.toISOString().slice(0, 10), "2026-10-01");
  });

  it("uses Jan 1 of the current year for CPT", () => {
    const got = latestCmsReleaseDate("CPT", new Date("2026-08-12T00:00:00Z"));
    assert.equal(got.toISOString().slice(0, 10), "2026-01-01");
  });

  it("picks the most recent past quarter for HCPCS", () => {
    assert.equal(
      latestCmsReleaseDate("HCPCS", new Date("2026-05-20T00:00:00Z")).toISOString().slice(0, 10),
      "2026-04-01",
    );
    assert.equal(
      latestCmsReleaseDate("HCPCS", new Date("2026-12-31T00:00:00Z")).toISOString().slice(0, 10),
      "2026-10-01",
    );
  });
});

describe("computeCodeSetStatus", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");

  it("flags 'Never loaded' when the table is empty for a system", () => {
    const out = computeCodeSetStatus([], NOW);
    const icd = out.find((s) => s.codeSystem === "ICD-10-CM")!;
    assert.equal(icd.isStale, true);
    assert.equal(icd.staleReason, "Never loaded");
    assert.equal(icd.lastLoadedAt, null);
  });

  it("is Current when the load happened on or after the latest release", () => {
    // Latest CPT release on 2026-06-01 is 2026-01-01. A load on
    // 2026-01-05 happened *after* the release → Current.
    const out = computeCodeSetStatus(
      [row("procedure_codes", "CPT", "2026-01-05T00:00:00Z", 9000)],
      NOW,
    );
    const cpt = out.find((s) => s.codeSystem === "CPT")!;
    assert.equal(cpt.isStale, false);
    assert.equal(cpt.staleReason, "Current");
    assert.equal(cpt.activeCount, 9000);
  });

  it("stays Current if the release dropped within the last 30 days, even with no new load", () => {
    // HCPCS quarterly release on 2026-04-01; on 2026-04-15 only 14 days
    // have passed — give ops time to import before flagging stale.
    const out = computeCodeSetStatus(
      [row("procedure_codes", "HCPCS", "2026-01-02T00:00:00Z", 7500)],
      new Date("2026-04-15T00:00:00Z"),
    );
    const hcpcs = out.find((s) => s.codeSystem === "HCPCS")!;
    assert.equal(hcpcs.isStale, false);
    assert.equal(hcpcs.staleReason, "Current");
  });

  it("flags Stale once a release has been out >30 days without a fresh load", () => {
    // HCPCS latest as of 2026-06-01 is 2026-04-01 (61 days old).
    // Last load 2025-10-01 is before that release → Stale.
    const out = computeCodeSetStatus(
      [row("procedure_codes", "HCPCS", "2025-10-01T00:00:00Z", 7500)],
      NOW,
    );
    const hcpcs = out.find((s) => s.codeSystem === "HCPCS")!;
    assert.equal(hcpcs.isStale, true);
    assert.match(hcpcs.staleReason, /2026-04-01 CMS release has been out for 61 days/);
  });

  it("always returns one entry per known system in stable order", () => {
    const out = computeCodeSetStatus([], NOW);
    assert.deepEqual(
      out.map((s) => s.codeSystem),
      ["ICD-10-CM", "HCPCS", "CPT"],
    );
  });
});
