import type { FactContext, FactLoader } from "../types";

export const payersFact: FactLoader = {
  name: "payers",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("payer_profiles")
      .select("id, payer_name, availity_payer_id, payer_type, is_active")
      .eq("organization_id", organizationId);

    if (error) throw new Error(`payer_profiles query failed: ${error.message}`);
    const rows = data ?? [];
    const active = rows.filter((r) => r.is_active === true);

    const missingPayerId: Array<{ id: string; name: string }> = [];
    const missingType: Array<{ id: string; name: string }> = [];
    for (const p of active) {
      const name = p.payer_name ?? "(unnamed)";
      if (!p.availity_payer_id || String(p.availity_payer_id).trim() === "") {
        missingPayerId.push({ id: p.id, name });
      }
      if (!p.payer_type || String(p.payer_type).trim() === "") {
        missingType.push({ id: p.id, name });
      }
    }

    // Duplicate availity_payer_id across active rows.
    const idCounts = new Map<string, number>();
    for (const p of active) {
      if (!p.availity_payer_id) continue;
      const key = String(p.availity_payer_id).trim().toUpperCase();
      idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
    }
    const duplicateIds: string[] = [];
    for (const [k, v] of idCounts) if (v > 1) duplicateIds.push(k);

    return {
      total: rows.length,
      active: active.length,
      missingPayerIdCount: missingPayerId.length,
      missingTypeCount: missingType.length,
      duplicatePayerIdCount: duplicateIds.length,
      missingPayerIdSamples: missingPayerId.slice(0, 5),
      missingTypeSamples: missingType.slice(0, 5),
      duplicatePayerIds: duplicateIds.slice(0, 5),
    };
  },
};
