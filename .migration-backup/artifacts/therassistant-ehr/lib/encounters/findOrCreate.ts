/**
 * Idempotent find-or-create for the (encounter, clinical note) pair attached
 * to an appointment. Two near-simultaneous "Check In" clicks (double-tap,
 * retry after slow network, second tab) used to race the read-then-insert
 * and produce duplicate encounters / duplicate notes for one visit.
 *
 * The partial unique indexes on
 *   encounters(organization_id, appointment_id) where archived_at is null
 *   encounter_clinical_notes(organization_id, encounter_id) where archived_at is null
 * close the race at the DB. These helpers catch the resulting 23505
 * unique_violation and re-select the winning row, so concurrent callers
 * deterministically converge on the same encounter_id / note_id.
 */

// Postgres unique_violation.
export const UNIQUE_VIOLATION = "23505";

export type FindOrCreateAppointment = {
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
  from(table: "encounters" | "encounter_clinical_notes"): {
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

type EncounterRow = { id: string; client_id: string | null; provider_id: string | null };
type NoteRow = { id: string };

export type FindOrCreateEncounterResult =
  | { ok: true; encounterId: string; created: boolean; clientId: string; providerId: string | null }
  | { ok: false; status: number; error: string };

export async function findOrCreateEncounter(
  supabase: EncountersSupabase,
  organizationId: string,
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
      .from("encounters")
      .select("id, client_id, provider_id")
      .eq("organization_id", organizationId)
      .eq("appointment_id", appointmentId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle<EncounterRow>();

  const { data: existing, error: existingError } = await selectExisting();
  if (existingError) {
    return { ok: false, status: 500, error: `Failed to look up encounter: ${existingError.message}` };
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
    .from("encounters")
    .insert({
      organization_id: organizationId,
      client_id: apptClientId,
      provider_id: appt.provider_id,
      appointment_id: appointmentId,
      encounter_status: "draft",
      service_date: serviceDate,
      required_billing_fields_complete: false,
      started_at: appt.scheduled_start_at ?? null,
      ended_at: appt.scheduled_end_at ?? null,
    })
    .select("id, client_id, provider_id")
    .single<EncounterRow>();

  if (!insertError && inserted) {
    return {
      ok: true,
      encounterId: String(inserted.id),
      created: true,
      clientId: inserted.client_id ?? apptClientId,
      providerId: inserted.provider_id ?? appt.provider_id,
    };
  }

  // Race: another request inserted between our SELECT and INSERT, and the
  // partial unique index (organization_id, appointment_id) WHERE archived_at IS NULL
  // raised 23505. Re-select to return the winner.
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
    error: `Failed to create encounter: ${insertError?.message ?? "unknown error"}`,
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
  organizationId: string,
  encounterId: string,
  clientId: string,
  providerId: string | null,
  nowIso: string,
  defaults: NoteDefaults = {},
): Promise<FindOrCreateNoteResult> {
  const selectExisting = () =>
    supabase
      .from("encounter_clinical_notes")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle<NoteRow>();

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
    .single<NoteRow>();

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
    error: `Failed to create clinical note: ${insertError?.message ?? "unknown error"}`,
  };
}
