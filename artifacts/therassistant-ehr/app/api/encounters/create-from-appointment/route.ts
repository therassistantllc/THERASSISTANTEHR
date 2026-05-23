import { NextResponse } from "next/server";
import {
  findOrCreateEncounter,
  type EncountersSupabase,
  type FindOrCreateAppointment,
} from "@/lib/encounters/findOrCreate";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const body = await request.json();
    const appointmentId = body.appointmentId ? String(body.appointmentId) : "";
    const organizationId = body.organizationId ? String(body.organizationId) : "";

    if (!appointmentId || !organizationId) {
      return NextResponse.json({ success: false, error: "appointmentId and organizationId are required" }, { status: 400 });
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from("appointments")
      .select("id, organization_id, client_id, provider_id, scheduled_start_at, scheduled_end_at")
      .eq("organization_id", organizationId)
      .eq("id", appointmentId)
      .is("archived_at", null)
      .maybeSingle();

    if (appointmentError || !appointment) return NextResponse.json({ success: false, error: "Appointment not found" }, { status: 404 });
    if (!appointment.client_id) return NextResponse.json({ success: false, error: "Appointment is missing client_id" }, { status: 422 });

    const nowIso = new Date().toISOString();

    // Route through the shared find-or-create helper so concurrent retries
    // (double-click, second tab, network retry) deterministically converge on
    // the same encounter row instead of inserting a duplicate.
    const result = await findOrCreateEncounter(
      supabase as unknown as EncountersSupabase,
      organizationId,
      appointmentId,
      appointment as FindOrCreateAppointment,
      nowIso,
    );

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, encounterId: result.encounterId, created: result.created });
  } catch (error) {
    console.error("Create encounter from appointment API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Create encounter failed" },
      { status: 500 },
    );
  }
}
