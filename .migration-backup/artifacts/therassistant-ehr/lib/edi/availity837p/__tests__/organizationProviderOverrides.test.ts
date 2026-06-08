import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { generateAvaility837PBatch } from "../generate837p";
import { applyHardOrganizationDefaults } from "../organizationProviderOverrides";
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

function makeClaim(): ProfessionalClaim {
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

function makeInput(parties: ClaimPartiesSnapshot): Availity837PGenerationInput {
  return {
    connection: makeConnection(),
    submitterName: "Therassistant Clinic",
    claim: makeClaim(),
    serviceLines: makeServiceLines(),
    parties,
    payerProfile: {
      id: "pp-1",
      organization_id: "org-1",
      payer_name: "Anthem",
      availity_payer_id: "ANTHEM01",
    },
  };
}

describe("organization provider overrides", () => {
  it("applies Conscious Counseling fixed billing/rendering identity into generated 837P", () => {
    const overridden = applyHardOrganizationDefaults("Conscious Counseling PLLC", makeParties());
    assert.equal(overridden.billing_provider_npi, "1982355160");
    assert.equal(overridden.billing_provider_tax_id, "861384084");
    assert.equal(overridden.rendering_provider_last_name_or_org, "Klemme");
    assert.equal(overridden.rendering_provider_first_name, "Lyndsey");
    assert.equal(overridden.rendering_provider_npi, "1629632542");

    const generated = generateAvaility837PBatch(makeInput(overridden));
    const x12 = generated.fileContent;
    assert.match(x12, /NM1\*85\*2\*Conscious Counseling PLLC\*\*\*\*\*XX\*1982355160~/);
    assert.match(x12, /REF\*EI\*861384084~/);
    assert.match(x12, /NM1\*82\*1\*Klemme\*Lyndsey\*\*\*\*XX\*1629632542~/);
  });

  it("applies Kindly Kiera fixed billing/rendering identity into generated 837P", () => {
    const overridden = applyHardOrganizationDefaults("Kindly Kiera LLC", makeParties());
    assert.equal(overridden.billing_provider_npi, "1770242786");
    assert.equal(overridden.billing_provider_tax_id, "851383748");
    assert.equal(overridden.rendering_provider_last_name_or_org, "Rommel");
    assert.equal(overridden.rendering_provider_first_name, "Kiera");
    assert.equal(overridden.rendering_provider_npi, "1922499581");

    const generated = generateAvaility837PBatch(makeInput(overridden));
    const x12 = generated.fileContent;
    assert.match(x12, /NM1\*85\*2\*Kindly Kiera LLC\*\*\*\*\*XX\*1770242786~/);
    assert.match(x12, /REF\*EI\*851383748~/);
    assert.match(x12, /NM1\*82\*1\*Rommel\*Kiera\*\*\*\*XX\*1922499581~/);
  });
});
