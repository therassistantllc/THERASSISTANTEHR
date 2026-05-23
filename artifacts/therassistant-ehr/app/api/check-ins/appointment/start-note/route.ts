import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type AppointmentRow = {
  id: string;
  organization_id: string;
  client_id: string | null;
  provider_id: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  appointment_status: string | null;
};

type SupabaseClient = ReturnType<typeof createServerSupabaseAdminClient>;

const ADVANCEABLE_STATUSES = new Set(["scheduled"]);

// Postgres unique-violation; if a concurrent request beat us to the insert,
// the existing row is the right answer and we just re-select it.
const UNIQUE_VIOLATION = "23505";

async function findOrCreateEncounter(
  supabase: NonNullable<SupabaseClient>,
  organizationId: string,
  appointmentId: string,
  appt: AppointmentRow,
  nowIso: string,
): Promise<
  | { ok: true; encounterId: string; created: boolean; clientId: string; providerId: string | null }
  | { ok: false; status: number; error: string }
> {
  const selectExisting = async () =>
    supabase
      .from("encounters")
      .select("id, client_id, provider_id")
      .eq("organization_id", organizationId)
      .eq("appointment_id", appointmentId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

  const { data: existing, error: existingError } = await selectExisting();
  if (existingError) {
    return { ok: false, status: 500, error: `Failed to look up encounter: ${existingError.message}` };
  }
  if (existing?.id) {
    return {
      ok: true,
      encounterId: String(existing.id),
      created: false,
      clientId: (existing.client_id as string | null) ?? (appt.client_id as string),
      providerId: (existing.provider_id as string | null) ?? appt.provider_id,
    };
  }

  const serviceDate = appt.scheduled_start_at
    ? new Date(appt.scheduled_start_at).toISOString().slice(0, 10)
    : nowIso.slice(0, 10);

  const { data: inserted, error: insertError } = await supabase
    .from("encounters")
    .insert({
      organization_id: organizationId,
      client_id: appt.client_id,
      provider_id: appt.provider_id,
      appointment_id: appointmentId,
      encounter_status: "draft",
      service_date: serviceDate,
      required_billing_fields_complete: false,
      started_at: appt.scheduled_start_at ?? null,
      ended_at: appt.scheduled_end_at ?? null,
    })
    .select("id, client_id, provider_id")
    .single();

  if (!insertError && inserted) {
    return {
      ok: true,
      encounterId: String(inserted.id),
      created: true,
      clientId: (inserted.client_id as string | null) ?? (appt.client_id as string),
      providerId: (inserted.provider_id as string | null) ?? appt.provider_id,
    };
  }

  // Race: another request inserted between our SELECT and INSERT. Re-select.
  if (insertError && (insertError as { code?: string }).code === UNIQUE_VIOLATION) {
    const { data: raceRow } = await selectExisting();
    if (raceRow?.id) {
      return {
        ok: true,
        encounterId: String(raceRow.id),
        created: false,
        clientId: (raceRow.client_id as string | null) ?? (appt.client_id as string),
        providerId: (raceRow.provider_id as string | null) ?? appt.provider_id,
      };
    }
  }

  return {
    ok: false,
    status: 422,
    error: `Failed to create encounter: ${insertError?.message ?? "unknown error"}`,
  };
}

async function findOrCreateNote(
  supabase: NonNullable<SupabaseClient>,
  organizationId: string,
  encounterId: string,
  clientId: string,
  providerId: string | null,
  nowIso: string,
): Promise<
  | { ok: true; noteId: string; created: boolean }
  | { ok: false; status: number; error: string }
> {
  const selectExisting = async () =>
    supabase
      .from("encounter_clinical_notes")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

  const { data: existing, error: existingError } = await selectExisting();
  if (existingError) {
    return { ok: false, status: 500, error: `Failed to look up clinical note: ${existingError.message}` };
  }
  if (existing?.id) {
    return { ok: true, noteId: String(existing.id), created: false };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("encounter_clinical_notes")
    .insert({
      organization_id: organizationId,
      encounter_id: encounterId,
      client_id: clientId,
      provider_id: providerId,
      note_status: "draft",
      subjective: "",
      interventions: "",
      plan: "",
      signed_at: null,
      signed_by_user_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return { ok: true, noteId: String(inserted.id), created: true };
  }

  if (insertError && (insertError as { code?: string }).code === UNIQUE_VIOLATION) {
    const { data: raceRow } = await selectExisting();
    if (raceRow?.id) {
      return { ok: true, noteId: String(raceRow.id), created: false };
    }
  }

  return {
    ok: false,
    status: 422,
    error: `Failed to create clinical note: ${insertError?.message ?? "unknown error"}`,
  };
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const appointmentId = body.appointmentId ? String(body.appointmentId) : "";
    const organizationId = body.organizationId ? String(body.organizationId) : "";

    if (!appointmentId || !organizationId) {
      return NextResponse.json(
        { success: false, error: "appointmentId and organizationId are required" },
        { status: 400 },
      );
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from("appointments")
      .select("id, organization_id, client_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_status")
      .eq("organization_id", organizationId)
      .eq("id", appointmentId)
      .is("archived_at", null)
      .maybeSingle();

    if (appointmentError || !appointment) {
      return NextResponse.json({ success: false, error: "Appointment not found" }, { status: 404 });
    }

    const appt = appointment as AppointmentRow;
    if (!appt.client_id) {
      return NextResponse.json(
        { success: false, error: "Appointment is missing a client; assign a client before checking in." },
        { status: 422 },
      );
    }

    const nowIso = new Date().toISOString();

    // Important: do encounter + note creation BEFORE flipping appointment_status.
    // If either fails, status stays at 'scheduled' so the next click can retry
    // cleanly with no half-checked-in state.
    const encounterResult = await findOrCreateEncounter(
      supabase,
      organizationId,
      appointmentId,
      appt,
      nowIso,
    );
    if (!encounterResult.ok) {
      return NextResponse.json(
        { success: false, error: encounterResult.error },
        { status: encounterResult.status },
      );
    }

    const noteResult = await findOrCreateNote(
      supabase,
      organizationId,
      encounterResult.encounterId,
      encounterResult.clientId,
      encounterResult.providerId,
      nowIso,
    );
    if (!noteResult.ok) {
      return NextResponse.json(
        { success: false, error: noteResult.error },
        { status: noteResult.status },
      );
    }

    // Only now advance status (and only from 'scheduled' so we don't regress
    // in_progress / completed / etc.). If this fails after encounter/note are
    // created, the retry just re-uses the existing rows and finishes the flip.
    let appointmentStatus = appt.appointment_status ?? "scheduled";
    if (ADVANCEABLE_STATUSES.has(appointmentStatus)) {
      const { error: statusError } = await supabase
        .from("appointments")
        .update({ appointment_status: "checked_in", updated_at: nowIso })
        .eq("organization_id", organizationId)
        .eq("id", appointmentId)
        .eq("appointment_status", "scheduled");
      if (statusError) {
        return NextResponse.json(
          { success: false, error: `Failed to update appointment status: ${statusError.message}` },
          { status: 500 },
        );
      }
      appointmentStatus = "checked_in";
    }

    return NextResponse.json({
      success: true,
      appointmentId,
      appointmentStatus,
      encounterId: encounterResult.encounterId,
      encounterCreated: encounterResult.created,
      noteId: noteResult.noteId,
      noteCreated: noteResult.created,
      noteUrl: `/encounters/${encounterResult.encounterId}`,
    });
  } catch (error) {
    console.error("Check-in start-note API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Check-in failed",
      },
      { status: 500 },
    );
  }
}
