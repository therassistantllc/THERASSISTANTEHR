import type { SupabaseClient } from "@supabase/supabase-js";
import { pickAdapter } from "./adapters";
import { loadAuthForProvider, markConnectionNeedsReconnect } from "./connections";
import { isTelehealthPlatform, type TelehealthPlatform } from "./config";

type DbAny = SupabaseClient<any, any, any>;

export type AppointmentForMeeting = {
  id: string;
  organizationId: string;
  providerId: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  appointmentType: string | null;
  telehealthUrl: string | null;
};

export type ProviderTelehealthContext = {
  platform: TelehealthPlatform | null;
  providerAuthUserId: string | null;
  providerLegacyUrl: string | null;
};

export type EnsureMeetingOutcome =
  | {
      status: "created" | "existing";
      sessionId: string | null;
      platform: TelehealthPlatform;
      joinUrl: string;
      hostUrl: string | null;
      externalMeetingId: string | null;
    }
  | {
      status: "fallback";
      platform: TelehealthPlatform | null;
      joinUrl: string | null;
      warning: string;
    }
  | {
      status: "skipped";
      platform: TelehealthPlatform | null;
      warning: string;
    }
  | {
      status: "credential_error";
      platform: TelehealthPlatform;
      error: string;
    }
  | {
      status: "adapter_error";
      platform: TelehealthPlatform;
      error: string;
    };

function durationMinutes(start: string, end: string | null): number {
  if (!end) return 50;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 50;
  return Math.max(15, Math.round(ms / 60000));
}

/**
 * Resolve the provider's default telehealth platform and the auth_user_id
 * of the underlying staff record (used to look up the OAuth connection
 * via loadAuthForProvider).
 */
export async function resolveProviderTelehealthContext(
  supabase: DbAny,
  params: { organizationId: string; providerId: string | null },
): Promise<ProviderTelehealthContext> {
  if (!params.providerId) {
    return { platform: null, providerAuthUserId: null, providerLegacyUrl: null };
  }
  const { data: profile } = await supabase
    .from("provider_credentialing_profiles")
    .select("id, default_telehealth_platform, telehealth_url, staff_id")
    .eq("organization_id", params.organizationId)
    .eq("id", params.providerId)
    .maybeSingle();
  const dp = (profile as any)?.default_telehealth_platform as string | null | undefined;
  const platform = dp && isTelehealthPlatform(dp) ? (dp as TelehealthPlatform) : null;
  const providerLegacyUrl = (profile as any)?.telehealth_url ?? null;
  const staffId = (profile as any)?.staff_id as string | null | undefined;

  let providerAuthUserId: string | null = null;
  if (staffId) {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("auth_user_id")
      .eq("id", staffId)
      .maybeSingle();
    providerAuthUserId = (staff as any)?.auth_user_id ?? null;
  }
  return { platform, providerAuthUserId, providerLegacyUrl };
}

async function archiveSession(supabase: DbAny, sessionId: string): Promise<void> {
  await supabase
    .from("telehealth_sessions")
    .update({ archived_at: new Date().toISOString(), session_status: "cancelled" } as any)
    .eq("id", sessionId);
}

/**
 * Create a meeting for an appointment if one doesn't already exist.
 * Persists a row in telehealth_sessions and returns the join URL.
 *
 * This is the shared path used by:
 *   - the booking-time auto-create (best-effort; falls back silently to legacy URL)
 *   - the on-demand Join click (existing route).
 */
export async function ensureMeetingForAppointment(
  supabase: DbAny,
  appointment: AppointmentForMeeting,
  options: { fallbackOwnerUserId?: string | null } = {},
): Promise<EnsureMeetingOutcome> {
  // Reuse an existing session if present.
  const { data: existing } = await supabase
    .from("telehealth_sessions")
    .select("id, meeting_url, host_url, telehealth_vendor, external_meeting_id")
    .eq("appointment_id", appointment.id)
    .eq("organization_id", appointment.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.meeting_url) {
    const vendor = (existing as any).telehealth_vendor as string | null;
    const platform = vendor && isTelehealthPlatform(vendor) ? (vendor as TelehealthPlatform) : null;
    if (platform) {
      return {
        status: "existing",
        sessionId: (existing as any).id,
        platform,
        joinUrl: (existing as any).meeting_url,
        hostUrl: (existing as any).host_url ?? null,
        externalMeetingId: (existing as any).external_meeting_id ?? null,
      };
    }
  }

  const ctx = await resolveProviderTelehealthContext(supabase, {
    organizationId: appointment.organizationId,
    providerId: appointment.providerId,
  });

  if (!ctx.platform) {
    return {
      status: "skipped",
      platform: null,
      warning:
        "No default telehealth platform set for this provider. Using the legacy static URL. Connect Zoom or Google Meet in Settings → Providers to enable per-meeting links.",
    };
  }

  const ownerUserId = ctx.providerAuthUserId ?? options.fallbackOwnerUserId ?? null;
  if (!ownerUserId) {
    return {
      status: "fallback",
      platform: ctx.platform,
      joinUrl: appointment.telehealthUrl ?? ctx.providerLegacyUrl ?? null,
      warning: `Cannot resolve a user to load ${ctx.platform} credentials for this provider. Connect ${ctx.platform} in Settings → Providers.`,
    };
  }

  const auth = await loadAuthForProvider(supabase, {
    organizationId: appointment.organizationId,
    ownerUserId,
    platform: ctx.platform,
  });
  if (!auth) {
    return {
      status: "fallback",
      platform: ctx.platform,
      joinUrl: appointment.telehealthUrl ?? ctx.providerLegacyUrl ?? null,
      warning: `Provider is not connected to ${ctx.platform}. Using the legacy static URL. Connect in Settings → Providers to auto-create meetings.`,
    };
  }

  const adapter = pickAdapter(ctx.platform);
  let created;
  try {
    created = await adapter.createMeeting(auth, {
      topic: appointment.appointmentType ?? "Telehealth visit",
      startAt: appointment.scheduledStartAt,
      durationMinutes: durationMinutes(appointment.scheduledStartAt, appointment.scheduledEndAt),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Meeting creation failed";
    if (/401|unauthor|invalid[_ ]grant|expired|revoked/i.test(msg)) {
      await markConnectionNeedsReconnect(supabase, {
        organizationId: appointment.organizationId,
        ownerUserId,
        platform: ctx.platform,
        error: msg.slice(0, 500),
      });
      return { status: "credential_error", platform: ctx.platform, error: msg };
    }
    return { status: "adapter_error", platform: ctx.platform, error: msg };
  }

  const sessionRow: Record<string, unknown> = {
    organization_id: appointment.organizationId,
    appointment_id: appointment.id,
    provider_id: appointment.providerId,
    scheduled_start_at: appointment.scheduledStartAt,
    telehealth_vendor: ctx.platform,
    meeting_url: created.joinUrl,
    host_url: created.hostUrl,
    session_status: "scheduled",
    external_meeting_id: created.externalMeetingId ?? null,
  };
  let sessionInsert = await supabase
    .from("telehealth_sessions")
    .insert(sessionRow as any)
    .select("id")
    .single();
  if (sessionInsert.error) {
    const code = (sessionInsert.error as { code?: string }).code ?? "";
    const msg = String(sessionInsert.error.message ?? "");
    if (code === "42703" && /external_meeting_id/i.test(msg)) {
      const { external_meeting_id: _drop, ...legacyRow } = sessionRow as Record<string, unknown>;
      void _drop;
      sessionInsert = await supabase
        .from("telehealth_sessions")
        .insert(legacyRow as any)
        .select("id")
        .single();
    }
  }
  if (sessionInsert.error) {
    console.error("[telehealth/sessions] failed to persist session", sessionInsert.error);
  }

  return {
    status: "created",
    sessionId: sessionInsert.data?.id ?? null,
    platform: ctx.platform,
    joinUrl: created.joinUrl,
    hostUrl: created.hostUrl,
    externalMeetingId: created.externalMeetingId ?? null,
  };
}

export type SyncMeetingOutcome =
  | {
      status: "updated" | "recreated";
      sessionId: string | null;
      platform: TelehealthPlatform;
      joinUrl: string;
      hostUrl: string | null;
      externalMeetingId: string | null;
    }
  | { status: "no_session" }
  | { status: "fallback" | "skipped"; warning: string }
  | { status: "credential_error" | "adapter_error"; platform: TelehealthPlatform; error: string };

/**
 * Sync an existing telehealth session to the appointment's current time.
 * Tries adapter.updateMeeting first; on failure (or if the adapter lacks
 * update support), archives the old session and creates a fresh one so
 * the link surfaced in reminders is always current.
 */
export async function syncMeetingForAppointment(
  supabase: DbAny,
  appointment: AppointmentForMeeting,
  options: { fallbackOwnerUserId?: string | null } = {},
): Promise<SyncMeetingOutcome> {
  const { data: existing } = await supabase
    .from("telehealth_sessions")
    .select("id, telehealth_vendor, external_meeting_id, meeting_url, host_url")
    .eq("appointment_id", appointment.id)
    .eq("organization_id", appointment.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing) return { status: "no_session" };

  const vendor = (existing as any).telehealth_vendor as string | null;
  const platform =
    vendor && isTelehealthPlatform(vendor) ? (vendor as TelehealthPlatform) : null;
  const externalId = (existing as any).external_meeting_id as string | null;
  const sessionId = (existing as any).id as string;

  if (!platform) return { status: "skipped", warning: "Session has no known telehealth vendor." };

  const ctx = await resolveProviderTelehealthContext(supabase, {
    organizationId: appointment.organizationId,
    providerId: appointment.providerId,
  });
  const ownerUserId = ctx.providerAuthUserId ?? options.fallbackOwnerUserId ?? null;
  if (!ownerUserId) {
    return { status: "fallback", warning: `Cannot resolve a user to load ${platform} credentials.` };
  }
  const auth = await loadAuthForProvider(supabase, {
    organizationId: appointment.organizationId,
    ownerUserId,
    platform,
  });
  if (!auth) {
    return {
      status: "fallback",
      warning: `Provider is no longer connected to ${platform}; existing meeting may now be stale.`,
    };
  }

  const adapter = pickAdapter(platform);

  // Prefer in-place update when available.
  if (externalId && typeof adapter.updateMeeting === "function") {
    try {
      const updated = await adapter.updateMeeting(auth, externalId, {
        topic: appointment.appointmentType ?? "Telehealth visit",
        startAt: appointment.scheduledStartAt,
        durationMinutes: durationMinutes(appointment.scheduledStartAt, appointment.scheduledEndAt),
      });
      await supabase
        .from("telehealth_sessions")
        .update({
          meeting_url: updated.joinUrl,
          host_url: updated.hostUrl,
          scheduled_start_at: appointment.scheduledStartAt,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", sessionId);
      return {
        status: "updated",
        sessionId,
        platform,
        joinUrl: updated.joinUrl,
        hostUrl: updated.hostUrl,
        externalMeetingId: updated.externalMeetingId,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Meeting update failed";
      if (/401|unauthor|invalid[_ ]grant|expired|revoked/i.test(msg)) {
        await markConnectionNeedsReconnect(supabase, {
          organizationId: appointment.organizationId,
          ownerUserId,
          platform,
          error: msg.slice(0, 500),
        });
        return { status: "credential_error", platform, error: msg };
      }
      // Fall through to recreate path on non-credential errors.
      console.warn("[telehealth/sessions] updateMeeting failed, will recreate:", msg);
    }
  }

  // Recreate path: archive the stale session and create a new one.
  await archiveSession(supabase, sessionId);
  const ensure = await ensureMeetingForAppointment(supabase, appointment, options);
  switch (ensure.status) {
    case "created":
    case "existing":
      return {
        status: "recreated",
        sessionId: ensure.sessionId,
        platform: ensure.platform,
        joinUrl: ensure.joinUrl,
        hostUrl: ensure.hostUrl,
        externalMeetingId: ensure.externalMeetingId,
      };
    case "fallback":
    case "skipped":
      return { status: "fallback", warning: ensure.warning };
    case "credential_error":
      return { status: "credential_error", platform: ensure.platform, error: ensure.error };
    case "adapter_error":
      return { status: "adapter_error", platform: ensure.platform, error: ensure.error };
  }
}
