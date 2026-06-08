import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

function isMissingRelation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code === "42P01";
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data, error } = await supabase
      .from("providers")
      .select("id, first_name, last_name, display_name, credential, npi, provider_type, is_active, user_id, email")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    let providerRows = (data ?? []) as Record<string, unknown>[];

    if (error && !isMissingRelation(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    if (providerRows.length === 0) {
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
      }
    }

    const providers = providerRows.map((row: Record<string, unknown>) => {
      const first = String(row.first_name ?? "").trim();
      const last = String(row.last_name ?? "").trim();
      const display = String(row.display_name ?? "").trim() || [first, last].filter(Boolean).join(" ");
      return {
        id: String(row.id),
        provider_name: display || "Unnamed provider",
        credential_display: row.credential ? String(row.credential) : null,
        npi: row.npi ? String(row.npi) : null,
        is_active: row.is_active !== false,
        user_id: row.user_id ? String(row.user_id) : null,
        email: row.email ? String(row.email) : null,
      };
    });

    return NextResponse.json({ success: true, organizationId, providers });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
