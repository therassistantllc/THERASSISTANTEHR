import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
const CREDENTIALING_SELECT =
  "id, provider_name, credential_display, individual_npi, email, practice_name, practice_address, practice_tax_id, group_npi, group_medicaid_id, phone, taxonomy_code, individual_medicaid_id, caqh_id, other_payer_id, primary_license_number, primary_license_effective_date, payer_effective_date, payer_revalidation_date, secondary_license_number, secondary_license_effective_date, telehealth_url, stripe_payment_link_url, default_telehealth_platform, stripe_connect_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements, stripe_account_status_updated_at, is_active, updated_at";

const CREDENTIALING_SELECT_FALLBACK =
  "id, provider_name, credential_display, individual_npi, email, practice_name, practice_address, practice_tax_id, group_npi, group_medicaid_id, phone, taxonomy_code, individual_medicaid_id, caqh_id, other_payer_id, primary_license_number, primary_license_effective_date, payer_effective_date, payer_revalidation_date, secondary_license_number, secondary_license_effective_date, is_active, updated_at";

const MIGRATION_HINT =
  "Apply the 20260521000000_provider_telehealth_stripe migration to restore telehealth_url and stripe_payment_link_url columns.";

function isMissingTelehealthColumns(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code ?? "";
  const message = String((error as { message?: string }).message ?? "");
  if (code !== "42703") return false;
  return /telehealth_url|stripe_payment_link_url|default_telehealth_platform|stripe_connect_account_id|stripe_charges_enabled|stripe_payouts_enabled|stripe_details_submitted|stripe_requirements|stripe_account_status_updated_at/i.test(message);
}

const NUCC_TAXONOMY_RE = /^[A-Z0-9]{9}X$/;

function normalizeTaxonomyCode(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const raw = String(value).trim().toUpperCase();
  if (raw === "") return { ok: true, value: null };
  if (!NUCC_TAXONOMY_RE.test(raw)) {
    return {
      ok: false,
      error: "taxonomy_code must be a 10-character NUCC code (9 alphanumerics + trailing 'X'), e.g. 103TC0700X",
    };
  }
  return { ok: true, value: raw };
}

// Mirror a freshly-saved taxonomy code into the matching provider_profiles
// row (matched by NPI within the same organization). The Provider
// Enrollment Issues workqueue and the 837P writer read from
// provider_profiles.taxonomy_code, so the credentialing UI must propagate
// it whenever a biller enters/edits a value.
async function syncTaxonomyToProviderProfiles(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  individualNpi: string | null,
  taxonomyCode: string | null,
): Promise<void> {
  if (!supabase || !individualNpi) return;
  const npi = individualNpi.replace(/\D/g, "");
  if (npi.length !== 10) return;
  const { error } = await supabase
    .from("provider_profiles")
    .update({ taxonomy_code: taxonomyCode, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("provider_npi", npi)
    .is("archived_at", null);
  if (error) console.warn("[provider_profiles taxonomy] dual-write failed:", error.message);
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { first_name: "Unknown", last_name: "Provider" };
  const stripped = trimmed.replace(/,.*$/, "").trim();
  const parts = stripped.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

async function upsertProvidersRoster(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  organizationId: string,
  payload: {
    provider_name: string;
    credential_display: string | null;
    individual_npi: string | null;
    taxonomy_code: string | null;
    email: string | null;
    phone: string | null;
    individual_medicaid_id: string | null;
    is_active: boolean;
  },
) {
  if (!supabase) return;
  const { first_name, last_name } = splitName(payload.provider_name);
  const baseFields = {
    display_name: payload.provider_name.trim() || `${first_name} ${last_name}`.trim(),
    credential: payload.credential_display,
    email: payload.email,
    phone: payload.phone,
    npi: payload.individual_npi,
    taxonomy_code: payload.taxonomy_code,
    medicaid_id: payload.individual_medicaid_id,
    is_active: payload.is_active,
  };

  let existing: { id: string } | null = null;
  if (payload.individual_npi) {
    const npiLookup = await supabase
      .from("providers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("npi", payload.individual_npi)
      .is("archived_at", null)
      .maybeSingle();
    existing = (npiLookup.data as { id: string } | null) ?? null;
  }
  if (!existing) {
    const nameLookup = await supabase
      .from("providers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("display_name", baseFields.display_name)
      .is("archived_at", null)
      .maybeSingle();
    existing = (nameLookup.data as { id: string } | null) ?? null;
  }

  if (existing) {
    const upd = await supabase
      .from("providers")
      .update({ ...baseFields, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("organization_id", organizationId);
    if (upd.error) console.warn("[providers roster] update failed:", upd.error.message);
  } else {
    const ins = await supabase
      .from("providers")
      .insert({
        organization_id: organizationId,
        first_name,
        last_name,
        provider_type: "clinician",
        ...baseFields,
      });
    if (ins.error) console.warn("[providers roster] insert failed:", ins.error.message);
  }
}

function withNullExtras<T extends Record<string, unknown>>(row: T): T & {
  telehealth_url: string | null;
  stripe_payment_link_url: string | null;
  default_telehealth_platform: string | null;
  stripe_connect_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_requirements: unknown;
  stripe_account_status_updated_at: string | null;
} {
  return {
    ...row,
    telehealth_url: (row.telehealth_url as string | null | undefined) ?? null,
    stripe_payment_link_url: (row.stripe_payment_link_url as string | null | undefined) ?? null,
    default_telehealth_platform: (row.default_telehealth_platform as string | null | undefined) ?? null,
    stripe_connect_account_id: (row.stripe_connect_account_id as string | null | undefined) ?? null,
    stripe_charges_enabled: Boolean(row.stripe_charges_enabled),
    stripe_payouts_enabled: Boolean(row.stripe_payouts_enabled),
    stripe_details_submitted: Boolean(row.stripe_details_submitted),
    stripe_requirements: row.stripe_requirements ?? null,
    stripe_account_status_updated_at: (row.stripe_account_status_updated_at as string | null | undefined) ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const initial = await supabase
      .from("provider_credentialing_profiles")
      .select(CREDENTIALING_SELECT)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("practice_name", { ascending: true })
      .order("provider_name", { ascending: true });

    let data: unknown[] | null = (initial.data as unknown[] | null) ?? null;
    if (initial.error) {
      if (!isMissingTelehealthColumns(initial.error)) throw initial.error;
      console.warn(`[provider credentialing] telehealth_url/stripe_payment_link_url columns missing; degrading gracefully. ${MIGRATION_HINT}`);
      const fallback = await supabase
        .from("provider_credentialing_profiles")
        .select(CREDENTIALING_SELECT_FALLBACK)
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("practice_name", { ascending: true })
        .order("provider_name", { ascending: true });
      if (fallback.error) throw fallback.error;
      data = (fallback.data as unknown[] | null) ?? null;
    }

    const providers = (data ?? []).map((row) => withNullExtras(row as Record<string, unknown>));
    return NextResponse.json({ success: true, organizationId, providers });
  } catch (error) {
    console.error("Provider credentialing API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Provider credentialing API failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const body = (await request.json()) as Record<string, unknown>;
    if (!body.provider_name) {
      return NextResponse.json({ success: false, error: "provider_name is required" }, { status: 400 });
    }

    const taxonomyParsed = normalizeTaxonomyCode(body.taxonomy_code);
    if (!taxonomyParsed.ok) {
      return NextResponse.json({ success: false, error: taxonomyParsed.error }, { status: 400 });
    }

    const now = new Date().toISOString();
    const baseInsert: Record<string, unknown> = {
      organization_id: organizationId,
      source: String(body.source ?? "manual"),
      provider_name: String(body.provider_name),
      credential_display: body.credential_display ? String(body.credential_display) : null,
      individual_npi: body.individual_npi ? String(body.individual_npi) : null,
      email: body.email ? String(body.email) : null,
      practice_name: body.practice_name ? String(body.practice_name) : null,
      practice_address: body.practice_address ? String(body.practice_address) : null,
      practice_tax_id: body.practice_tax_id ? String(body.practice_tax_id) : null,
      group_npi: body.group_npi ? String(body.group_npi) : null,
      group_medicaid_id: body.group_medicaid_id ? String(body.group_medicaid_id) : null,
      individual_medicaid_id: body.individual_medicaid_id ? String(body.individual_medicaid_id) : null,
      phone: body.phone ? String(body.phone) : null,
      taxonomy_code: taxonomyParsed.value,
      caqh_id: body.caqh_id ? String(body.caqh_id) : null,
      other_payer_id: body.other_payer_id ? String(body.other_payer_id) : null,
      primary_license_number: body.primary_license_number ? String(body.primary_license_number) : null,
      primary_license_effective_date: body.primary_license_effective_date
        ? String(body.primary_license_effective_date) : null,
      secondary_license_number: body.secondary_license_number ? String(body.secondary_license_number) : null,
      secondary_license_effective_date: body.secondary_license_effective_date
        ? String(body.secondary_license_effective_date) : null,
      payer_effective_date: body.payer_effective_date ? String(body.payer_effective_date) : null,
      payer_revalidation_date: body.payer_revalidation_date ? String(body.payer_revalidation_date) : null,
      is_active: Boolean(body.is_active ?? true),
      created_at: now,
      updated_at: now,
    };
    const extras: Record<string, unknown> = {};
    if ("telehealth_url" in body) extras.telehealth_url = body.telehealth_url ? String(body.telehealth_url) : null;
    if ("stripe_payment_link_url" in body) extras.stripe_payment_link_url = body.stripe_payment_link_url ? String(body.stripe_payment_link_url) : null;

    const attempt = await supabase
      .from("provider_credentialing_profiles")
      .insert({ ...baseInsert, ...extras })
      .select(CREDENTIALING_SELECT)
      .single();

    let data: unknown = attempt.data;
    if (attempt.error) {
      if (!isMissingTelehealthColumns(attempt.error)) throw attempt.error;
      console.warn(`[provider credentialing] telehealth_url/stripe_payment_link_url columns missing on insert; degrading gracefully. ${MIGRATION_HINT}`);
      const fallback = await supabase
        .from("provider_credentialing_profiles")
        .insert(baseInsert)
        .select(CREDENTIALING_SELECT_FALLBACK)
        .single();
      if (fallback.error) throw fallback.error;
      data = fallback.data as typeof data;
    }

    const row = data as Record<string, unknown>;
    try {
      await upsertProvidersRoster(supabase, organizationId, {
        provider_name: String(row.provider_name ?? body.provider_name ?? ""),
        credential_display: (row.credential_display as string | null) ?? null,
        individual_npi: (row.individual_npi as string | null) ?? null,
        taxonomy_code: (row.taxonomy_code as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        individual_medicaid_id: (row.individual_medicaid_id as string | null) ?? null,
        is_active: row.is_active !== false,
      });
    } catch (rosterError) {
      console.warn("[providers roster] dual-write skipped:", rosterError);
    }
    try {
      await syncTaxonomyToProviderProfiles(
        supabase,
        organizationId,
        (row.individual_npi as string | null) ?? null,
        (row.taxonomy_code as string | null) ?? null,
      );
    } catch (err) {
      console.warn("[provider_profiles taxonomy] dual-write skipped:", err);
    }

    return NextResponse.json({ success: true, provider: withNullExtras(row) }, { status: 201 });
  } catch (error) {
    console.error("Provider credentialing POST error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create credentialing profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    const allowedFields = [
      "provider_name", "credential_display", "individual_npi", "email",
      "practice_name", "practice_address", "practice_tax_id", "group_npi",
      "group_medicaid_id", "individual_medicaid_id", "phone", "taxonomy_code",
      "caqh_id", "other_payer_id", "primary_license_number",
      "primary_license_effective_date", "secondary_license_number",
      "secondary_license_effective_date", "payer_effective_date",
      "payer_revalidation_date", "telehealth_url", "stripe_payment_link_url",
      "is_active",
    ] as const;
    const extrasFields = new Set(["telehealth_url", "stripe_payment_link_url"]);

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }
    if ("taxonomy_code" in updates) {
      const taxonomyParsed = normalizeTaxonomyCode(updates.taxonomy_code);
      if (!taxonomyParsed.ok) {
        return NextResponse.json({ success: false, error: taxonomyParsed.error }, { status: 400 });
      }
      updates.taxonomy_code = taxonomyParsed.value;
    }
    updates.updated_at = new Date().toISOString();

    const attempt = await supabase
      .from("provider_credentialing_profiles")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .select(CREDENTIALING_SELECT)
      .single();

    let data: unknown = attempt.data;
    if (attempt.error) {
      if (!isMissingTelehealthColumns(attempt.error)) throw attempt.error;
      console.warn(`[provider credentialing] telehealth_url/stripe_payment_link_url columns missing on update; degrading gracefully. ${MIGRATION_HINT}`);
      const safeUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (!extrasFields.has(key)) safeUpdates[key] = value;
      }
      const fallback = await supabase
        .from("provider_credentialing_profiles")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select(CREDENTIALING_SELECT_FALLBACK)
        .single();
      if (fallback.error) throw fallback.error;
      data = fallback.data as typeof data;
    }

    const row = data as Record<string, unknown>;
    try {
      await upsertProvidersRoster(supabase, organizationId, {
        provider_name: String(row.provider_name ?? ""),
        credential_display: (row.credential_display as string | null) ?? null,
        individual_npi: (row.individual_npi as string | null) ?? null,
        taxonomy_code: (row.taxonomy_code as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        individual_medicaid_id: (row.individual_medicaid_id as string | null) ?? null,
        is_active: row.is_active !== false,
      });
    } catch (rosterError) {
      console.warn("[providers roster] dual-write skipped:", rosterError);
    }
    try {
      await syncTaxonomyToProviderProfiles(
        supabase,
        organizationId,
        (row.individual_npi as string | null) ?? null,
        (row.taxonomy_code as string | null) ?? null,
      );
    } catch (err) {
      console.warn("[provider_profiles taxonomy] dual-write skipped:", err);
    }

    return NextResponse.json({ success: true, provider: withNullExtras(row) });
  } catch (error) {
    console.error("Provider credentialing PATCH error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update credentialing profile" },
      { status: 500 },
    );
  }
}
