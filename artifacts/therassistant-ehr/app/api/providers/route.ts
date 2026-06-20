import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function isMissingRelation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code === "42P01";
}

function isSchemaDrift(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && ["42703", "PGRST200", "PGRST204"].includes(code);
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: credentialingRows, error: credentialingError } = await supabase
      .from("provider_credentialing_profiles")
      .select("id, provider_name, credential_display, individual_npi, email, is_active")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .order("provider_name", { ascending: true });

    if (credentialingError && !isMissingRelation(credentialingError) && !isSchemaDrift(credentialingError)) {
      console.warn("provider_credentialing_profiles lookup failed; falling back to providers", credentialingError);
    }

    if (!credentialingError) {
      const credentialingProviders = ((credentialingRows ?? []) as Record<string, unknown>[]).map((row) => {
        const providerName = clean(row.provider_name) || "Unnamed provider";
        return {
          id: clean(row.id),
          provider_name: providerName,
          display_name: providerName,
          credential_display: clean(row.credential_display) || null,
          npi: clean(row.individual_npi) || null,
          is_active: row.is_active !== false,
          user_id: null,
          email: clean(row.email) || null,
          credentialing_profile_id: clean(row.id),
          source: "provider_credentialing_profiles",
        };
      });

      if (credentialingProviders.length > 0) {
        return NextResponse.json({ success: true, organizationId, providers: credentialingProviders });
      }
    }

    const { data, error } = await supabase
      .from("providers")
      .select("id, first_name, last_name, display_name, credential, npi, provider_type, is_active, user_id, email")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    let providerRows = (data ?? []) as Record<string, unknown>[];

    if (error && !isMissingRelation(error) && !isSchemaDrift(error)) {
      console.warn("providers lookup failed; falling back to staff_profiles", error);
    }

    if (error || providerRows.length === 0) {
      const { data: staff, error: staffError } = await supabase
        .from("staff_profiles")
        .select("auth_user_id, first_name, last_name, email")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .is("archived_at", null)
        .not("auth_user_id", "is", null)
        .order("first_name", { ascending: true });

      if (!staffError) {
        providerRows = ((staff ?? []) as Record<string, unknown>[]).map((row) => ({
          id: clean(row.auth_user_id),
          first_name: clean(row.first_name),
          last_name: clean(row.last_name),
          display_name: [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" "),
          credential: null,
          npi: null,
          provider_type: "clinician",
          is_active: true,
          user_id: clean(row.auth_user_id),
          email: clean(row.email) || null,
        }));
      } else if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 422 });
      }
    }

    const providers = providerRows.map((row: Record<string, unknown>) => {
      const first = clean(row.first_name);
      const last = clean(row.last_name);
      const display = clean(row.display_name) || [first, last].filter(Boolean).join(" ");
      return {
        id: clean(row.id),
        provider_name: display || "Unnamed provider",
        display_name: display || "Unnamed provider",
        credential_display: clean(row.credential) || null,
        npi: clean(row.npi) || null,
        is_active: row.is_active !== false,
        user_id: clean(row.user_id) || null,
        email: clean(row.email) || null,
        credentialing_profile_id: null,
        source: "providers",
      };
    });

    return NextResponse.json({ success: true, organizationId, providers });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
