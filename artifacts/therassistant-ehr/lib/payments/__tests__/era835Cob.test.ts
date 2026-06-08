// Task #457 — verify that parseEra835 extracts COB signals (CAS CO*22
// "covered by another payer" and MOA/AMT prior-payer-paid amounts) onto
// each CLP claim payment. Run with:
//   node --experimental-strip-types --test \
//     lib/payments/__tests__/era835Cob.test.ts

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseEra835 } from "../era835Parser";

// Minimal 835 envelope with two CLP loops:
//   - CLP "CLAIM-CO22" has a CAS*CO*22 adjustment (paid $0).
//   - CLP "CLAIM-SECONDARY" has a MOA segment carrying a prior-payer
//     paid amount of $80.00 + NM1*TT naming BCBS as the other payer.
const X12_835 = [
  "ISA*00*          *00*          *ZZ*030240928      *ZZ*SUBMITTERID    *250101*1200*^*00501*000000002*0*P*:~",
  "GS*HP*030240928*SUBMITTERID*20250101*1200*2*X*005010X221A1~",
  "ST*835*0001~",
  "BPR*I*100*C*ACH*CCP*01*999999999*DA*1234567890*EIN012345**01*888888888*DA*9876543210*20250101~",
  "TRN*1*ERA20250101*1999999999~",
  "N1*PR*AETNA~",
  "N1*PE*SOME CLINIC*XX*1234567890~",
  // ── Claim 1: CO-22 denial ─────────────────────────────────────────
  "CLP*CLAIM-CO22*4*100*0*0*HM*PAYERREF1~",
  "NM1*QC*1*DOE*JANE~",
  "CAS*CO*22*100~",
  "DTM*232*20241201~",
  // ── Claim 2: paid as secondary, MOA prior-payer paid + NM1*TT ─────
  "CLP*CLAIM-SECONDARY*2*120*20*0*HM*PAYERREF2~",
  "NM1*QC*1*SMITH*JOHN~",
  "NM1*TT*2*BCBS*****PI*BC001~",
  "MOA*0*80*MA01~",
  "AMT*I*80~",
  "DTM*232*20241215~",
  "SE*15*0001~",
  "GE*1*2~",
  "IEA*1*000000002~",
].join("");

describe("835 COB signal extraction (Task #457)", () => {
  const parsed = parseEra835(X12_835);

  it("parses both CLP loops", () => {
    assert.equal(parsed.claims.length, 2);
  });

  it("flags CO-22 as covered by another payer", () => {
    const co22 = parsed.claims.find((c) => c.clp01ClaimControlNumber === "CLAIM-CO22");
    assert.ok(co22, "CO-22 claim parsed");
    assert.equal(co22!.cobSignals.coveredByOtherPayer, true);
    assert.equal(co22!.cobSignals.co22Amount, 100);
    assert.equal(co22!.cobSignals.otherPayerPaidAmount, null);
    assert.ok(co22!.cobSignals.sourceSegment?.startsWith("CAS*CO*22"));
  });

  it("captures MOA prior-payer paid amount and NM1*TT other-payer name", () => {
    const sec = parsed.claims.find((c) => c.clp01ClaimControlNumber === "CLAIM-SECONDARY");
    assert.ok(sec, "secondary claim parsed");
    // MOA02=80 should populate otherPayerPaidAmount; AMT*I*80 must not
    // double-count (first-wins guard).
    assert.equal(sec!.cobSignals.otherPayerPaidAmount, 80);
    assert.equal(sec!.cobSignals.coveredByOtherPayer, false);
    assert.equal(sec!.cobSignals.otherPayerName, "BCBS");
    assert.equal(sec!.cobSignals.otherPayerId, "BC001");
  });

  it("does NOT treat AMT*AAE (COB total submitted charges) as prior-payer paid", () => {
    // Regression guard — AAE is *submitted charges*, not paid dollars.
    // Mapping it onto otherPayerPaidAmount falsely triggers eob_needed
    // in /api/billing/cob-issues. Only AMT*I (Other Payer Prior
    // Payment Amount) should populate this signal.
    const X12_AAE = [
      "ISA*00*          *00*          *ZZ*030240928      *ZZ*SUBMITTERID    *250101*1200*^*00501*000000004*0*P*:~",
      "GS*HP*030240928*SUBMITTERID*20250101*1200*4*X*005010X221A1~",
      "ST*835*0001~",
      "BPR*I*100*C*ACH*CCP*01*999999999*DA*1234567890*EIN012345**01*888888888*DA*9876543210*20250101~",
      "TRN*1*ERA20250101*1999999999~",
      "N1*PR*AETNA~",
      "N1*PE*SOME CLINIC*XX*1234567890~",
      "CLP*CLAIM-AAE-ONLY*1*150*150*0*HM*REF~",
      "NM1*QC*1*ROE*RICHARD~",
      "AMT*AAE*150~",
      "DTM*232*20241201~",
      "SE*9*0001~",
      "GE*1*4~",
      "IEA*1*000000004~",
    ].join("");
    const aae = parseEra835(X12_AAE);
    const c = aae.claims[0]!;
    assert.equal(c.cobSignals.otherPayerPaidAmount, null);
    assert.equal(c.cobSignals.coveredByOtherPayer, false);
    assert.equal(c.cobSignals.sourceSegment, null);
  });

  it("leaves cobSignals empty on a claim with no COB evidence", () => {
    const X12_PLAIN = [
      "ISA*00*          *00*          *ZZ*030240928      *ZZ*SUBMITTERID    *250101*1200*^*00501*000000003*0*P*:~",
      "GS*HP*030240928*SUBMITTERID*20250101*1200*3*X*005010X221A1~",
      "ST*835*0001~",
      "BPR*I*50*C*ACH*CCP*01*999999999*DA*1234567890*EIN012345**01*888888888*DA*9876543210*20250101~",
      "TRN*1*ERA20250101*1999999999~",
      "N1*PR*AETNA~",
      "N1*PE*SOME CLINIC*XX*1234567890~",
      "CLP*PLAIN*1*50*50*0*HM*REF~",
      "NM1*QC*1*DOE*JOHN~",
      "DTM*232*20241201~",
      "SE*9*0001~",
      "GE*1*3~",
      "IEA*1*000000003~",
    ].join("");
    const plain = parseEra835(X12_PLAIN);
    const c = plain.claims[0]!;
    assert.equal(c.cobSignals.coveredByOtherPayer, false);
    assert.equal(c.cobSignals.co22Amount, 0);
    assert.equal(c.cobSignals.otherPayerPaidAmount, null);
    assert.equal(c.cobSignals.otherPayerName, null);
  });
});
