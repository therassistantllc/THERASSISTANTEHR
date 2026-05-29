import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
const MAX_RANGE_DAYS = 62;
const MAX_LIMIT = 500;

function parseIso(input: string | null) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date;
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
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limitRaw = Number(searchParams.get("limit") ?? "100");
    const offsetRaw = Number(searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;

    if (!from || !to) {
      return NextResponse.json(
        { success: false, error: "from and to (ISO timestamps) are required" },
        { status: 400 },
      );
    }

    const fromDate = parseIso(from);
    const toDate = parseIso(to);
    if (!fromDate || !toDate) {
      return NextResponse.json(
        { success: false, error: "from and to must be valid ISO timestamps" },
        { status: 400 },
      );
    }
    if (toDate <= fromDate) {
      return NextResponse.json(
        { success: false, error: "to must be after from" },
        { status: 400 },
      );
    }

    const spanDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    if (spanDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { success: false, error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` },
        { status: 400 },
      );
    }

    const { data, error } = await (supabase as any).rpc("scheduling_appointments_page", {
      p_organization_id: organizationId,
      p_from: fromDate.toISOString(),
      p_to: toDate.toISOString(),
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error("Appointments list query failed", error);
      return NextResponse.json(
        { success: false, error: "Failed to load appointments" },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    const appointments = rows.map((r) => {
      const apptType = typeof r.appointment_type === "string" ? r.appointment_type : "";
      const cptCode =
        (typeof r.cpt_code === "string" && r.cpt_code) ||
        (/^9\d{4}$/.test(apptType) ? apptType : null);

      return {
        id: String(r.id),
        clientId: r.client_id ? String(r.client_id) : null,
        clientName: String(r.client_name ?? "Unknown client"),
        providerId: r.provider_id ? String(r.provider_id) : null,
        providerName: String(r.provider_name ?? "Unassigned"),
        scheduledStartAt: r.scheduled_start_at,
        scheduledEndAt: r.scheduled_end_at,
        status: r.appointment_status,
        appointmentType: r.appointment_type,
        cptCode,
      };
    });

    return NextResponse.json({
      success: true,
      organizationId,
      from,
      to,
      pagination: {
        limit,
        offset,
        returned: appointments.length,
        totalCount,
        hasMore: offset + appointments.length < totalCount,
      },
      appointments,
    });
  } catch (err) {
    console.error("Appointments API error", err);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load appointments",
      },
      { status: 500 },
    );
  }
}
