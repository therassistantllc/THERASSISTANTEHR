import { NextRequest, NextResponse } from "next/server";
import { requireRoleInRoute } from "@/lib/rbac/middleware";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/lib/rbac/constants";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(_request: NextRequest) {
  const authOrError = await requireRoleInRoute(STAFF_ROLES.ADMIN);
  if (authOrError instanceof NextResponse) return authOrError;

  const { organizationId } = authOrError;
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }

  const { data: clinicianRole, error: roleError } = await supabase
    .from("staff_roles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("role_code", "clinician")
    .is("archived_at", null)
    .maybeSingle();
  if (roleError) {
    return NextResponse.json({ success: false, error: roleError.message }, { status: 500 });
  }
  if (!clinicianRole?.id) {
    return NextResponse.json(
      { success: false, error: "Clinician role is not configured for this organization." },
      { status: 400 },
    );
  }

  const { data: providerRows, error: providerError } = await supabase
    .from("providers")
    .select("id, user_id, first_name, last_name, email, provider_type, is_active")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .eq("is_active", true)
    .in("provider_type", ["clinician", "provider", "therapist"]);
  if (providerError) {
    return NextResponse.json({ success: false, error: providerError.message }, { status: 500 });
  }

  const providers = ((providerRows ?? []) as DbRow[])
    .map((row) => ({
      id: text(row.id),
      userId: text(row.user_id),
      firstName: text(row.first_name),
      lastName: text(row.last_name),
      email: text(row.email) || null,
    }))
    .filter((row) => row.userId);

  if (providers.length === 0) {
    return NextResponse.json({ success: true, created: 0, roleAssigned: 0, skipped: 0 });
  }

  const authUserIds = [...new Set(providers.map((p) => p.userId))];

  const { data: existingStaffRows, error: staffReadError } = await supabase
    .from("staff_profiles")
    .select("id, auth_user_id")
    .eq("organization_id", organizationId)
    .in("auth_user_id", authUserIds)
    .is("archived_at", null);
  if (staffReadError) {
    return NextResponse.json({ success: false, error: staffReadError.message }, { status: 500 });
  }

  const staffIdByAuthUserId = new Map<string, string>();
  for (const row of (existingStaffRows ?? []) as DbRow[]) {
    const authUserId = text(row.auth_user_id);
    const staffId = text(row.id);
    if (authUserId && staffId) staffIdByAuthUserId.set(authUserId, staffId);
  }

  let created = 0;
  let skipped = 0;

  for (const provider of providers) {
    if (staffIdByAuthUserId.has(provider.userId)) continue;

    const insertPayload = {
      organization_id: organizationId,
      auth_user_id: provider.userId,
      first_name: provider.firstName || null,
      last_name: provider.lastName || null,
      email: provider.email,
      is_active: true,
      staff_status: "active",
    };

    const { data: inserted, error: insertError } = await supabase
      .from("staff_profiles")
      .insert(insertPayload)
      .select("id, auth_user_id")
      .single();

    if (insertError || !inserted?.id) {
      skipped += 1;
      continue;
    }

    created += 1;
    staffIdByAuthUserId.set(text(inserted.auth_user_id), text(inserted.id));
  }

  const allStaffIds = [...new Set(Array.from(staffIdByAuthUserId.values()).filter(Boolean))];

  let roleAssigned = 0;
  if (allStaffIds.length > 0) {
    const { data: existingRoleRows, error: existingRoleError } = await supabase
      .from("staff_role_assignments")
      .select("staff_id")
      .eq("organization_id", organizationId)
      .eq("staff_role_id", text(clinicianRole.id))
      .in("staff_id", allStaffIds)
      .is("archived_at", null);
    if (existingRoleError) {
      return NextResponse.json({ success: false, error: existingRoleError.message }, { status: 500 });
    }

    const hasRole = new Set(((existingRoleRows ?? []) as DbRow[]).map((row) => text(row.staff_id)).filter(Boolean));
    const toAssign = allStaffIds.filter((staffId) => !hasRole.has(staffId));

    if (toAssign.length > 0) {
      const rows = toAssign.map((staffId) => ({
        organization_id: organizationId,
        staff_id: staffId,
        staff_role_id: text(clinicianRole.id),
        assigned_at: new Date().toISOString(),
      }));

      const { error: assignError } = await supabase.from("staff_role_assignments").insert(rows);
      if (assignError) {
        return NextResponse.json({ success: false, error: assignError.message }, { status: 500 });
      }
      roleAssigned = toAssign.length;
    }
  }

  return NextResponse.json({
    success: true,
    created,
    roleAssigned,
    skipped,
    totalLinkedClinicians: allStaffIds.length,
  });
}
