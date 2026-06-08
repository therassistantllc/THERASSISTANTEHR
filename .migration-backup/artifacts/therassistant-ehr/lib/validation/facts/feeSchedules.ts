import type { FactContext, FactLoader } from "../types";

export const feeSchedulesFact: FactLoader = {
  name: "feeSchedules",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("fee_schedules")
      .select("id, procedure_code, allowed_amount, billed_rate, effective_date, expiration_date, archived_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null);

    if (error) throw new Error(`fee_schedules query failed: ${error.message}`);
    const rows = data ?? [];
    const today = new Date().toISOString().slice(0, 10);

    const nonPositiveAllowed: Array<{ id: string; procedure_code: string }> = [];
    const expired: Array<{ id: string; procedure_code: string; expiration_date: string }> = [];
    const codeCounts = new Map<string, number>();

    for (const fs of rows) {
      const allowed = Number(fs.allowed_amount ?? 0);
      if (!Number.isFinite(allowed) || allowed <= 0) {
        nonPositiveAllowed.push({ id: fs.id, procedure_code: fs.procedure_code });
      }
      if (typeof fs.expiration_date === "string" && fs.expiration_date < today) {
        expired.push({ id: fs.id, procedure_code: fs.procedure_code, expiration_date: fs.expiration_date });
      }
      if (typeof fs.procedure_code === "string") {
        codeCounts.set(fs.procedure_code, (codeCounts.get(fs.procedure_code) ?? 0) + 1);
      }
    }

    const duplicateCodes: string[] = [];
    for (const [k, v] of codeCounts) if (v > 1) duplicateCodes.push(k);

    return {
      total: rows.length,
      nonPositiveAllowedCount: nonPositiveAllowed.length,
      expiredCount: expired.length,
      duplicateCodeCount: duplicateCodes.length,
      nonPositiveAllowedSamples: nonPositiveAllowed.slice(0, 5),
      expiredSamples: expired.slice(0, 5),
      duplicateCodeSamples: duplicateCodes.slice(0, 5),
    };
  },
};
