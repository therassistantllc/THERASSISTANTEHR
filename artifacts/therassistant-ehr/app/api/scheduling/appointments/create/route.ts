import crypto from "crypto";
import { NextResponse } from "next/server";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { addMonthsKeepingClock, checkProviderAvailability } from "@/lib/scheduling/core";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
import { getDefaultCaseForClient } from "@/lib/cases/clientCasesService";

type RecurrenceFrequency = "none" | "weekly" | "biweekly" | "monthly";
type RecurrenceEndMode = "by_date" | "by_count";
type ServiceLocationKind = "office" | "telehealth";
type DbRow = Record<string, unknown>;

function generateUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null) {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [e.message, e.details, e.hint, e.code].map(text).filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }
  return "Appointment creation failed";
}

function buildOccurrenceStarts(
  firstStart: Date,
  frequency: RecurrenceFrequency,
  endMode: RecurrenceEndMode,
  endDate: string | null,
  sessionCount: number | null,
) {
  if (frequency === "none") return [firstStart];

  const starts: Date[] = [];
  const hardLimit = 260;
  const normalizedCount = Number.isFinite(sessionCount ?? NaN) ? Math.max(1, Number(sessionCount)) : null;
  const until = endDate ? new Date(endDate) : null;
  if (until && !Number.isNaN(until.getTime())) until.setHours(23, 59, 59, 999);

  for (let index = 0; index < hardLimit; index += 1) {
    let nextStart: Date;
    if (index === 0) {
      nextStart = new Date(firstStart);
    } else if (frequency === "weekly") {
      nextStart = new Date(firstStart);
      nextStart.setDate(firstStart.getDate() + index * 7);
    } else if (frequency === "biweekly") {
      nextStart = new Date(firstStart);
      nextStart.setDate(firstStart.getDate() + index * 14);
    } else {
      nextStart = addMonthsKeepingClock(firstStart, index);
    }

    if (until && nextStart > until) break;
    starts.push(nextStart);
    if (endMode === "by_count" && normalizedCount && starts.length >= normalizedCount) break;
  }

  return starts;
}

async function findCredentialingProfileForRosterProvider(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  rosterProvider: DbRow;
}) {
  const { supabase, organizationId, rosterProvider } = params;
  const npi = text(rosterProvider.npi);
  const providerName = text(rosterProvider.display_name) || [rosterProvider.first_name, rosterProvider.last_name].map(text).filter(Boolean).join(" ");
  const email = text(rosterProvider.email);

  if (npi) {
    const { data } = await supabase
      .from("provider_credentialing_profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("individual_npi", npi)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  if (email) {
    const { data } = await supabase
      .from("provider_credentialing_profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", email)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  if (providerName) {
    const { data } = await supabase
      .from("provider_credentialing_profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider_name", providerName)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  return null;
}

async function resolveProviderId(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  providerSelector: string;
}) {
  const { supabase, organizationId, providerSelector } = params;
  if (!providerSelector) return null;

  const { data: credentialingById } = await supabase
    .from("provider_credentialing_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", providerSelector)
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle();
  if (credentialingById?.id) return String(credentialingById.id);

  const { data: providerById } = await supabase
    .from("providers")
    .select("id, first_name, last_name, display_name, email, npi")
    .eq("organization_id", organizationId)
    .eq("id", providerSelector)
    .is("archived_at", null)
    .maybeSingle();
  if (providerById) {
    const credentialingId = await findCredentialingProfileForRosterProvider({
      supabase,
      organizationId,
      rosterProvider: providerById as DbRow,
    });
    if (credentialingId) return credentialingId;
  }

  const { data: providerByUser } = await supabase
    .from("providers")
    .select("id, first_name, last_name, display_name, email, npi")
    .eq("organization_id", organizationId)
    .eq("user_id", providerSelector)
    .is("archived_at", null)
    .maybeSingle();
  if (providerByUser) {
    const credentialingId = await findCredentialingProfileForRosterProvider({
      supabase,
      organizationId,
      rosterProvider: providerByUser as DbRow,
    });
    if (credentialingId) return credentialingId;
  }

  const { data: staffById } = await supabase
    .from("staff_profiles")
    .select("id, auth_user_id, first_name, last_name, email")
    .eq("organization_id", organizationId)
    .eq("id", providerSelector)
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle();

  const { data: staffByAuthUserId } = staffById
    ? { data: null }
    : await supabase
        .from("staff_profiles")
        .select("id, auth_user_id, first_name, last_name, email")
        .eq("organization_id", organizationId)
        .eq("auth_user_id", providerSelector)
        .eq("is_active", true)
        .is("archived_at", null)
        .maybeSingle();

  const staff = staffById ?? staffByAuthUserId;
  if (staff) {
    const staffEmail = text(staff.email);
    const staffName = [staff.first_name, staff.last_name].map(text).filter(Boolean).join(" ");

    if (staffEmail) {
      const { data } = await supabase
        .from("provider_credentialing_profiles")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("email", staffEmail)
        .eq("is_active", true)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (data?.id) return String(data.id);
    }

    if (staffName) {
      const { data } = await supabase
        .from("provider_credentialing_profiles")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("provider_name", staffName)
        .eq("is_active", true)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (data?.id) return String(data.id);
    }
  }

  return null;
}

async function resolveProviderLocationId(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  serviceLocation: ServiceLocationKind;
}) {
  const { supabase, organizationId, serviceLocation } = params;
  const locationType = serviceLocation === "telehealth" ? "telehealth" : "office";

  const { data: byType } = await supabase
    .from("service_locations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("location_type", locationType)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (byType?.id) return String(byType.id);

  const { data: fallback } = await supabase
    .from("service_locations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  return fallback?.id ? String(fallback.id) : null;
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseServiceRoleClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Service role key is required for appointment writes." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as {
      organizationId?: string;
      clientId?: string;
      providerId?: string;
      insurancePolicyId?: string | null;
      caseId?: string | null;
      scheduledStartAt?: string;
      durationMinutes?: number;
      appointmentType?: string;
      memo?: string | null;
      serviceLocation?: ServiceLocationKind;
      internalNote?: string | null;
      reminderEmailEnabled?: boolean;
      reminderSmsEnabled?: boolean;
      reminderPortalEnabled?: boolean;
      reminderLeadHours?: number;
      recurrence?: {
        frequency?: RecurrenceFrequency;
        endMode?: RecurrenceEndMode;
        endDate?: string | null;
        sessionCount?: number | null;
      };
    };

    const guard = await requireOrgAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const clientId = text(body.clientId);
    const providerSelector = text(body.providerId);
    const scheduledStartAt = text(body.scheduledStartAt);
    const durationMinutes = Math.max(15, Number(body.durationMinutes ?? 60));
    const appointmentType = text(body.appointmentType);
    const memoRaw = typeof body.memo === "string" ? body.memo.trim() : "";
    const memo = memoRaw.length > 0 ? memoRaw : null;
    const internalNoteRaw = typeof body.internalNote === "string" ? body.internalNote.trim() : "";
    const internalNote = internalNoteRaw.length > 0 ? internalNoteRaw : null;
    const serviceLocation = body.serviceLocation ?? (appointmentType.toLowerCase().includes("tele") ? "telehealth" : "office");

    if (!clientId || !providerSelector || !scheduledStartAt || !appointmentType) {
      return NextResponse.json(
        { success: false, error: "Client, provider, start time, and classification are required." },
        { status: 400 },
      );
    }

    const providerId = await resolveProviderId({ supabase, organizationId, providerSelector });
    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Selected provider could not be resolved to an active provider credentialing profile." },
        { status: 400 },
      );
    }

    const providerLocationId = await resolveProviderLocationId({ supabase, organizationId, serviceLocation });
    if (!providerLocationId) {
      return NextResponse.json(
        { success: false, error: `No active ${serviceLocation} service location is configured for this organization.` },
        { status: 400 },
      );
    }

    const firstStart = new Date(scheduledStartAt);
    if (Number.isNaN(firstStart.getTime())) {
      return NextResponse.json({ success: false, error: "Invalid start time." }, { status: 400 });
    }

    if (firstStart.getMinutes() % 15 !== 0) {
      return NextResponse.json({ success: false, error: "Appointments must start on 15-minute intervals." }, { status: 400 });
    }

    const recurrenceFrequency: RecurrenceFrequency = body.recurrence?.frequency ?? "none";
    const recurrenceEndMode: RecurrenceEndMode = body.recurrence?.endMode ?? "by_count";
    const recurrenceEndDate = body.recurrence?.endDate ?? null;
    const recurrenceSessionCount = body.recurrence?.sessionCount ?? (recurrenceFrequency === "none" ? 1 : 12);

    const starts = buildOccurrenceStarts(
      firstStart,
      recurrenceFrequency,
      recurrenceEndMode,
      recurrenceEndDate,
      recurrenceSessionCount,
    );

    const seriesId = recurrenceFrequency === "none" ? null : generateUuid();
    const now = new Date().toISOString();

    let resolvedCaseId: string | null = body.caseId ?? null;
    if (!resolvedCaseId) {
      const defaultCase = await getDefaultCaseForClient({ organizationId, clientId });
      resolvedCaseId = defaultCase?.id ?? null;
    }

    const { data: profile } = await supabase
      .from("provider_credentialing_profiles")
      .select("telehealth_url")
      .eq("organization_id", organizationId)
      .eq("id", providerId)
      .is("archived_at", null)
      .maybeSingle();
    const providerTelehealthUrl = (profile as { telehealth_url?: string | null } | null)?.telehealth_url ?? null;

    if (seriesId) {
      const { error: seriesError } = await supabase.from("appointment_series").insert({
        id: seriesId,
        organization_id: organizationId,
        provider_id: providerId,
        client_id: clientId,
        recurrence_frequency: recurrenceFrequency,
        recurrence_interval: recurrenceFrequency === "biweekly" ? 2 : 1,
        ends_on: recurrenceEndDate,
        session_count: recurrenceSessionCount,
        created_at: now,
        updated_at: now,
      });
      if (seriesError && !String(seriesError.message).includes("appointment_series")) throw seriesError;
    }

    const reminderLeadHours = Math.max(1, Number(body.reminderLeadHours ?? 24));
    const reminderEmailEnabled = Boolean(body.reminderEmailEnabled);
    const reminderSmsEnabled = Boolean(body.reminderSmsEnabled);
    const reminderPortalEnabled = body.reminderPortalEnabled !== false;
    const createdRows: Array<{ id: string; scheduled_start_at: string; telehealth_url?: string | null }> = [];

    for (let index = 0; index < starts.length; index += 1) {
      const startAt = starts[index];
      const endAt = new Date(startAt);
      endAt.setMinutes(endAt.getMinutes() + durationMinutes);

      const availability = await checkProviderAvailability({
        supabase,
        organizationId,
        providerId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        location: serviceLocation,
      });

      if (!availability.available) {
        return NextResponse.json(
          {
            success: false,
            error: `Availability check failed for occurrence ${index + 1}.`,
            reasonCodes: availability.reasonCodes,
            reasons: availability.reasons,
          },
          { status: 409 },
        );
      }

      const teleUrl = serviceLocation === "telehealth" ? providerTelehealthUrl : null;
      const appointmentId = generateUuid();
      const appointmentPayload = {
        id: appointmentId,
        organization_id: organizationId,
        client_id: clientId,
        provider_id: providerId,
        provider_credentialing_profile_id: providerId,
        provider_location_id: providerLocationId,
        insurance_policy_id: body.insurancePolicyId ?? null,
        case_id: resolvedCaseId,
        scheduled_start_at: startAt.toISOString(),
        scheduled_end_at: endAt.toISOString(),
        appointment_status: "scheduled",
        appointment_type: appointmentType,
        service_location: serviceLocation,
        memo,
        internal_note: internalNote,
        telehealth_url: teleUrl,
        reminder_email_enabled: reminderEmailEnabled,
        reminder_sms_enabled: reminderSmsEnabled,
        reminder_portal_enabled: reminderPortalEnabled,
        reminder_lead_hours: reminderLeadHours,
        created_at: now,
        updated_at: now,
      };

      const { error: appointmentError } = await supabase.from("appointments").insert(appointmentPayload);
      if (appointmentError) throw appointmentError;

      createdRows.push({
        id: appointmentId,
        scheduled_start_at: startAt.toISOString(),
        ...(teleUrl ? { telehealth_url: teleUrl } : {}),
      });

      const reminderChannels = [
        reminderEmailEnabled ? "email" : null,
        reminderSmsEnabled ? "sms" : null,
        reminderPortalEnabled ? "portal" : null,
      ].filter(Boolean) as string[];

      if (reminderChannels.length > 0) {
        const scheduledFor = new Date(startAt);
        scheduledFor.setHours(scheduledFor.getHours() - reminderLeadHours);
        const reminderRows = reminderChannels.map((channel) => ({
          id: generateUuid(),
          organization_id: organizationId,
          appointment_id: appointmentId,
          channel,
          scheduled_for: scheduledFor.toISOString(),
          reminder_status: "scheduled",
          payload: {
            appointmentType,
            serviceLocation,
            memo,
            leadHours: reminderLeadHours,
            telehealthUrl: teleUrl,
          },
          created_at: now,
          updated_at: now,
        }));

        const { error: reminderError } = await supabase.from("appointment_reminders").insert(reminderRows);
        if (reminderError && !String(reminderError.message).includes("appointment_reminders")) throw reminderError;
      }
    }

    return NextResponse.json({
      success: true,
      seriesId,
      occurrencesCreated: createdRows.length,
      appointments: createdRows,
    });
  } catch (error) {
    console.error("[POST /api/scheduling/appointments/create]", error);
    return NextResponse.json(
      {
        success: false,
        error: formatError(error),
      },
      { status: 500 },
    );
  }
}
