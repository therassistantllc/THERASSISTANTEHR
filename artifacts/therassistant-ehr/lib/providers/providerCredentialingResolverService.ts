import type { BillingProviderInput } from "@/lib/claims/claimReadinessService";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

export interface ResolveProviderCredentialingInput {
  organizationId: string;
  providerId?: string | null;
  renderingProviderId?: string | null;
}

export interface ProviderCredentialingError {
  field: string;
  message: string;
  diagnostic?: Record<string, unknown>;
}

export interface ResolvedProviderCredentialing {
  ok: boolean;
  providerCredentialingProfileId: string | null;
  billingProvider: BillingProviderInput | null;
  renderingProviderNpi: string | null;
  taxonomyCode: string | null;
  errors: ProviderCredentialingError[];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function firstText(row: DbRow | null | undefined, keys: readonly string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

interface ParsedAddress {
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  source: "provider_credentialing_profiles.practice_address" | "provider_credentialing_profiles.structured_columns" | "service_locations" | "none";
  columnsRead?: string[];
}

const STREET_SUFFIXES = new Set([
  "ALY", "AVE", "AVENUE", "BLVD", "BOULEVARD", "CIR", "CIRCLE", "CT", "COURT", "DR", "DRIVE",
  "HWY", "HIGHWAY", "LN", "LANE", "LOOP", "PKWY", "PARKWAY", "PL", "PLACE", "RD", "ROAD",
  "ST", "STREET", "TER", "TERRACE", "TRL", "TRAIL", "WAY",
]);

const UNIT_DESIGNATORS = new Set([
  "APT", "APARTMENT", "BLDG", "BUILDING", "FL", "FLOOR", "STE", "SUITE", "UNIT", "RM", "ROOM", "#",
]);

const PROFILE_ADDRESS_COLUMNS = {
  line1: ["address_line1", "address_line_1", "street", "address", "billing_address", "practice_address_line1", "practice_address_line_1"],
  line2: ["address_line2", "address_line_2", "billing_address2", "practice_address_line2", "practice_address_line_2"],
  city: ["address_city", "city", "practice_city", "billing_city"],
  state: ["address_state", "state", "practice_state", "billing_state"],
  zip: ["address_zip", "zip", "postal_code", "practice_zip", "billing_zip"],
} as const;

const SERVICE_LOCATION_COLUMNS = {
  line1: ["address_line1", "address_line_1", "street", "address"],
  city: ["address_city", "city"],
  state: ["address_state", "state"],
  zip: ["address_zip", "zip", "postal_code"],
} as const;

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseCityStateZip(value: string): { state: string; zip: string; prefix: string } | null {
  const normalized = normalizeSpaces(value.replace(/,/g, " "));
  const match = normalized.match(/^(?:(.*?)\s+)?([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!match) return null;
  return {
    prefix: normalizeSpaces(match[1] ?? ""),
    state: text(match[2]).toUpperCase(),
    zip: text(match[3]),
  };
}

function consumeUnit(words: string[], start: number) {
  const token = words[start]?.replace(/[^A-Za-z#]/g, "").toUpperCase() ?? "";
  if (!UNIT_DESIGNATORS.has(token)) return start;
  let end = start + 1;
  while (end < words.length) {
    const next = words[end] ?? "";
    if (/^[A-Za-z]+$/.test(next) && !/^#/.test(next)) break;
    end += 1;
  }
  return Math.max(end, start + 2);
}

function splitStreetAndCity(prefix: string) {
  const words = prefix.split(" ").filter(Boolean);
  let streetEnd = -1;
  for (let i = 0; i < words.length; i += 1) {
    const normalized = words[i]!.replace(/\W/g, "").toUpperCase();
    if (STREET_SUFFIXES.has(normalized)) streetEnd = i;
  }
  if (streetEnd < 0) return { address1: prefix, city: "" };

  const addressEnd = consumeUnit(words, streetEnd + 1);
  const addressWords = words.slice(0, addressEnd);
  const cityWords = words.slice(addressEnd);
  return {
    address1: addressWords.join(" "),
    city: cityWords.join(" "),
  };
}

function parseStructuredProfileAddress(profile: DbRow): ParsedAddress {
  const address1 = firstText(profile, PROFILE_ADDRESS_COLUMNS.line1);
  const address2 = firstText(profile, PROFILE_ADDRESS_COLUMNS.line2) || null;
  const city = firstText(profile, PROFILE_ADDRESS_COLUMNS.city);
  const state = firstText(profile, PROFILE_ADDRESS_COLUMNS.state).toUpperCase();
  const zip = firstText(profile, PROFILE_ADDRESS_COLUMNS.zip);
  const columnsRead = [
    ...PROFILE_ADDRESS_COLUMNS.line1,
    ...PROFILE_ADDRESS_COLUMNS.line2,
    ...PROFILE_ADDRESS_COLUMNS.city,
    ...PROFILE_ADDRESS_COLUMNS.state,
    ...PROFILE_ADDRESS_COLUMNS.zip,
  ];
  return { address1, address2, city, state, zip, source: "provider_credentialing_profiles.structured_columns", columnsRead };
}

export function parsePracticeAddress(value: unknown): ParsedAddress {
  const raw = text(value);
  if (!raw) return { address1: "", address2: null, city: "", state: "", zip: "", source: "none", columnsRead: ["practice_address"] };

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
        columnsRead: ["practice_address"],
      };
    }
  }

  if (commaParts.length === 2) {
    const cityStateZip = parseCityStateZip(`${commaParts[0]} ${commaParts[1]}`);
    if (cityStateZip) {
      const split = splitStreetAndCity(cityStateZip.prefix);
      return {
        address1: split.address1,
        address2: null,
        city: split.city,
        state: cityStateZip.state,
        zip: cityStateZip.zip,
        source: "provider_credentialing_profiles.practice_address",
        columnsRead: ["practice_address"],
      };
    }
  }

  const cityStateZip = parseCityStateZip(raw);
  if (!cityStateZip) {
    return { address1: raw, address2: null, city: "", state: "", zip: "", source: "provider_credentialing_profiles.practice_address", columnsRead: ["practice_address"] };
  }

  const split = splitStreetAndCity(cityStateZip.prefix);
  return {
    address1: split.address1,
    address2: null,
    city: split.city,
    state: cityStateZip.state,
    zip: cityStateZip.zip,
    source: "provider_credentialing_profiles.practice_address",
    columnsRead: ["practice_address"],
  };
}

function parsedAddressFromServiceLocation(location: DbRow | null): ParsedAddress {
  if (!location) return { address1: "", address2: null, city: "", state: "", zip: "", source: "none", columnsRead: [] };
  return {
    address1: firstText(location, SERVICE_LOCATION_COLUMNS.line1),
    address2: null,
    city: firstText(location, SERVICE_LOCATION_COLUMNS.city),
    state: firstText(location, SERVICE_LOCATION_COLUMNS.state).toUpperCase(),
    zip: firstText(location, SERVICE_LOCATION_COLUMNS.zip),
    source: "service_locations",
    columnsRead: [
      ...SERVICE_LOCATION_COLUMNS.line1,
      ...SERVICE_LOCATION_COLUMNS.city,
      ...SERVICE_LOCATION_COLUMNS.state,
      ...SERVICE_LOCATION_COLUMNS.zip,
    ],
  };
}

function mergeAddress(...addresses: ParsedAddress[]): ParsedAddress {
  const merged: ParsedAddress = { address1: "", address2: null, city: "", state: "", zip: "", source: "none", columnsRead: [] };
  for (const address of addresses) {
    if (!merged.address1 && address.address1) merged.address1 = address.address1;
    if (!merged.address2 && address.address2) merged.address2 = address.address2;
    if (!merged.city && address.city) merged.city = address.city;
    if (!merged.state && address.state) merged.state = address.state;
    if (!merged.zip && address.zip) merged.zip = address.zip;
    if (address.source !== "none" && (!merged.source || merged.source === "none" || (address.address1 && address.city && address.state && address.zip))) {
      merged.source = address.source;
    }
    merged.columnsRead = [...(merged.columnsRead ?? []), ...(address.columnsRead ?? [])];
  }
  return merged;
}

function billingProviderFromProfile(profile: DbRow, fallbackLocation: DbRow | null): BillingProviderInput & { addressSource: ParsedAddress["source"]; columnsRead: string[] } {
  const structuredProfileAddress = parseStructuredProfileAddress(profile);
  const parsedPracticeAddress = parsePracticeAddress(profile.practice_address);
  const serviceLocationAddress = parsedAddressFromServiceLocation(fallbackLocation);
  const parsed = mergeAddress(structuredProfileAddress, parsedPracticeAddress, serviceLocationAddress);

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
    columnsRead: parsed.columnsRead ?? [],
  };
}

async function getDefaultServiceLocation(organizationId: string): Promise<DbRow | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data } = await supabase
    .from("service_locations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as DbRow | null) ?? null;
}

async function getProviderNpiFromLegacySource(providerId: string | null | undefined) {
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

async function findCredentialingProfile(params: {
  organizationId: string;
  providerId?: string | null;
  renderingProviderId?: string | null;
}): Promise<{ profile: DbRow | null; source: string | null }> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const candidateProviderIds = [params.renderingProviderId, params.providerId]
    .map(text)
    .filter(Boolean);

  for (const providerId of candidateProviderIds) {
    const { data, error } = await supabase
      .from("provider_credentialing_profiles")
      .select("*")
      .eq("organization_id", params.organizationId)
      .eq("provider_id", providerId)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return { profile: data as DbRow, source: "provider_credentialing_profiles.provider_id" };
    }
  }

  for (const providerId of candidateProviderIds) {
    const requestedNpi = await getProviderNpiFromLegacySource(providerId);
    if (!requestedNpi) continue;

    const { data, error } = await supabase
      .from("provider_credentialing_profiles")
      .select("*")
      .eq("organization_id", params.organizationId)
      .eq("individual_npi", requestedNpi)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return { profile: data as DbRow, source: "provider_credentialing_profiles.individual_npi_legacy" };
    }
  }

  const { data } = await supabase
    .from("provider_credentialing_profiles")
    .select("*")
    .eq("organization_id", params.organizationId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("provider_name", { ascending: true })
    .limit(1)
    .maybeSingle();

  return { profile: (data as DbRow | null) ?? null, source: data ? "provider_credentialing_profiles.first_active_fallback" : null };
}

function providerDiagnostic(params: {
  organizationId: string;
  providerId?: string | null;
  renderingProviderId?: string | null;
  profile: DbRow | null;
  fallbackLocation: DbRow | null;
  billingProvider: (BillingProviderInput & { addressSource?: string; columnsRead?: string[] }) | null;
  profileSource?: string | null;
}) {
  const profile = params.profile;
  const location = params.fallbackLocation;
  const billingProvider = params.billingProvider;
  return {
    organizationId: params.organizationId,
    providerId: params.providerId ?? null,
    renderingProviderId: params.renderingProviderId ?? null,
    providerCredentialingProfileId: text(profile?.id) || null,
    billingProviderSourceTable: profile ? "provider_credentialing_profiles" : null,
    providerCredentialingMatchSource: params.profileSource ?? null,
    addressSourceTable: billingProvider?.addressSource ?? null,
    fallbackServiceLocationId: text(location?.id) || null,
    fallbackServiceLocationName: text(location?.name) || null,
    practiceAddressPresent: Boolean(text(profile?.practice_address)),
    fieldsResolved: {
      name: Boolean(text(billingProvider?.name)),
      npi: Boolean(text(billingProvider?.npi)),
      taxId: Boolean(text(billingProvider?.taxId)),
      address1: Boolean(text(billingProvider?.address1)),
      city: Boolean(text(billingProvider?.city)),
      state: Boolean(text(billingProvider?.state)),
      zip: Boolean(text(billingProvider?.zip)),
    },
    columnsRead: billingProvider?.columnsRead ?? [],
  };
}

function missingBillingProviderError(params: {
  field: string;
  label: string;
  organizationId: string;
  providerId?: string | null;
  renderingProviderId?: string | null;
  profile: DbRow | null;
  fallbackLocation: DbRow | null;
  billingProvider: BillingProviderInput & { addressSource?: string; columnsRead?: string[] };
  profileSource?: string | null;
}): ProviderCredentialingError {
  const diagnostic = providerDiagnostic(params);
  const locationLabel = diagnostic.fallbackServiceLocationId
    ? `default service location ${diagnostic.fallbackServiceLocationName ?? diagnostic.fallbackServiceLocationId}`
    : "no active service location";
  return {
    field: params.field,
    message: `${params.label} is missing. Resolver checked provider_credentialing_profiles.provider_id, legacy NPI lookup, provider_credentialing_profiles structured address columns, provider_credentialing_profiles.practice_address, and service_locations address columns (${locationLabel}). Add ${params.label.toLowerCase()} to provider credentialing or the default service location before claim creation.`,
    diagnostic,
  };
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

  const { profile, source: profileSource } = await findCredentialingProfile({
    organizationId: input.organizationId,
    providerId: input.providerId ?? null,
    renderingProviderId: input.renderingProviderId ?? null,
  });

  if (!profile) {
    return {
      ok: false,
      providerCredentialingProfileId: null,
      billingProvider: null,
      renderingProviderNpi: null,
      taxonomyCode: null,
      errors: [{
        field: "provider_credentialing_profiles",
        message: "No active provider credentialing profile found for claim billing identity",
        diagnostic: {
          organizationId: input.organizationId,
          providerId: input.providerId ?? null,
          renderingProviderId: input.renderingProviderId ?? null,
          billingProviderSourceTable: "provider_credentialing_profiles",
          providerCredentialingMatchSource: profileSource,
        },
      }],
    };
  }

  const fallbackLocation = await getDefaultServiceLocation(input.organizationId);
  const billingProvider = billingProviderFromProfile(profile, fallbackLocation);
  const errors: ProviderCredentialingError[] = [];
  const baseDiagnostic = { organizationId: input.organizationId, providerId: input.providerId ?? null, renderingProviderId: input.renderingProviderId ?? null, profile, fallbackLocation, billingProvider, profileSource };
  if (!billingProvider.name) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.name", label: "Billing provider name" }));
  if (!billingProvider.npi) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.npi", label: "Billing provider NPI" }));
  if (!billingProvider.taxId) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.tax_id", label: "Billing provider tax ID" }));
  if (!billingProvider.address1) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.address1", label: "Billing provider street address" }));
  if (!billingProvider.city) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.city", label: "Billing provider city" }));
  if (!billingProvider.state) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.state", label: "Billing provider state" }));
  if (!billingProvider.zip) errors.push(missingBillingProviderError({ ...baseDiagnostic, field: "billing_provider.zip", label: "Billing provider ZIP" }));

  return {
    ok: errors.length === 0,
    providerCredentialingProfileId: text(profile.id),
    billingProvider,
    renderingProviderNpi: text(profile.individual_npi) || text(profile.group_npi) || null,
    taxonomyCode: text(profile.taxonomy_code) || null,
    errors,
  };
}
