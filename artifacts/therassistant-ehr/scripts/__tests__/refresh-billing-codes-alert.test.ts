import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRefreshOutcome,
  expectedIcd10ReleaseYear,
  expectedHcpcsReleaseDate,
  summarizeAlertReasons,
} from "../../lib/billingCodes/refreshAlertLogic";

test("no alert when every code system returned rows and no errors", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-05-23T12:00:00Z"),
    results: [
      { codeSystem: "ICD-10-CM", parsedRows: 73000 },
      { codeSystem: "HCPCS", parsedRows: 6000 },
    ],
  });
  assert.equal(out.shouldAlert, false);
  assert.equal(out.reasons.length, 0);
});

test("alert when any system errored", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-05-23T12:00:00Z"),
    results: [
      { codeSystem: "ICD-10-CM", parsedRows: 73000 },
      { codeSystem: "HCPCS", parsedRows: 0, error: "HTTP 404" },
    ],
  });
  assert.equal(out.shouldAlert, true);
  assert.equal(out.reasons.length, 1);
  assert.equal(out.reasons[0].kind, "error");
  assert.equal(out.reasons[0].codeSystem, "HCPCS");
});

test("error suppresses the redundant 'missing' reason for the same system", () => {
  // Even though HCPCS has 0 rows and a release is overdue, the error is the
  // more actionable alert — don't double-fire.
  const out = evaluateRefreshOutcome({
    now: new Date("2026-10-20T12:00:00Z"),
    results: [{ codeSystem: "HCPCS", parsedRows: 0, error: "download failed" }],
  });
  assert.equal(out.reasons.length, 1);
  assert.equal(out.reasons[0].kind, "error");
});

test("zero ICD-10 rows is fine BEFORE Oct 15 (no new release yet expected)", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-09-30T23:00:00Z"),
    results: [{ codeSystem: "ICD-10-CM", parsedRows: 0 }],
  });
  assert.equal(out.shouldAlert, false);
});

test("zero ICD-10 rows fires 'missing' alert ON/after Oct 15", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-10-15T00:00:00Z"),
    results: [{ codeSystem: "ICD-10-CM", parsedRows: 0 }],
  });
  assert.equal(out.shouldAlert, true);
  assert.equal(out.reasons.length, 1);
  assert.equal(out.reasons[0].kind, "missing");
  if (out.reasons[0].kind === "missing") {
    assert.equal(out.reasons[0].overdueSince, "2026-10-15");
  }
});

test("zero HCPCS rows fires 'missing' after a quarterly cutoff (Apr 15, Jul 15, etc.)", () => {
  // Just past the Q2 cutoff.
  const out = evaluateRefreshOutcome({
    now: new Date("2026-04-20T12:00:00Z"),
    results: [{ codeSystem: "HCPCS", parsedRows: 0 }],
  });
  assert.equal(out.shouldAlert, true);
  assert.equal(out.reasons[0].kind, "missing");
  if (out.reasons[0].kind === "missing") {
    assert.equal(out.reasons[0].overdueSince, "2026-04-15");
  }
});

test("zero HCPCS rows is fine BEFORE Jan 15 of the current year", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-01-10T12:00:00Z"),
    results: [{ codeSystem: "HCPCS", parsedRows: 0 }],
  });
  assert.equal(out.shouldAlert, false);
});

test("CPT never fires 'missing' (no automated release calendar for AMA-licensed codes)", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-12-31T12:00:00Z"),
    results: [{ codeSystem: "CPT", parsedRows: 0 }],
  });
  assert.equal(out.shouldAlert, false);
});

test("CPT still fires when explicitly errored", () => {
  const out = evaluateRefreshOutcome({
    now: new Date("2026-05-23T12:00:00Z"),
    results: [{ codeSystem: "CPT", parsedRows: 0, error: "license expired" }],
  });
  assert.equal(out.shouldAlert, true);
  assert.equal(out.reasons[0].kind, "error");
});

test("expectedIcd10ReleaseYear returns the calendar year iff past Oct 15 UTC", () => {
  assert.equal(expectedIcd10ReleaseYear(new Date("2026-10-14T23:59:00Z")), null);
  assert.equal(expectedIcd10ReleaseYear(new Date("2026-10-15T00:00:00Z")), 2026);
  // Feb 2027 is BEFORE Oct 15, 2027 → no 2027 release is overdue yet.
  assert.equal(expectedIcd10ReleaseYear(new Date("2027-02-01T00:00:00Z")), null);
  assert.equal(expectedIcd10ReleaseYear(new Date("2027-10-16T00:00:00Z")), 2027);
});

test("expectedHcpcsReleaseDate returns the latest overdue cutoff", () => {
  assert.equal(expectedHcpcsReleaseDate(new Date("2026-01-14T12:00:00Z")), null);
  assert.equal(expectedHcpcsReleaseDate(new Date("2026-01-15T00:00:00Z")), "2026-01-15");
  assert.equal(expectedHcpcsReleaseDate(new Date("2026-05-20T12:00:00Z")), "2026-04-15");
  assert.equal(expectedHcpcsReleaseDate(new Date("2026-11-01T12:00:00Z")), "2026-10-15");
});

test("summarizeAlertReasons renders error and missing reasons", () => {
  const s = summarizeAlertReasons([
    { kind: "error", codeSystem: "ICD-10-CM", message: "HTTP 500" },
    { kind: "missing", codeSystem: "HCPCS", overdueSince: "2026-07-15" },
  ]);
  assert.match(s, /ICD-10-CM failed: HTTP 500/);
  assert.match(s, /HCPCS returned 0 rows.*2026-07-15/);
});
