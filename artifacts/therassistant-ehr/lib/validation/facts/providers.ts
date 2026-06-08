import { isValidNpi } from "../npi";
import type { FactContext, FactLoader } from "../types";

export const providersFact: FactLoader = {
  name: "providers",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("providers")
      .select("id, first_name, last_name, npi, taxonomy_code, provider_type, can_bill_independently, is_active, archived_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null);

    if (error) throw new Error(`providers query failed: ${error.message}`);
    const rows = data ?? [];
    const active = rows.filter((r) => r.is_active === true);

    const missingNpi: Array<{ id: string; name: string }> = [];
    const invalidNpi: Array<{ id: string; name: string; npi: string }> = [];
    const missingTaxonomy: Array<{ id: string; name: string }> = [];
    let withValidNpiAndTaxonomy = 0;
    let billableActive = 0;

    for (const p of active) {
      const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(unnamed)";
      const npiOk = isValidNpi(p.npi);
      const taxonomyOk = typeof p.taxonomy_code === "string" && p.taxonomy_code.trim().length > 0;

      if (!p.npi) missingNpi.push({ id: p.id, name });
      else if (!npiOk) invalidNpi.push({ id: p.id, name, npi: p.npi });
      if (!taxonomyOk) missingTaxonomy.push({ id: p.id, name });
      if (npiOk && taxonomyOk) withValidNpiAndTaxonomy++;
      if (p.can_bill_independently === true && p.is_active === true) billableActive++;
    }

    return {
      total: rows.length,
      active: active.length,
      billableActive,
      withValidNpiAndTaxonomy,
      missingNpiCount: missingNpi.length,
      invalidNpiCount: invalidNpi.length,
      missingTaxonomyCount: missingTaxonomy.length,
      missingNpiSamples: missingNpi.slice(0, 5),
      invalidNpiSamples: invalidNpi.slice(0, 5),
      missingTaxonomySamples: missingTaxonomy.slice(0, 5),
    };
  },
};
