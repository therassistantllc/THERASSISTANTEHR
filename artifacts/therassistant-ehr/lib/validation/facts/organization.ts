import type { FactContext, FactLoader } from "../types";

export const organizationFact: FactLoader = {
  name: "organization",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, legal_name, slug, tax_id_last4, timezone, default_state, is_active, archived_at")
      .eq("id", organizationId)
      .maybeSingle();

    if (error) {
      throw new Error(`organizations query failed: ${error.message}`);
    }
    if (!data) {
      return {
        exists: false,
        isActive: false,
        isArchived: false,
        hasName: false,
        hasLegalName: false,
        hasTaxIdLast4: false,
        hasTimezone: false,
        hasDefaultState: false,
        name: null,
        legalName: null,
        timezone: null,
      };
    }

    return {
      exists: true,
      isActive: data.is_active === true,
      isArchived: data.archived_at != null,
      hasName: typeof data.name === "string" && data.name.trim().length > 0,
      hasLegalName: typeof data.legal_name === "string" && data.legal_name.trim().length > 0,
      hasTaxIdLast4: typeof data.tax_id_last4 === "string" && /^\d{4}$/.test(data.tax_id_last4),
      hasTimezone: typeof data.timezone === "string" && data.timezone.trim().length > 0,
      hasDefaultState: typeof data.default_state === "string" && /^[A-Z]{2}$/.test(data.default_state),
      name: data.name ?? null,
      legalName: data.legal_name ?? null,
      timezone: data.timezone ?? null,
    };
  },
};
