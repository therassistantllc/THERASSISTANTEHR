import { NextResponse } from "next/server";
import {
  findOrCreateEncounter,
  findOrCreateNote,
  type EncountersSupabase,
} from "@/lib/encounters/findOrCreate";
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

const ADVANCEABLE_STATUSES = new Set(["scheduled"]);

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
      supabase as unknown as EncountersSupabase,
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
      supabase as unknown as EncountersSupabase,
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
