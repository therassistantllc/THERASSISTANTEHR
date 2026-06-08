import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

export interface Assignee {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  roles: string[];
  isAppointmentProvider: boolean;
}

const text = (v: unknown) => String(v ?? "").trim();

function displayName(row: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  id: string;
}): string {
  const name = [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
  return name || text(row.email) || text(row.id);
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
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const kind = (searchParams.get("kind") || "").toLowerCase();
    const appointmentId = text(searchParams.get("appointmentId"));
    if (kind !== "clinician" && kind !== "admin") {
      return NextResponse.json(
        { success: false, error: "kind must be 'clinician' or 'admin'" },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };

    // Resolve role ids for the requested kind. We look up either "clinician"
    // (for route_to_clinician) or "admin" + "supervisor" (for route_to_admin —
    // supervisors are billing-capable admins in practice).
    const roleCodes = kind === "clinician" ? ["clinician"] : ["admin", "supervisor"];
    const { data: roleRows } = await sb
      .from("staff_roles")
      .select("id, role_code")
      .eq("organization_id", organizationId)
      .in("role_code", roleCodes)
      .is("archived_at", null);
    const roleIds = ((roleRows as Array<{ id: string }> | null) ?? []).map((r) => text(r.id));

    let staffIds: string[] = [];
    if (roleIds.length) {
      const { data: assignments } = await sb
        .from("staff_role_assignments")
        .select("staff_id")
        .eq("organization_id", organizationId)
        .in("staff_role_id", roleIds)
        .is("archived_at", null);
      staffIds = [
        ...new Set(
          ((assignments as Array<{ staff_id: string }> | null) ?? [])
            .map((a) => text(a.staff_id))
            .filter(Boolean),
        ),
      ];
    }

    // Pull the staff_profiles in one go (plus any provider-linked staff if a
    // clinician request gave us an appointmentId).
    let extraStaffIds: string[] = [];
    let providerStaffId: string | null = null;
    if (kind === "clinician" && appointmentId) {
      const { data: appt } = await sb
        .from("appointments")
        .select("provider_id")
        .eq("id", appointmentId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      const providerId = appt ? text((appt as Record<string, unknown>).provider_id) : "";
      if (providerId) {
        const { data: provider } = await sb
          .from("providers")
          .select("user_id")
          .eq("id", providerId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        const authUserId = provider
          ? text((provider as Record<string, unknown>).user_id)
          : "";
        if (authUserId) {
          const { data: linkedStaff } = await sb
            .from("staff_profiles")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("auth_user_id", authUserId)
            .is("archived_at", null)
            .maybeSingle();
          if (linkedStaff) {
            providerStaffId = text((linkedStaff as Record<string, unknown>).id);
            if (providerStaffId) extraStaffIds.push(providerStaffId);
          }
        }
      }
    }

    const allIds = [...new Set([...staffIds, ...extraStaffIds])];
    if (allIds.length === 0) {
      return NextResponse.json({ success: true, assignees: [] });
    }

    const { data: staffRows, error: staffErr } = await sb
      .from("staff_profiles")
      .select("id, first_name, last_name, email, job_title, is_active")
      .eq("organization_id", organizationId)
      .in("id", allIds)
      .is("archived_at", null);
    if (staffErr) {
      return NextResponse.json(
        { success: false, error: staffErr.message ?? "Failed to load assignees" },
        { status: 500 },
      );
    }

    const rows = ((staffRows as Array<Record<string, unknown>> | null) ?? [])
      .filter((r) => r.is_active !== false);

    // Per-staff role list (for display + so admin-kind callers can see whether
    // the user is also a supervisor, etc).
    const roleMap = new Map<string, string[]>();
    if (rows.length) {
      const { data: allAssignments } = await sb
        .from("staff_role_assignments")
        .select("staff_id, staff_role_id")
        .eq("organization_id", organizationId)
        .in(
          "staff_id",
          rows.map((r) => text(r.id)),
        )
        .is("archived_at", null);
      const { data: allRoles } = await sb
        .from("staff_roles")
        .select("id, role_code")
        .eq("organization_id", organizationId)
        .is("archived_at", null);
      const roleCodeById = new Map<string, string>(
        ((allRoles as Array<{ id: string; role_code: string }> | null) ?? []).map((r) => [
          text(r.id),
          text(r.role_code),
        ]),
      );
      for (const a of (allAssignments as Array<{ staff_id: string; staff_role_id: string }> | null) ?? []) {
        const sid = text(a.staff_id);
        const code = roleCodeById.get(text(a.staff_role_id));
        if (!sid || !code) continue;
        const list = roleMap.get(sid) ?? [];
        if (!list.includes(code)) list.push(code);
        roleMap.set(sid, list);
      }
    }

    const assignees: Assignee[] = rows
      .map((r) => {
        const id = text(r.id);
        return {
          id,
          name: displayName({
            first_name: r.first_name as string | null,
            last_name: r.last_name as string | null,
            email: r.email as string | null,
            id,
          }),
          email: (r.email as string | null) ?? null,
          jobTitle: (r.job_title as string | null) ?? null,
          roles: roleMap.get(id) ?? [],
          isAppointmentProvider: id === providerStaffId,
        };
      })
      .sort((a, b) => {
        if (a.isAppointmentProvider !== b.isAppointmentProvider) {
          return a.isAppointmentProvider ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ success: true, assignees });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
