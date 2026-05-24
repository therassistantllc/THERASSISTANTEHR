// Tests for the typed 999 error classifier. Verifies:
//   - IK3 loop identifiers (1000A / 2300 / etc.) drive the tab bucket
//     instead of the old substring heuristic.
//   - IK4 element reference + syntax-error code → human message from
//     the lookup table, not the raw "IK4*3*66*7" segment.
//   - AK3/AK4 (4010-style functional-group structural) → edi_format.
//   - AK9 reject with no IK3/IK4 → file_rejected, with a message that
//     does NOT leak the raw segment.
//   - Mixed-error 999 with both 1000A and a claim loop rolls up to the
//     loudest bucket (invalid_submitter), so a bad submitter ID isn't
//     hidden behind one of the per-claim rejects it caused.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ELEMENT_SYNTAX_ERROR_CODES,
  SEGMENT_SYNTAX_ERROR_CODES,
  classify999Errors,
} from "../edi999Classification";

describe("classify999Errors", () => {
  it("buckets IK3 inside loop 1000A as invalid_submitter", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["IK3*NM1*8*1000A*8", "IK4*8:2*66*7*BADSUB01"],
    });
    assert.equal(result.errorCategory, "invalid_submitter");
    assert.equal(result.primaryReasonCode, "8");
    assert.ok(
      result.primaryMessage.toLowerCase().includes(
        SEGMENT_SYNTAX_ERROR_CODES["8"].toLowerCase(),
      ),
      `expected lookup-table message, got "${result.primaryMessage}"`,
    );
    assert.ok(result.primaryLocation.includes("1000A"));
    assert.equal(result.errorDetails.length, 2);
    assert.equal(result.errorDetails[0].loopId, "1000A");
    assert.equal(result.errorDetails[1].elementReference, "66");
  });

  it("buckets IK3 inside claim loop 2300 as claim_syntax with a human message", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["IK3*CLM*42*2300*8", "IK4*5*1325*7*BAD"],
    });
    assert.equal(result.errorCategory, "claim_syntax");
    assert.ok(result.primaryMessage.toLowerCase().includes("clm"));
    assert.ok(result.primaryMessage.toLowerCase().includes("loop 2300"));
    // The raw segment must NOT be surfaced verbatim.
    assert.notEqual(result.primaryMessage, "IK3*CLM*42*2300*8");
  });

  it("uses the element syntax lookup for IK4 reason codes", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["IK4*3*66*7*BADCODE"],
    });
    const ik4 = result.errorDetails[0];
    assert.equal(ik4.kind, "IK4");
    assert.equal(ik4.syntaxErrorCode, "7");
    assert.equal(ik4.elementReference, "66");
    assert.equal(ik4.badValue, "BADCODE");
    assert.ok(
      ik4.humanMessage.toLowerCase().includes(ELEMENT_SYNTAX_ERROR_CODES["7"].toLowerCase()),
    );
    assert.ok(ik4.humanMessage.includes("BADCODE"));
  });

  it("treats AK3/AK4 (4010 functional-group structural errors) as edi_format", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["AK3*BHT*2**8", "AK4*1*353*7"],
    });
    assert.equal(result.errorCategory, "edi_format");
  });

  it("returns file_rejected with a clean message when AK9=R has no IK3/IK4 detail", () => {
    const result = classify999Errors({ ak9Code: "R", errorSegments: [] });
    assert.equal(result.errorCategory, "file_rejected");
    assert.equal(result.primaryLocation, "File envelope");
    assert.ok(result.primaryMessage.toLowerCase().includes("rejected"));
    assert.equal(result.errorDetails.length, 0);
  });

  it("rolls up to invalid_submitter when 999 carries both submitter + claim errors", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: [
        "IK3*CLM*42*2300*8", // claim-level error
        "IK3*NM1*8*1000A*8", // submitter error — must win
      ],
    });
    assert.equal(result.errorCategory, "invalid_submitter");
    assert.ok(result.primaryLocation.includes("1000A"));
  });

  it("classifies receiver loop 1000B as edi_format", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["IK3*NM1*9*1000B*8"],
    });
    assert.equal(result.errorCategory, "edi_format");
  });

  it("handles loopless IK3 as edi_format (header / ST-level)", () => {
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["IK3*ST*1**8"],
    });
    assert.equal(result.errorCategory, "edi_format");
  });

  it("classifies loopless IK3*NM1 as invalid_submitter (Availity-style)", () => {
    // Availity sometimes emits the submitter complaint without the
    // 1000A loop id. The only NM1 that can appear without a loop in an
    // 837P is the Loop 1000A submitter, so it must still bucket as a
    // submitter problem — not be silently dumped into edi_format.
    const result = classify999Errors({
      ak9Code: "R",
      errorSegments: ["IK3*NM1*8**8", "IK4*8:2*66*7*BADSUB01"],
    });
    assert.equal(result.errorCategory, "invalid_submitter");
    assert.equal(result.errorDetails[0].segmentId, "NM1");
    assert.equal(result.errorDetails[0].loopId, undefined);
  });

  it("tolerates legacy parsed_content with only errorSegments", () => {
    // Older intake rows do not carry errorCategory / primaryMessage —
    // re-classifying on read must still produce a typed bucket.
    const legacy = {
      outcome: "rejected",
      ak9Code: "R",
      ik5Statuses: ["R"],
      errorSegments: ["IK3*NM1*8*1000A*8"],
      segmentCount: 12,
    };
    const result = classify999Errors(legacy);
    assert.equal(result.errorCategory, "invalid_submitter");
    assert.ok(result.primaryMessage.length > 0);
    assert.notEqual(result.primaryMessage, "IK3*NM1*8*1000A*8");
  });

  it("returns sensible defaults for unknown / empty payload", () => {
    assert.equal(classify999Errors(null).errorCategory, "file_rejected");
    assert.equal(classify999Errors({}).errorCategory, "file_rejected");
    assert.equal(classify999Errors({ errorSegments: "not-an-array" }).errorCategory, "file_rejected");
  });
});
