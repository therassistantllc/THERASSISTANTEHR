/**
 * Idempotent find-or-create for the clinical session and documentation row
 * attached to an appointment.
 *
 * Historical app routes still use "encounter" terminology, but the live
 * Supabase schema now stores that visit object in `sessions` and note content
 * in `session_documentation`. Keep the public helper names stable while routing
 * database writes to the current schema.
 */

// Postgres unique_violation.
export const UNIQUE_VIOLATION = "23505";

export type FindOrCreateAppointment = {
  tenant_id?: string | null;
  client_id: string | null;
  provider_id: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
};

// Structural type so tests can pass a minimal fake supabase client without
// pulling in the full @supabase/supabase-js generated types.
type MaybeSingleResult<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
type SingleResult<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>;

export type EncountersSupabase = {
  from(table: "sessions" | "session_documentation"): {
    select(columns: string): {
      eq(field: string, value: string): {
        eq(field: string, value: string): {
          is(field: string, value: null): {
            limit(n: number): { maybeSingle<T = Record<string, unknown>>(): MaybeSingleResult<T> };
          };
        };
      };
    };
    insert(row: Record<string, unknown>): {
      select(columns: string): { single<T = Record<string, unknown>>(): SingleResult<T> };
    };
  };
};

type SessionRow = { id: string; client_id: string | null; provider_id: string | null };
type DocumentationRow = { id: string };

export type FindOrCreateEncounterResult =
  | { ok: true; encounterId: string; created: boolean; clientId: string; providerId: string | null }
  | { ok: false; status: number; error: string };

export async function findOrCreateEncounter(
  supabase: EncountersSupabase,
  tenantId: string,
  appointmentId: string,
  appt: FindOrCreateAppointment,
  nowIso: string,
): Promise<FindOrCreateEncounterResult> {
  if (!appt.client_id) {
    return { ok: false, status: 422, error: "Appointment is missing client_id" };
  }
  const apptClientId = appt.client_id;

  const selectExisting = () =>
    supabase
      .from("sessions")
      .select("id, client_id, provider_id")
      .eq("tenant_id", tenantId)
      .eq("appointment_id", appointmentId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle<SessionRow>();

  const { data: existing, error: existingError } = await selectExisting();
  if (existingError) {
    return { ok: false, status: 500, error: `Failed to look up session: ${existingError.message}` };
  }
  if (existing?.id) {
    return {
      ok: true,
      encounterId: String(existing.id),
      created: false,
      clientId: existing.client_id ?? apptClientId,
      providerId: existing.provider_id ?? appt.provider_id,
    };
  }

  const serviceDate = appt.scheduled_start_at
    ? new Date(appt.scheduled_start_at).toISOString().slice(0, 10)
    : nowIso.slice(0, 10);

  const { data: inserted, error: insertError } = await supabase
    .from("sessions")
    .insert({
      tenant_id: tenantId,
      client_id: apptClientId,
      provider_id: appt.provider_id,
      appointment_id: appointmentId,
      session_status: "scheduled",
      service_date: serviceDate,
      required_billing_fields_complete: false,
      started_at: appt.scheduled_start_at ?? null,
      ended_at: appt.scheduled_end_at ?? null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, client_id, provider_id")
    .single<SessionRow>();

  if (!insertError && inserted) {
    return {
      ok: true,
      encounterId: String(inserted.id),
      created: true,
      clientId: inserted.client_id ?? apptClientId,
      providerId: inserted.provider_id ?? appt.provider_id,
    };
  }

  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: raceRow } = await selectExisting();
    if (raceRow?.id) {
      return {
        ok: true,
        encounterId: String(raceRow.id),
        created: false,
        clientId: raceRow.client_id ?? apptClientId,
        providerId: raceRow.provider_id ?? appt.provider_id,
      };
    }
  }

  return {
    ok: false,
    status: 422,
    error: `Failed to create session: ${insertError?.message ?? "unknown error"}`,
  };
}

export type FindOrCreateNoteResult =
  | { ok: true; noteId: string; created: boolean }
  | { ok: false; status: number; error: string };

export type NoteDefaults = {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
};

export async function findOrCreateNote(
  supabase: EncountersSupabase,
  tenantId: string,
  encounterId: string,
  clientId: string,
  providerId: string | null,
  nowIso: string,
  defaults: NoteDefaults = {},
): Promise<FindOrCreateNoteResult> {
  const selectExisting = () =>
    supabase
      .from("session_documentation")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("session_id", encounterId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle<DocumentationRow>();

  const { data: existing, error: existingError } = await selectExisting();
  if (existingError) {
    return { ok: false, status: 500, error: `Failed to look up session documentation: ${existingError.message}` };
  }
  if (existing?.id) {
    return { ok: true, noteId: String(existing.id), created: false };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("session_documentation")
    .insert({
      tenant_id: tenantId,
      session_id: encounterId,
      client_id: clientId,
      provider_id: providerId,
      note_status: "draft",
      subjective: defaults.subjective ?? "",
      objective: defaults.objective ?? "",
      assessment: defaults.assessment ?? "",
      plan: defaults.plan ?? "",
      signed_at: null,
      signed_by_user_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single<DocumentationRow>();

  if (!insertError && inserted) {
    return { ok: true, noteId: String(inserted.id), created: true };
  }

  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: raceRow } = await selectExisting();
    if (raceRow?.id) {
      return { ok: true, noteId: String(raceRow.id), created: false };
    }
  }

  return {
    ok: false,
    status: 422,
    error: `Failed to create session documentation: ${insertError?.message ?? "unknown error"}`,
  };
}
