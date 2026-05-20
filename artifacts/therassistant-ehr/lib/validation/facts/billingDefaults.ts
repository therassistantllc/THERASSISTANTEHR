import { isValidNpi } from "../npi";
import type { FactContext, FactLoader } from "../types";

export const billingDefaultsFact: FactLoader = {
  name: "billingDefaults",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("system_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", "organization.billing_profile")
      .maybeSingle();

    const profile =
      !error && data?.setting_value && typeof data.setting_value === "object" && !Array.isArray(data.setting_value)
        ? (data.setting_value as Record<string, unknown>)
        : {};

    if (error) throw new Error(`system_settings query failed: ${error.message}`);

    const npi = typeof profile.billing_provider_npi === "string" ? profile.billing_provider_npi.replace(/\D/g, "") : "";
    const tax = typeof profile.billing_tax_id === "string" ? profile.billing_tax_id.replace(/\D/g, "") : "";
    const zip = typeof profile.billing_zip === "string" ? profile.billing_zip.trim() : "";
    const phone = typeof profile.billing_phone === "string" ? profile.billing_phone.replace(/\D/g, "") : "";

    const hasProfile = Object.keys(profile).length > 0;
    // Must be 10 digits AND pass the CMS Luhn check (prefix 80840 + 9 digits).
    const hasBillingNpi = npi.length === 10 && isValidNpi(npi);
    const hasBillingTaxId = tax.length === 9;
    const hasBillingZip = /^\d{5}(-?\d{4})?$/.test(zip);
    const hasBillingPhone = phone.length === 10;
    const hasBillingName =
      typeof profile.billing_provider_name === "string" && (profile.billing_provider_name as string).trim().length > 0;

    return {
      hasProfile,
      hasBillingName,
      hasBillingNpi,
      hasBillingTaxId,
      hasBillingZip,
      hasBillingPhone,
    };
  },
};
