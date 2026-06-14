import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

type Row = Record<string, unknown>;
type CheckInAction = "on_my_way" | "arrived" | "complete_check_in";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isYes(value: unknown): boolean {
  return text(value).toLowerCase() === "yes";
}

function cleanAnswer(value: unknown, max = 500): string {
  return text(value).slice(0, max);
}

function appointmentMode(value: unknown): "telehealth" | "office" {
  return /telehealth|video|virtual|remote/i.test(text(value)) ? "telehealth" : "office";
}

function mapAppointment(row: Row) {
  return {
    id: text(row.id),
    status: text(row.appointment_status || "scheduled"),
    checkInAt: row.check_in_at ?? null,
    arrivalStatus: text(row.client_arrival_status || "none"),
    arrivalStatusAt: row.client_arrival_status_at ?? null,
    checkInReviewNeeded: Boolean(row.check_in_review_needed),
    checkInReviewReason: row.check_in_review_reason ?? null,
    checkInAnswers: row.check_in_answers ?? {},
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ clientId: string; appointmentId: string }> },
) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { clientId, appointmentId } = await context.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const body = (await request.json().catch(() => null)) as Row | null;
    const action = text(body?.action) as CheckInAction;
    if (!["on_my_way", "arrived", "complete_check_in"].includes(action)) {
      return NextResponse.json({ success: false, error: "Unsupported check-in action" }, { status: 400 });
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from("appointments")
      .select("id, appointment_status, service_location")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("id", appointmentId)
      .is("archived_at", null)
      .maybeSingle();

    if (appointmentError || !appointment) {
      return NextResponse.json({ success: false, error: "Appointment not found" }, { status: 404 });
    }

    const currentStatus = text((appointment as Row).appointment_status || "scheduled");
    if (["cancelled", "no_show", "completed"].includes(currentStatus)) {
      return NextResponse.json({ success: false, error: "This appointment is already closed." }, { status: 409 });
    }

    const now = new Date().toISOString();

    if (action === "on_my_way" || action === "arrived") {
      if (appointmentMode((appointment as Row).service_location) === "telehealth") {
        return NextResponse.json({ success: false, error: "Arrival buttons are only for in-person appointments." }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("appointments")
        .update({
          client_arrival_status: action === "on_my_way" ? "on_my_way" : "arrived",
          client_arrival_status_at: now,
          updated_at: now,
        })
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("id", appointmentId)
        .select("id, appointment_status, check_in_at, client_arrival_status, client_arrival_status_at, check_in_review_needed, check_in_review_reason, check_in_answers")
        .single();

      if (error || !data) throw error ?? new Error("Check-in update failed");
      return NextResponse.json({ success: true, appointment: mapAppointment(data as Row) });
    }

    const input = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Row)
      : {};

    const answers = {
      moodRating: cleanAnswer(input.moodRating, 20),
      sessionFocus: cleanAnswer(input.sessionFocus),
      goalFocus: cleanAnswer(input.goalFocus),
      symptomChange: cleanAnswer(input.symptomChange, 80),
      safetyConcern: cleanAnswer(input.safetyConcern, 20),
      medicationChange: cleanAnswer(input.medicationChange, 20),
      adminConcern: cleanAnswer(input.adminConcern, 300),
      submittedAt: now,
    };

    const reviewReasons = [
      isYes(answers.safetyConcern) ? "Safety response needs review" : null,
      text(answers.symptomChange).toLowerCase() === "major" ? "Major symptom change" : null,
      isYes(answers.medicationChange) ? "Medication change" : null,
      answers.adminConcern ? "Admin or billing concern" : null,
    ].filter(Boolean) as string[];

    const { data, error } = await supabase
      .from("appointments")
      .update({
        appointment_status: currentStatus === "scheduled" ? "checked_in" : currentStatus,
        check_in_at: now,
        check_in_answers: answers,
        check_in_review_needed: reviewReasons.length > 0,
        check_in_review_reason: reviewReasons.join("; ") || null,
        updated_at: now,
      })
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("id", appointmentId)
      .select("id, appointment_status, check_in_at, client_arrival_status, client_arrival_status_at, check_in_review_needed, check_in_review_reason, check_in_answers")
      .single();

    if (error || !data) throw error ?? new Error("Check-in update failed");
    return NextResponse.json({ success: true, appointment: mapAppointment(data as Row) });
  } catch (error) {
    console.error("[appointment check-in]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Check-in failed" },
      { status: 500 },
    );
  }
}
