import type { ClaimPartiesSnapshot } from "./types";

type HardOrganizationOverride = {
  billing_provider_name: string;
  billing_provider_npi: string;
  billing_provider_tax_id: string;
  rendering_provider_first_name: string;
  rendering_provider_last_name_or_org: string;
  rendering_provider_npi: string;
};

const HARD_ORGANIZATION_OVERRIDES: Record<string, HardOrganizationOverride> = {
  "CONSCIOUS COUNSELING PLLC": {
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1982355160",
    billing_provider_tax_id: "861384084",
    rendering_provider_first_name: "Lyndsey",
    rendering_provider_last_name_or_org: "Klemme",
    rendering_provider_npi: "1629632542",
  },
  "KINDLY KIERA LLC": {
    billing_provider_name: "Kindly Kiera LLC",
    billing_provider_npi: "1770242786",
    billing_provider_tax_id: "851383748",
    rendering_provider_first_name: "Kiera",
    rendering_provider_last_name_or_org: "Rommel",
    rendering_provider_npi: "1922499581",
  },
};

export function applyHardOrganizationDefaults(
  organizationName: string | null | undefined,
  parties: ClaimPartiesSnapshot,
): ClaimPartiesSnapshot {
  const normalizedOrgName = String(organizationName ?? "").trim().toUpperCase();
  const override = HARD_ORGANIZATION_OVERRIDES[normalizedOrgName];
  if (!override) return parties;

  return {
    ...parties,
    billing_provider_name: override.billing_provider_name,
    billing_provider_npi: override.billing_provider_npi,
    billing_provider_tax_id: override.billing_provider_tax_id,
    rendering_same_as_billing: false,
    rendering_provider_entity_type: "1",
    rendering_provider_first_name: override.rendering_provider_first_name,
    rendering_provider_last_name_or_org: override.rendering_provider_last_name_or_org,
    rendering_provider_npi: override.rendering_provider_npi,
  };
}
