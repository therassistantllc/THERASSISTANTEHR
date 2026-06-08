// Tests for the ERA 835 → Medical Review queue auto-seeding pipeline.
//
//   - parseEra835 now extracts claim-level LQ*HE and MIA/MOA remark codes.
//   - detectEraDocumentationRequest classifies CARC + remark mixes.
//   - Necessity CARCs (50/55/167) outrank records-only remarks so the
//     audit row lands in the "Medical Necessity Review" tab.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseEra835 } from "@/lib/payments/era835Parser";
import { detectEraDocumentationRequest } from "@/lib/medical-review/documentationRequestDetection";

describe("parseEra835 — remark code extraction", () => {
  it("extracts claim-level LQ*HE remark codes", () => {
    const era = [
      "ST*835*0001",
      "BPR*I*0*C*ACH",
      "TRN*1*ABC*1234567890",
      "N1*PR*ACME PAYER*XV*60054",
      "CLP*CLM-1*4*100*0*0*MC*PAYER-REF",
      "CAS*CO*50*100",
      "LQ*HE*N706",
      "LQ*HE*MA01",
      "SE*9*0001",
    ].join("~") + "~";
    const parsed = parseEra835(era);
    assert.equal(parsed.claims.length, 1);
    const claim = parsed.claims[0];
    assert.deepEqual(claim.remarkCodes.sort(), ["MA01", "N706"]);
  });

  it("extracts MOA-style remark codes", () => {
    const era = [
      "ST*835*0001",
      "BPR*I*100*C*ACH",
      "TRN*1*ABC*1234567890",
      "N1*PR*ACME*XV*60054",
      "CLP*CLM-2*1*200*150*50*MC*REF2",
      "MOA***N705*MA04",
      "SE*7*0001",
    ].join("~") + "~";
    const parsed = parseEra835(era);
    assert.equal(parsed.claims.length, 1);
    assert.ok(parsed.claims[0].remarkCodes.includes("N705"));
    assert.ok(parsed.claims[0].remarkCodes.includes("MA04"));
  });

  it("ignores LQ segments with non-HE qualifiers", () => {
    const era = [
      "ST*835*0001",
      "BPR*I*0*C*ACH",
      "TRN*1*ABC*1",
      "N1*PR*ACME*XV*60054",
      "CLP*CLM-3*4*100*0*0*MC*X",
      "LQ*RX*J1234",
      "SE*6*0001",
    ].join("~") + "~";
    const parsed = parseEra835(era);
    assert.deepEqual(parsed.claims[0].remarkCodes, []);
  });
});

describe("detectEraDocumentationRequest", () => {
  it("classifies necessity CARC 50 as medical_necessity", () => {
    const detected = detectEraDocumentationRequest({
      carcCodes: ["50"],
      remarkCodes: [],
    });
    assert.ok(detected);
    assert.equal(detected!.requestType, "medical_necessity");
    assert.deepEqual(detected!.requestedDocuments, [
      "Clinical note",
      "Treatment plan",
      "Assessment",
    ]);
    assert.match(detected!.requestSource, /CARC 50/);
  });

  it("classifies plain N706 remark as records request", () => {
    const detected = detectEraDocumentationRequest({
      carcCodes: ["45"], // not a doc CARC
      remarkCodes: ["N706"],
    });
    assert.ok(detected);
    assert.equal(detected!.requestType, "records");
    assert.deepEqual(detected!.requestedDocuments, ["Medical records"]);
    assert.match(detected!.requestSource, /RARC N706/);
  });

  it("necessity CARC outranks records remark for the request type", () => {
    const detected = detectEraDocumentationRequest({
      carcCodes: ["167"],
      remarkCodes: ["N706"],
    });
    assert.ok(detected);
    assert.equal(detected!.requestType, "medical_necessity");
    assert.ok(detected!.triggerCodes.includes("167"));
    assert.ok(detected!.triggerCodes.includes("N706"));
  });

  it("returns null when nothing in the remit indicates a doc request", () => {
    const detected = detectEraDocumentationRequest({
      carcCodes: ["1", "2", "45"],
      remarkCodes: ["N99"], // not in doc-request set
    });
    assert.equal(detected, null);
  });

  it("normalizes CO-50 prefixed CARCs to bare 50", () => {
    const detected = detectEraDocumentationRequest({
      carcCodes: ["CO-50"],
      remarkCodes: [],
    });
    assert.ok(detected);
    assert.equal(detected!.requestType, "medical_necessity");
  });
});
