import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

const ENHANCED_SELECT = "id, scheduled_start_at, scheduled_end_at, appointment_status, appointment_type, memo, service_location, check_in_at, client_arrival_status, client_arrival_status_at, check_in_review_needed, check_in_review_reason, check_in_answers, cancelled_at, cancellation_reason, provider_id, insurance_policy_id, created_at";
const BASE_SELECT = "id, scheduled_start_at, scheduled_end_at, appointment_status, appointment_type, memo, check_in_at, cancelled_at, cancellation_reason, provider_id, insurance_policy_id, created_at";

function isMissingColumnError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

async function fetchClientAppointments(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  clientId: string;
}) {
  const { supabase, organizationId, clientId } = params;
  const baseQuery = (selectColumns: string) =>
    supabase
      .from("appointments")
      .select(selectColumns)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .is("archived_at", null)
      .order("scheduled_start_at", { ascending: false })
      .limit(50);

  const enhanced = await baseQuery(ENHANCED_SELECT);
  if (!enhanced.error) return enhanced;
  if (!isMissingColumnError(enhanced.error)) return enhanced;

  console.warn("Enhanced appointment check-in columns are not available yet; using base client appointment select.");
  return baseQuery(BASE_SELECT);
}

export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });

    const { clientId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data: appointments, error } = await fetchClientAppointments({ supabase, organizationId, clientId });

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    const apptIds = (appointments ?? []).map((a: DbRow) => a.id as string);

    const { data: encounters } = apptIds.length > 0
      ? await supabase
          .from("encounters")
          .select("id, appointment_id, encounter_status, service_date")
          .in("appointment_id", apptIds)
          .is("archived_at", null)
      : { data: [] as DbRow[] };

    const encounterByAppt: Record<string, DbRow> = {};
    for (const enc of (encounters ?? [])) {
      if (enc.appointment_id) encounterByAppt[enc.appointment_id as string] = enc;
    }

    const items = (appointments ?? []).map((appt: DbRow) => ({
      id: appt.id as string,
      scheduledStart: appt.scheduled_start_at as string | null,
      scheduledEnd: appt.scheduled_end_at as string | null,
      status: appt.appointment_status as string | null,
      type: appt.appointment_type as string | null,
      memo: appt.memo as string | null,
      serviceLocation: (appt.service_location ?? null) as string | null,
      checkedInAt: appt.check_in_at as string | null,
      arrivalStatus: (appt.client_arrival_status ?? null) as string | null,
      arrivalStatusAt: (appt.client_arrival_status_at ?? null) as string | null,
      checkInReviewNeeded: Boolean(appt.check_in_review_needed),
      checkInReviewReason: (appt.check_in_review_reason ?? null) as string | null,
      checkInAnswers: (appt.check_in_answers ?? null) as Record<string, unknown> | null,
      cancelledAt: appt.cancelled_at as string | null,
      cancellationReason: appt.cancellation_reason as string | null,
      providerId: appt.provider_id as string | null,
      insurancePolicyId: appt.insurance_policy_id as string | null,
      createdAt: appt.created_at as string | null,
      encounter: encounterByAppt[appt.id as string]
        ? {
            id: encounterByAppt[appt.id as string].id as string,
            status: encounterByAppt[appt.id as string].encounter_status as string | null,
            serviceDate: encounterByAppt[appt.id as string].service_date as string | null,
          }
        : null,
    }));

    return NextResponse.json({ success: true, appointments: items, total: items.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load appointments" },
      { status: 500 },
    );
  }
}
