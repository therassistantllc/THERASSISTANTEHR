// Task #457 — verify that the 271 parser extracts other-payer entries
// from EB*R (Other or Additional Payor) subloops. Run with:
//   node --experimental-strip-types --test \
//     lib/edi/availity270/__tests__/otherPayers.test.ts
//
// The X12 005010X279A1 271 places additional payers under a benefit
// information loop opened by EB*R (Loop 2120C / 2120D). The NM1*PR that
// follows identifies the other payer name + payer-id, and DTP*356/357
// carries eligibility begin/end. The parser must flush one entry per
// EB*R and not contaminate the responding payer (the top-level NM1*PR).

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseAvaility271 } from "../parse271";

// Minimal 271 with: ISA/GS/ST envelope, responding payer (NM1*PR
// AETNA), subscriber (NM1*IL), one active EB*1, then an EB*R subloop
// naming MEDICARE as the other payer with eligibility dates.
const X12 = [
  "ISA*00*          *00*          *ZZ*030240928      *ZZ*SUBMITTERID    *250101*1200*^*00501*000000001*0*P*:~",
  "GS*HB*030240928*SUBMITTERID*20250101*1200*1*X*005010X279A1~",
  "ST*271*0001*005010X279A1~",
  "BHT*0022*11*REF*20250101*1200~",
  "HL*1**20*1~",
  "NM1*PR*2*AETNA*****PI*60054~",
  "HL*2*1*21*1~",
  "NM1*1P*2*SOME CLINIC*****XX*1234567890~",
  "HL*3*2*22*0~",
  "NM1*IL*1*DOE*JANE****MI*W123456789~",
  "DMG*D8*19800101*F~",
  "EB*1*IND*30*HM*Plan A~",
  "DTP*356*D8*20250101~",
  "EB*R*IND*30~",
  "NM1*PR*2*MEDICARE*****PI*MCARE01~",
  "DTP*356*D8*20240601~",
  "DTP*357*D8*20251231~",
  "SE*15*0001~",
  "GE*1*1~",
  "IEA*1*000000001~",
].join("");

describe("271 EB*R other-payer extraction (Task #457)", () => {
  it("captures NM1*PR + DTP 356/357 inside an EB*R subloop", () => {
    const parsed = parseAvaility271(X12);
    // Responding payer must remain the top-level NM1*PR (AETNA),
    // *not* the one inside the EB*R subloop. Regression guard.
    assert.equal(parsed.payerName, "AETNA");
    assert.equal(parsed.payerId, "60054");
    assert.ok(parsed.otherPayers && parsed.otherPayers.length === 1, "one other-payer entry");
    const other = parsed.otherPayers![0]!;
    assert.equal(other.name, "MEDICARE");
    assert.equal(other.payerId, "MCARE01");
    assert.equal(other.effectiveDate, "2024-06-01");
    assert.equal(other.terminationDate, "2025-12-31");
  });

  it("returns an empty list when no EB*R is present", () => {
    const noOther = X12.replace(
      "EB*R*IND*30~NM1*PR*2*MEDICARE*****PI*MCARE01~DTP*356*D8*20240601~DTP*357*D8*20251231~",
      "",
    );
    const parsed = parseAvaility271(noOther);
    // Header SE segment count is stale but the parser doesn't enforce it.
    assert.deepEqual(parsed.otherPayers ?? [], []);
  });
});
