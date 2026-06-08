// Coverage for the Loop 2100C REF*1L (Group or Policy Number) plumbing
// in the Availity X12 005010X279A1 (270) generator.
//
// The group number is optional per X12 — many payers nevertheless require
// it to disambiguate the member's plan, so we want a regression net that
// (a) emits the REF*1L segment when a group number is supplied and
// (b) omits it entirely when no group number is provided.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildAvaility270 } from "../generate270";
import type { Eligibility270Input } from "../types";

function baseInput(overrides: Partial<Eligibility270Input> = {}): Eligibility270Input {
  return {
    connection: {
      organization_id: "org-1",
      mode: "test",
      submitter_id: "SUB12345",
      sender_qualifier: "ZZ",
      receiver_qualifier: "ZZ",
      receiver_id: "030240928",
      receiver_name: "AVAILITY",
      gs_receiver_code: "030240928",
      x12_version: "005010X279A1",
      isa_usage_indicator: "T",
    },
    submitterName: "Therassistant Health",
    informationSource: {
      payerName: "Aetna",
      payerId: "60054",
    },
    informationReceiver: {
      entityType: "2",
      lastNameOrOrg: "Therassistant Clinic",
      npi: "1234567890",
    },
    subscriber: {
      lastName: "Smith",
      firstName: "John",
      memberId: "W123456789",
      dob: "1985-06-15",
      gender: "M",
    },
    serviceTypeCodes: ["30"],
    ...overrides,
  };
}

describe("buildAvaility270 — Loop 2100C REF*1L group number", () => {
  it("emits REF*1L*<group>~ when subscriber.groupNumber is provided", () => {
    const result = buildAvaility270(
      baseInput({
        subscriber: {
          lastName: "Smith",
          firstName: "John",
          memberId: "W123456789",
          dob: "1985-06-15",
          gender: "M",
          groupNumber: "GRP-9001",
        },
      }),
    );

    assert.equal(result.validation.isValid, true, "fixture must be a valid 270");
    assert.ok(result.fileContent.length > 0, "fileContent should be non-empty for a valid 270");
    // Group number is sanitized via sanitizeAlphanum (uppercased; "-" stripped).
    assert.ok(
      result.fileContent.includes("REF*1L*GRP9001~"),
      `expected REF*1L*GRP9001~ in:\n${result.fileContent}`,
    );

    // The REF segment must sit inside Loop 2100C — i.e. AFTER the
    // subscriber NM1*IL and BEFORE the DMG demographics segment.
    const refIdx = result.fileContent.indexOf("REF*1L*");
    const nm1IlIdx = result.fileContent.indexOf("NM1*IL*");
    const dmgIdx = result.fileContent.indexOf("DMG*");
    assert.ok(nm1IlIdx >= 0 && refIdx > nm1IlIdx, "REF*1L must follow NM1*IL");
    assert.ok(dmgIdx >= 0 && refIdx < dmgIdx, "REF*1L must precede DMG");
  });

  it("omits REF*1L when subscriber.groupNumber is missing or empty", () => {
    const missing = buildAvaility270(baseInput());
    assert.equal(missing.validation.isValid, true);
    assert.ok(
      !missing.fileContent.includes("REF*1L"),
      `expected no REF*1L segment when groupNumber is undefined:\n${missing.fileContent}`,
    );

    const empty = buildAvaility270(
      baseInput({
        subscriber: {
          lastName: "Smith",
          firstName: "John",
          memberId: "W123456789",
          dob: "1985-06-15",
          gender: "M",
          groupNumber: "",
        },
      }),
    );
    assert.ok(
      !empty.fileContent.includes("REF*1L"),
      `expected no REF*1L segment when groupNumber is empty string:\n${empty.fileContent}`,
    );

    const nullish = buildAvaility270(
      baseInput({
        subscriber: {
          lastName: "Smith",
          firstName: "John",
          memberId: "W123456789",
          dob: "1985-06-15",
          gender: "M",
          groupNumber: null,
        },
      }),
    );
    assert.ok(
      !nullish.fileContent.includes("REF*1L"),
      `expected no REF*1L segment when groupNumber is null:\n${nullish.fileContent}`,
    );
  });

  it("omits REF*1L when sanitization strips the group number to empty", () => {
    // Only-punctuation group numbers reduce to "" after sanitizeAlphanum —
    // we must NOT emit `REF*1L*~` (an empty REF02 is invalid X12).
    const result = buildAvaility270(
      baseInput({
        subscriber: {
          lastName: "Smith",
          firstName: "John",
          memberId: "W123456789",
          dob: "1985-06-15",
          gender: "M",
          groupNumber: "----",
        },
      }),
    );
    assert.ok(
      !result.fileContent.includes("REF*1L"),
      `expected no REF*1L segment when group number sanitizes to empty:\n${result.fileContent}`,
    );
  });
});
