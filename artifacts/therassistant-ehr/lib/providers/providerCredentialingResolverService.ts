import type { BillingProviderInput } from "@/lib/claims/claimReadinessService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

export interface ResolveProviderCredentialingInput {
  organizationId: string;
  providerId?: string | null;
  renderingProviderId?: string | null;
}

export interface ResolvedProviderCredentialing {
  ok: boolean;
  providerCredentialingProfileId: string | null;
  billingProvider: BillingProviderInput | null;
  renderingProviderNpi: string | null;
  taxonomyCode: string | null;
  errors: Array<{ field: string; message: string }>;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

interface ParsedAddress {
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  source: "provider_credentialing_profiles.practice_address" | "service_locations" | "none";
}

const STREET_SUFFIXES = new Set([
  "ALY", "AVE", "AVENUE", "BLVD", "BOULEVARD", "CIR", "CIRCLE", "CT", "COURT", "DR", "DRIVE",
  "HWY", "HIGHWAY", "LN", "LANE", "LOOP", "PKWY", "PARKWAY", "PL", "PLACE", "RD", "ROAD",
  "ST", "STREET", "TER", "TERRACE", "TRL", "TRAIL", "WAY",
]);

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseCityStateZip(value: string): { city: string; state: string; zip: string; prefix: string } | null {
  const normalized = normalizeSpaces(value.replace(/,/g, " "));
  const match = normalized.match(/^(?:(.*?)\s+)?([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!match) return null;
  return {
    prefix: normalizeSpaces(match[1] ?? ""),
    city: "",
    state: text(match[2]).toUpperCase(),
    zip: text(match[3]),
  };
}

export function parsePracticeAddress(value: unknown): ParsedAddress {
  const raw = text(value);
  if (!raw) return { address1: "", address2: null, city: "", state: "", zip: "", source: "none" };

  const commaParts = raw.split(",").map(normalizeSpaces).filter(Boolean);
  if (commaParts.length >= 3) {
    const cityStateZip = parseCityStateZip(commaParts[commaParts.length - 1] ?? "");
    if (cityStateZip) {
      const city = commaParts[commaParts.length - 2] ?? "";
      const addressParts = commaParts.slice(0, -2);
      return {
        address1: addressParts[0] ?? "",
        address2: addressParts.length > 1 ? addressParts.slice(1).join(", ") : null,
        city,
        state: cityStateZip.state,
        zip: cityStateZip.zip,
        source: "provider_credentialing_profiles.practice_address",
      };
    }
  }

  const cityStateZip = parseCityStateZip(raw);
  if (!cityStateZip) {
    return { address1: raw, address2: null, city: "", state: "", zip: "", source: "provider_credentialing_profiles.practice_address" };
  }

  const words = cityStateZip.prefix.split(" ").filter(Boolean);
  let streetEnd = -1;
  for (let i = 0; i < words.length; i += 1) {
    if (STREET_SUFFIXES.has(words[i]!.replace(/\W/g, "").toUpperCase())) streetEnd = i;
  }

  if (streetEnd >= 0 && streetEnd < words.length - 1) {
    return {
      address1: words.slice(0, streetEnd + 1).join(" "),
      address2: null,
      city: words.slice(streetEnd + 1).join(" "),
      state: cityStateZip.state,
      zip: cityStateZip.zip,
      source: "provider_credentialing_profiles.practice_address",
    };
  }

  return {
    address1: cityStateZip.prefix,
    address2: null,
    city: "",
    state: cityStateZip.state,
    zip: cityStateZip.zip,
    source: "provider_credentialing_profiles.practice_address",
  };
}

function parsedAddressFromServiceLocation(location: DbRow | null): ParsedAddress {
  if (!location) return { address1: "", address2: null, city: "", state: "", zip: "", source: "none" };
  return {
    address1: text(location.address_line1),
    address2: null,
    city: text(location.address_city),
    state: text(location.address_state).toUpperCase(),
    zip: text(location.address_zip),
    source: "service_locations",
  };
}

function mergeAddress(primary: ParsedAddress, fallback: ParsedAddress): ParsedAddress {
  return {
    address1: primary.address1 || fallback.address1,
    address2: primary.address2 ?? fallback.address2,
    city: primary.city || fallback.city,
    state: primary.state || fallback.state,
    zip: primary.zip || fallback.zip,
    source: primary.address1 && primary.city && primary.state && primary.zip ? primary.source : fallback.source,
  };
}

function billingProviderFromProfile(profile: DbRow, fallbackLocation: DbRow | null): BillingProviderInput & { addressSource: ParsedAddress["source"] } {
  const parsed = mergeAddress(parsePracticeAddress(profile.practice_address), parsedAddressFromServiceLocation(fallbackLocation));

  return {
    name: text(profile.practice_name),
    npi: text(profile.group_npi) || text(profile.individual_npi),
    taxId: text(profile.practice_tax_id),
    taxIdType: "EI",
    address1: parsed.address1,
    address2: parsed.address2,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    addressSource: parsed.source,
  };
}

async function getDefaultServiceLocation(organizationId: string): Promise<DbRow | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data } = await supabase
    .from("service_locations")
    .select("id, name, address_line1, address_city, address_state, address_zip, is_default")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as DbRow | null) ?? null;
}

async function getProviderNpiFromStaffId(organizationId: string, providerId: string | null | undefined) {
  if (!providerId) return null;
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const possibleTables = ["providers", "staff", "profiles"];
  for (const table of possibleTables) {
    const { data, error } = await supabase
      .from(table)
      .select("id, npi, individual_npi")
      .eq("id", providerId)
      .limit(1)
      .maybeSingle();

    if (!error && data) return text((data as DbRow).npi) || text((data as DbRow).individual_npi) || null;
  }

  return null;
}

export async function resolveProviderCredentialingProfile(
  input: ResolveProviderCredentialingInput,
): Promise<ResolvedProviderCredentialing> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      providerCredentialingProfileId: null,
      billingProvider: null,
      renderingProviderNpi: null,
      taxonomyCode: null,
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const requestedNpi = await getProviderNpiFromStaffId(
    input.organizationId,
    input.renderingProviderId ?? input.providerId ?? null,
  );

  let profile: DbRow | null = null;
  if (requestedNpi) {
    const { data } = await supabase
      .from("provider_credentialing_profiles")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("individual_npi", requestedNpi)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    profile = (data as DbRow | null) ?? null;
  }

  if (!profile) {
    const { data } = await supabase
      .from("provider_credentialing_profiles")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("provider_name", { ascending: true })
      .limit(1)
      .maybeSingle();
    profile = (data as DbRow | null) ?? null;
  }

  if (!profile) {
    return {
      ok: false,
      providerCredentialingProfileId: null,
      billingProvider: null,
      renderingProviderNpi: null,
      taxonomyCode: null,
      errors: [{ field: "provider_credentialing_profiles", message: "No active provider credentialing profile found" }],
    };
  }

  const fallbackLocation = await getDefaultServiceLocation(input.organizationId);
  const billingProvider = billingProviderFromProfile(profile, fallbackLocation);
  const errors: Array<{ field: string; message: string }> = [];
  if (!billingProvider.name) errors.push({ field: "billing_provider.name", message: "Practice name is missing" });
  if (!billingProvider.npi) errors.push({ field: "billing_provider.npi", message: "Group or individual NPI is missing" });
  if (!billingProvider.taxId) errors.push({ field: "billing_provider.tax_id", message: "Practice tax ID is missing" });
  const addressSource = billingProvider.addressSource === "service_locations"
    ? "service_locations default/first active location"
    : "provider_credentialing_profiles.practice_address";
  if (!billingProvider.address1) errors.push({ field: "billing_provider.address1", message: `Billing provider street address is missing in ${addressSource}` });
  if (!billingProvider.city) errors.push({ field: "billing_provider.city", message: `Billing provider city is missing in ${addressSource}` });
  if (!billingProvider.state) errors.push({ field: "billing_provider.state", message: `Billing provider state is missing in ${addressSource}` });
  if (!billingProvider.zip) errors.push({ field: "billing_provider.zip", message: `Billing provider ZIP is missing in ${addressSource}` });

  return {
    ok: errors.length === 0,
    providerCredentialingProfileId: text(profile.id),
    billingProvider,
    renderingProviderNpi: text(profile.individual_npi) || null,
    taxonomyCode: text(profile.taxonomy_code) || null,
    errors,
  };
}
