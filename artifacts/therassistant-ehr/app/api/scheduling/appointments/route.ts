import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
const MAX_RANGE_DAYS = 62;
const MAX_LIMIT = 500;

const ENHANCED_APPOINTMENT_SELECT =
  "id, client_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_status, appointment_type, service_location, cpt_code, check_in_at, client_arrival_status, client_arrival_status_at, check_in_review_needed, check_in_review_reason";

const BASE_APPOINTMENT_SELECT =
  "id, client_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_status, appointment_type, cpt_code, check_in_at";

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
  service_location?: string | null;
  cpt_code: string | null;
  check_in_at?: string | null;
  client_arrival_status?: string | null;
  client_arrival_status_at?: string | null;
  check_in_review_needed?: boolean | null;
  check_in_review_reason?: string | null;
};

type ClientNameRow = { first_name?: string | null; last_name?: string | null };
type ProviderCredentialingRow = { provider_name?: string | null; credential_display?: string | null };

function displayProviderName(provider: ProviderCredentialingRow | null | undefined) {
  if (!provider) return "Unassigned";
  const name = String(provider.provider_name ?? "").trim();
  const credential = String(provider.credential_display ?? "").trim();
  if (name && credential && !name.includes(credential)) return `${name}, ${credential}`;
  return name || "Unassigned";
}

function calendarStatus(row: AppointmentRow): string {
  const raw = String(row.appointment_status ?? "scheduled");
  if (raw === "scheduled" && row.check_in_at) return "checked_in";
  return raw;
}

function mapRows(params: {
  rows: AppointmentRow[];
  clientById: Map<string, ClientNameRow>;
  providerById: Map<string, ProviderCredentialingRow>;
}) {
  const { rows, clientById, providerById } = params;
  return rows.map((r) => {
    const client = r.client_id ? clientById.get(r.client_id) : null;
    const provider = r.provider_id ? providerById.get(r.provider_id) : null;
    const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(" ").trim() || "Unknown client";
    const providerName = displayProviderName(provider);

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
      status: calendarStatus(r),
      appointmentType: r.appointment_type,
      serviceLocation: r.service_location ?? null,
      cptCode,
      checkInAt: r.check_in_at ?? null,
      arrivalStatus: r.client_arrival_status ?? null,
      arrivalStatusAt: r.client_arrival_status_at ?? null,
      checkInReviewNeeded: Boolean(r.check_in_review_needed),
      checkInReviewReason: r.check_in_review_reason ?? null,
    };
  });
}

function isMissingColumnError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

async function fetchAppointmentRows(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  fromIso: string;
  toIso: string;
  offset: number;
  limit: number;
}) {
  const { supabase, organizationId, fromIso, toIso, offset, limit } = params;
  const baseQuery = (selectColumns: string) =>
    supabase
      .from("appointments")
      .select(selectColumns)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .gte("scheduled_start_at", fromIso)
      .lt("scheduled_start_at", toIso)
      .order("scheduled_start_at", { ascending: true })
      .range(offset, offset + limit - 1);

  const enhanced = await baseQuery(ENHANCED_APPOINTMENT_SELECT);
  if (!enhanced.error) return enhanced;
  if (!isMissingColumnError(enhanced.error)) return enhanced;

  console.warn("Enhanced appointment check-in columns are not available yet; using base appointment select.");
  return baseQuery(BASE_APPOINTMENT_SELECT);
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

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    const [{ count, error: countError }, rowsResult] = await Promise.all([
      (supabase as any)
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .gte("scheduled_start_at", fromIso)
        .lt("scheduled_start_at", toIso),
      fetchAppointmentRows({ supabase, organizationId, fromIso, toIso, offset, limit }),
    ]);

    if (countError) throw countError;
    if (rowsResult.error) throw rowsResult.error;

    const rows = (rowsResult.data ?? []) as AppointmentRow[];
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter((id): id is string => Boolean(id))));
    const providerIds = Array.from(new Set(rows.map((r) => r.provider_id).filter((id): id is string => Boolean(id))));

    const [clientsResult, providersResult] = await Promise.all([
      clientIds.length > 0
        ? (supabase as any).from("clients").select("id, first_name, last_name").in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),
      providerIds.length > 0
        ? (supabase as any)
            .from("provider_credentialing_profiles")
            .select("id, provider_name, credential_display")
            .in("id", providerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (clientsResult.error) throw clientsResult.error;
    if (providersResult.error) throw providersResult.error;

    const clientById = new Map<string, ClientNameRow>(
      (clientsResult.data ?? []).map((c: any) => [String(c.id), c]),
    );
    const providerById = new Map<string, ProviderCredentialingRow>(
      (providersResult.data ?? []).map((p: any) => [String(p.id), p]),
    );

    const appointments = mapRows({ rows, clientById, providerById });
    const totalCount = Number(count ?? 0);

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
