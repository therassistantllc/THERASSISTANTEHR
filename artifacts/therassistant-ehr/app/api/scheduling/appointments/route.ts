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

type AppointmentRow = {
  id: string;
  client_id: string | null;
  provider_id: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  appointment_status: string | null;
  appointment_type: string | null;
  cpt_code: string | null;
};

async function listAppointmentsFallback(params: {
  supabase: any;
  organizationId: string;
  fromIso: string;
  toIso: string;
  limit: number;
  offset: number;
}) {
  const { supabase, organizationId, fromIso, toIso, limit, offset } = params;

  const [{ count, error: countError }, { data: appointmentRows, error: appointmentsError }] = await Promise.all([
    (supabase as any)
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .gte("scheduled_start_at", fromIso)
      .lt("scheduled_start_at", toIso),
    (supabase as any)
      .from("appointments")
      .select(
        "id, client_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_status, appointment_type, cpt_code",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .gte("scheduled_start_at", fromIso)
      .lt("scheduled_start_at", toIso)
      .order("scheduled_start_at", { ascending: true })
      .range(offset, offset + limit - 1),
  ]);

  if (countError) throw countError;
  if (appointmentsError) throw appointmentsError;

  const rows = (appointmentRows ?? []) as AppointmentRow[];
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter((id): id is string => Boolean(id))));
  const providerIds = Array.from(new Set(rows.map((r) => r.provider_id).filter((id): id is string => Boolean(id))));

  const [clientsResult, providersResult] = await Promise.all([
    clientIds.length > 0
      ? (supabase as any).from("clients").select("id, first_name, last_name").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
    providerIds.length > 0
      ? (supabase as any)
          .from("providers")
          .select("id, display_name, first_name, last_name")
          .in("id", providerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (clientsResult.error) throw clientsResult.error;
  if (providersResult.error) throw providersResult.error;

  const clientById = new Map<string, { first_name?: string | null; last_name?: string | null }>(
    (clientsResult.data ?? []).map((c: any) => [String(c.id), c]),
  );
  const providerById = new Map<string, { display_name?: string | null; first_name?: string | null; last_name?: string | null }>(
    (providersResult.data ?? []).map((p: any) => [String(p.id), p]),
  );

  const appointments = rows.map((r) => {
    const client = r.client_id ? clientById.get(r.client_id) : null;
    const provider = r.provider_id ? providerById.get(r.provider_id) : null;
    const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(" ").trim() || "Unknown client";
    const providerName =
      provider?.display_name?.trim() ||
      [provider?.first_name, provider?.last_name].filter(Boolean).join(" ").trim() ||
      "Unassigned";

    const apptType = typeof r.appointment_type === "string" ? r.appointment_type : "";
    const cptCode =
      (typeof r.cpt_code === "string" && r.cpt_code) ||
      (/^9\d{4}$/.test(apptType) ? apptType : null);

    return {
      id: String(r.id),
      clientId: r.client_id ? String(r.client_id) : null,
      clientName,
      providerId: r.provider_id ? String(r.provider_id) : null,
      providerName,
      scheduledStartAt: r.scheduled_start_at,
      scheduledEndAt: r.scheduled_end_at,
      status: r.appointment_status,
      appointmentType: r.appointment_type,
      cptCode,
    };
  });

  return {
    appointments,
    totalCount: Number(count ?? 0),
  };
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
      const errorCode = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
      const isRpcMissing = errorCode === "PGRST202";
      if (!isRpcMissing) {
        console.error("Appointments list query failed", error);
        return NextResponse.json(
          { success: false, error: "Failed to load appointments" },
          { status: 500 },
        );
      }

      console.warn("scheduling_appointments_page RPC not available; using fallback query path");
      const fallback = await listAppointmentsFallback({
        supabase,
        organizationId,
        fromIso: fromDate.toISOString(),
        toIso: toDate.toISOString(),
        limit,
        offset,
      });

      return NextResponse.json({
        success: true,
        organizationId,
        from,
        to,
        pagination: {
          limit,
          offset,
          returned: fallback.appointments.length,
          totalCount: fallback.totalCount,
          hasMore: offset + fallback.appointments.length < fallback.totalCount,
        },
        appointments: fallback.appointments,
      });
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
