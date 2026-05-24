// Verifies the 837P generator wires corrected-claim resubmission data into
// the X12 envelope:
//   - CLM05-3 uses claim.claim_frequency_code (defaults to '1')
//   - Frequency 7/8 emits a 2300 REF*F8 segment carrying the original payer
//     claim control number (CLP07 from the prior 835)
// Without these two fields, payers reject the resubmission as a duplicate
// of the original — see Task #450.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { generateAvaility837PBatch } from "../generate837p";
import { generateAvaility837PMultiClaimBatch } from "../generate837pMultiClaimBatch";
import type {
  Availity837PGenerationInput,
  AvailityConnection,
  ClaimPartiesSnapshot,
  ProfessionalClaim,
  ProfessionalClaimServiceLine,
} from "../types";

function makeConnection(): AvailityConnection {
  return {
    organization_id: "org-1",
    mode: "test",
    submitter_id: "SUB001",
    sender_qualifier: "ZZ",
    receiver_qualifier: "30",
    receiver_id: "030240928",
    receiver_name: "Availity",
    gs_receiver_code: "030240928",
    x12_version: "005010X222A1",
    isa_usage_indicator: "T",
    submitter_contact_phone: "5551234567",
    submitter_contact_email: "edi@example.com",
    is_active: true,
  };
}

function makeParties(): ClaimPartiesSnapshot {
  return {
    id: "p-1",
    claim_id: "c-1",
    billing_provider_entity_type: "2",
    billing_provider_name: "Therassistant Clinic",
    billing_provider_npi: "1234567893",
    billing_provider_tax_id: "123456789",
    billing_provider_tax_id_type: "EI",
    billing_provider_address1: "100 Main St",
    billing_provider_city: "Austin",
    billing_provider_state: "TX",
    billing_provider_zip: "78701",
    subscriber_last_name: "Doe",
    subscriber_first_name: "Jane",
    subscriber_member_id: "MEM123",
    subscriber_dob: "19800101",
    subscriber_gender: "F",
    subscriber_address1: "200 Oak St",
    subscriber_city: "Austin",
    subscriber_state: "TX",
    subscriber_zip: "78701",
    patient_is_subscriber: true,
    payer_name: "Anthem",
    payer_id: "ANTHEM01",
    rendering_same_as_billing: true,
    service_facility_same_as_billing: true,
  };
}

function makeServiceLines(): ProfessionalClaimServiceLine[] {
  return [
    {
      id: "sl-1",
      claim_id: "c-1",
      line_number: 1,
      service_date_from: "20260501",
      procedure_code: "90834",
      modifiers: [],
      charge_amount: 150,
      units: 1,
      diagnosis_pointers: ["1"],
      place_of_service: "11",
    },
  ];
}

function makeClaim(overrides: Partial<ProfessionalClaim> = {}): ProfessionalClaim {
  return {
    id: "c-1",
    organization_id: "org-1",
    claim_number: "C0001",
    patient_account_number: "PAT-0001",
    claim_status: "ready_for_batch",
    total_charge: 150,
    place_of_service: "11",
    diagnosis_codes: ["F32.9"],
    accept_assignment: true,
    benefits_assignment: true,
    release_of_information: true,
    signature_on_file: true,
    ...overrides,
  };
}

function makeInput(claimOverrides: Partial<ProfessionalClaim> = {}): Availity837PGenerationInput {
  return {
    connection: makeConnection(),
    submitterName: "Therassistant Clinic",
    claim: makeClaim(claimOverrides),
    serviceLines: makeServiceLines(),
    parties: makeParties(),
    payerProfile: {
      id: "pp-1",
      organization_id: "org-1",
      payer_name: "Anthem",
      availity_payer_id: "ANTHEM01",
    },
  };
}

// NOTE: buildSegment's sanitizeX12 strips colons from element values, so the
// CLM05 composite `POS:B:freq` renders as "POS B freq" in the on-the-wire
// output. We split on whitespace to recover the third component.
function clmFreqOf(clm: string): string {
  const facility = clm.split("*")[5] ?? "";
  return facility.split(/\s+/)[2] ?? "";
}

function firstClmFreq(content: string): string {
  const clm = content.split("~").find((s) => s.startsWith("CLM*"));
  assert.ok(clm, "expected a CLM segment");
  return clmFreqOf(clm!);
}

describe("Availity 837P — corrected claim resubmission", () => {
  it("defaults CLM05-3 to '1' and emits no REF*F8 for original claims", () => {
    const batch = generateAvaility837PBatch(makeInput());
    assert.equal(firstClmFreq(batch.fileContent), "1");
    assert.ok(!batch.fileContent.includes("REF*F8*"), "no REF*F8 on originals");
  });

  it("writes CLM05-3='7' and REF*F8 for replacement claims", () => {
    const batch = generateAvaility837PBatch(
      makeInput({
        claim_frequency_code: "7",
        original_payer_claim_control_number: "ICN-ORIG-123",
      }),
    );
    assert.equal(firstClmFreq(batch.fileContent), "7");
    assert.ok(
      batch.fileContent.includes("REF*F8*ICN-ORIG-123~"),
      "REF*F8 must carry original payer Claim Control Number",
    );
  });

  it("writes CLM05-3='8' and REF*F8 for void claims", () => {
    const batch = generateAvaility837PBatch(
      makeInput({
        claim_frequency_code: "8",
        original_payer_claim_control_number: "ICN-VOID-9",
      }),
    );
    assert.equal(firstClmFreq(batch.fileContent), "8");
    assert.ok(batch.fileContent.includes("REF*F8*ICN-VOID-9~"));
  });

  it("skips REF*F8 when frequency is 7/8 but the ICN is missing", () => {
    // Generator must not emit REF*F8 with an empty payer Claim Control
    // Number — the segment would be syntactically invalid and would itself
    // get rejected. The corrected-claim lookup is best-effort.
    const batch = generateAvaility837PBatch(
      makeInput({ claim_frequency_code: "7", original_payer_claim_control_number: null }),
    );
    assert.equal(firstClmFreq(batch.fileContent), "7");
    assert.ok(!batch.fileContent.includes("REF*F8*"));
  });

  it("multi-claim batch wires per-claim frequency and REF*F8 independently", () => {
    const batch = generateAvaility837PMultiClaimBatch({
      connection: makeConnection(),
      submitterName: "Therassistant Clinic",
      claims: [
        {
          claim: makeClaim({ id: "c-a", patient_account_number: "PAT-A", claim_number: "CA" }),
          serviceLines: makeServiceLines().map((l) => ({ ...l, claim_id: "c-a" })),
          parties: { ...makeParties(), claim_id: "c-a" },
          payerProfile: {
            id: "pp-1",
            organization_id: "org-1",
            payer_name: "Anthem",
            availity_payer_id: "ANTHEM01",
          },
        },
        {
          claim: makeClaim({
            id: "c-b",
            patient_account_number: "PAT-B",
            claim_number: "CB",
            claim_frequency_code: "7",
            original_payer_claim_control_number: "ICN-B-77",
          }),
          serviceLines: makeServiceLines().map((l) => ({ ...l, claim_id: "c-b" })),
          parties: { ...makeParties(), claim_id: "c-b" },
          payerProfile: {
            id: "pp-1",
            organization_id: "org-1",
            payer_name: "Anthem",
            availity_payer_id: "ANTHEM01",
          },
        },
      ],
    });

    const segments = batch.fileContent.split("~");
    const clms = segments.filter((s) => s.startsWith("CLM*"));
    assert.equal(clms.length, 2);
    // First claim defaults to '1', second carries '7'.
    assert.equal(clmFreqOf(clms[0]!), "1");
    assert.equal(clmFreqOf(clms[1]!), "7");
    // REF*F8 appears exactly once and references the second claim's ICN.
    const refF8 = segments.filter((s) => s.startsWith("REF*F8*"));
    assert.equal(refF8.length, 1);
    assert.equal(refF8[0], "REF*F8*ICN-B-77");
  });
});
