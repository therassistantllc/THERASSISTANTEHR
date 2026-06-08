import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import {
  ensureMeetingForAppointment,
  resolveProviderTelehealthContext,
  type AppointmentForMeeting,
} from "@/lib/telehealth/sessions";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuthenticatedStaff();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id: appointmentId } = await context.params;
  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  const { data: appt, error: apptErr } = await supabase
    .from("appointments")
    .select(
      "id, organization_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_type, telehealth_url, service_location",
    )
    .eq("id", appointmentId)
    .maybeSingle();
  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 });
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  if ((appt as any).organization_id !== ctx.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apptForMeeting: AppointmentForMeeting = {
    id: (appt as any).id,
    organizationId: (appt as any).organization_id,
    providerId: (appt as any).provider_id ?? null,
    scheduledStartAt: (appt as any).scheduled_start_at,
    scheduledEndAt: (appt as any).scheduled_end_at ?? null,
    appointmentType: (appt as any).appointment_type ?? null,
    telehealthUrl: (appt as any).telehealth_url ?? null,
  };

  // Resolve provider context early so we can decide if caller may see host_url.
  const provCtx = await resolveProviderTelehealthContext(supabase as any, {
    organizationId: ctx.organizationId,
    providerId: apptForMeeting.providerId,
  });
  const callerIsProvider =
    provCtx.providerAuthUserId !== null && provCtx.providerAuthUserId === ctx.userId;

  const outcome = await ensureMeetingForAppointment(supabase as any, apptForMeeting, {
    fallbackOwnerUserId: ctx.userId,
  });

  if (outcome.status === "existing" || outcome.status === "created") {
    return NextResponse.json({
      success: true,
      source: outcome.status === "existing" ? "existing_session" : "created",
      sessionId: outcome.sessionId,
      platform: outcome.platform,
      externalMeetingId: outcome.externalMeetingId,
      joinUrl: outcome.joinUrl,
      hostUrl: callerIsProvider ? outcome.hostUrl : null,
    });
  }

  if (outcome.status === "fallback" || outcome.status === "skipped") {
    if (outcome.status === "fallback" && outcome.joinUrl) {
      return NextResponse.json({
        success: true,
        source: "legacy_static_url",
        platform: outcome.platform,
        joinUrl: outcome.joinUrl,
        hostUrl: null,
        warning: outcome.warning,
      });
    }
    if (outcome.status === "skipped") {
      const fallbackUrl = apptForMeeting.telehealthUrl ?? provCtx.providerLegacyUrl ?? null;
      if (fallbackUrl) {
        return NextResponse.json({
          success: true,
          source: "legacy_static_url",
          platform: null,
          joinUrl: fallbackUrl,
          hostUrl: null,
          warning: outcome.warning,
        });
      }
      return NextResponse.json(
        {
          error: "No telehealth platform configured for this provider and no fallback URL set.",
          hint: "Set a default platform on the provider in Settings → Providers, or configure a Telehealth URL.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: outcome.warning,
        platform: outcome.status === "fallback" ? outcome.platform : null,
        requiresConnect: true,
      },
      { status: 409 },
    );
  }

  if (outcome.status === "credential_error") {
    return NextResponse.json(
      {
        error: `${outcome.platform} credentials are no longer valid. Please reconnect in Settings → Providers.`,
        platform: outcome.platform,
        requiresConnect: true,
      },
      { status: 401 },
    );
  }

  if (outcome.status === "adapter_error") {
    return NextResponse.json(
      { error: outcome.error, platform: outcome.platform },
      { status: 502 },
    );
  }

  return NextResponse.json({ error: "Unexpected telehealth state" }, { status: 500 });
}
