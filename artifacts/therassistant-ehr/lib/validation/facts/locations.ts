import { isValidNpi } from "../npi";
import type { FactContext, FactLoader } from "../types";

const VALID_POS_CODES = new Set([
  "02", "10", "11", "12", "17", "18", "19", "20", "21", "22", "23", "24",
  "33", "49", "50", "51", "52", "53", "71", "72", "81", "99",
]);

export const locationsFact: FactLoader = {
  name: "locations",
  async load({ organizationId, supabase }: FactContext) {
    const { data, error } = await supabase
      .from("service_locations")
      .select("id, name, location_type, place_of_service_code, npi, address_line1, address_city, address_state, address_zip, is_active, is_default, archived_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null);

    if (error) throw new Error(`service_locations query failed: ${error.message}`);
    const rows = data ?? [];
    const active = rows.filter((r) => r.is_active === true);

    let defaults = 0;
    const missingAddress: Array<{ id: string; name: string }> = [];
    const invalidPos: Array<{ id: string; name: string; code: string | null }> = [];
    const invalidNpi: Array<{ id: string; name: string; npi: string }> = [];

    for (const loc of active) {
      if (loc.is_default === true) defaults++;
      const hasAddr =
        typeof loc.address_line1 === "string" && loc.address_line1.trim().length > 0 &&
        typeof loc.address_city === "string" && loc.address_city.trim().length > 0 &&
        typeof loc.address_state === "string" && /^[A-Z]{2}$/.test(loc.address_state) &&
        typeof loc.address_zip === "string" && /^\d{5}(-?\d{4})?$/.test(loc.address_zip);
      if (!hasAddr) missingAddress.push({ id: loc.id, name: loc.name ?? "(unnamed)" });
      if (!loc.place_of_service_code || !VALID_POS_CODES.has(String(loc.place_of_service_code))) {
        invalidPos.push({ id: loc.id, name: loc.name ?? "(unnamed)", code: loc.place_of_service_code ?? null });
      }
      if (loc.npi && !isValidNpi(loc.npi)) {
        invalidNpi.push({ id: loc.id, name: loc.name ?? "(unnamed)", npi: loc.npi });
      }
    }

    return {
      total: rows.length,
      active: active.length,
      defaults,
      hasExactlyOneDefault: defaults === 1,
      missingAddressCount: missingAddress.length,
      invalidPosCount: invalidPos.length,
      invalidNpiCount: invalidNpi.length,
      missingAddressSamples: missingAddress.slice(0, 5),
      invalidPosSamples: invalidPos.slice(0, 5),
      invalidNpiSamples: invalidNpi.slice(0, 5),
    };
  },
};
