import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { loadAuthForProvider } from "@/lib/telehealth/connections";
import { pickAdapter } from "@/lib/telehealth/adapters";
import { isTelehealthPlatform, type TelehealthPlatform } from "@/lib/telehealth/config";

function durationMinutes(start: string, end: string | null): number {
  if (!end) return 50;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 50;
  return Math.max(15, Math.round(ms / 60000));
}

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
  if (appt.organization_id !== ctx.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("telehealth_sessions")
    .select("id, meeting_url, host_url, telehealth_vendor, session_status")
    .eq("appointment_id", appointmentId)
    .eq("organization_id", ctx.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.meeting_url) {
    return NextResponse.json({
      success: true,
      source: "existing_session",
      sessionId: existing.id,
      platform: existing.telehealth_vendor,
      joinUrl: existing.meeting_url,
      hostUrl: existing.host_url ?? null,
    });
  }

  let platform: TelehealthPlatform | null = null;
  let providerLegacyUrl: string | null = null;
  let providerStaffId: string | null = null;
  if (appt.provider_id) {
    const { data: profile } = await supabase
      .from("provider_credentialing_profiles")
      .select("id, default_telehealth_platform, telehealth_url, staff_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", appt.provider_id)
      .maybeSingle();
    const dp = (profile as any)?.default_telehealth_platform as string | null | undefined;
    if (dp && isTelehealthPlatform(dp)) platform = dp;
    providerLegacyUrl = (profile as any)?.telehealth_url ?? null;
    providerStaffId = (profile as any)?.staff_id ?? null;
  }

  let providerAuthUserId: string | null = null;
  if (providerStaffId) {
    const { data: staffRow } = await supabase
      .from("staff_profiles")
      .select("auth_user_id")
      .eq("id", providerStaffId)
      .maybeSingle();
    providerAuthUserId = (staffRow as any)?.auth_user_id ?? null;
  }
  const ownerUserIdForAuth = providerAuthUserId ?? ctx.userId;

  if (!platform) {
    const fallbackUrl = appt.telehealth_url ?? providerLegacyUrl ?? null;
    if (fallbackUrl) {
      return NextResponse.json({
        success: true,
        source: "legacy_static_url",
        platform: null,
        joinUrl: fallbackUrl,
        hostUrl: null,
        warning:
          "No default telehealth platform set for this provider. Using the legacy static telehealth URL. Connect Zoom or Google Meet in Settings → Providers to enable per-meeting links.",
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

  const auth = await loadAuthForProvider(supabase as any, {
    organizationId: ctx.organizationId,
    ownerUserId: ownerUserIdForAuth,
    platform,
  });
  if (!auth) {
    const fallbackUrl = appt.telehealth_url ?? providerLegacyUrl ?? null;
    const providerScopeNote = providerAuthUserId
      ? `The appointment's provider has not connected ${platform}.`
      : `${platform} connection lookup falls back to the current user because the appointment's provider has no linked staff account.`;
    if (fallbackUrl) {
      return NextResponse.json({
        success: true,
        source: "legacy_static_url",
        platform,
        joinUrl: fallbackUrl,
        hostUrl: null,
        warning: `${providerScopeNote} Using the legacy static URL. Connect in Settings → Providers to auto-create meetings.`,
      });
    }
    return NextResponse.json(
      {
        error: providerScopeNote,
        platform,
        requiresConnect: true,
      },
      { status: 409 },
    );
  }

  const adapter = pickAdapter(platform);
  let created;
  try {
    created = await adapter.createMeeting(auth, {
      topic: appt.appointment_type ?? "Telehealth visit",
      startAt: appt.scheduled_start_at,
      durationMinutes: durationMinutes(appt.scheduled_start_at, appt.scheduled_end_at),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meeting creation failed", platform },
      { status: 502 },
    );
  }

  const { data: session, error: sessErr } = await supabase
    .from("telehealth_sessions")
    .insert({
      organization_id: ctx.organizationId,
      appointment_id: appointmentId,
      provider_id: appt.provider_id,
      scheduled_start_at: appt.scheduled_start_at,
      telehealth_vendor: platform,
      meeting_url: created.joinUrl,
      host_url: created.hostUrl,
      session_status: "scheduled",
    } as any)
    .select("id")
    .single();
  if (sessErr) {
    console.error("[telehealth/join] failed to persist session", sessErr);
  }

  return NextResponse.json({
    success: true,
    source: "created",
    sessionId: session?.id ?? null,
    platform,
    externalMeetingId: created.externalMeetingId,
    joinUrl: created.joinUrl,
    hostUrl: created.hostUrl,
  });
}
