-- Stop duplicate encounters when the Check In button is clicked twice in a row.
--
-- Both /api/check-ins/appointment/start-note and the older
-- /api/encounters/create-from-appointment do a read-then-insert to
-- find-or-create the encounter for an appointment. Two near-simultaneous
-- clicks (double-tap, retry after slow network, second tab) can both miss
-- the SELECT and both INSERT, producing two encounters (and downstream,
-- two clinical notes) attached to a single appointment.
--
-- A partial unique index on the live (non-archived) encounter for an
-- appointment closes the race at the DB level. Application code catches
-- the resulting 23505 unique_violation and re-selects the winning row,
-- so concurrent retries deterministically return the same encounter_id.
--
-- The predicate `archived_at is null` mirrors the existing index on
-- encounter_clinical_notes (idx_encounter_clinical_notes_unique_active)
-- so an encounter can legitimately be re-created for the same appointment
-- after the prior one is archived.
do $$
begin
  if to_regclass('public.encounters') is not null then
    create unique index if not exists idx_encounters_unique_active_appointment
      on public.encounters (organization_id, appointment_id)
      where archived_at is null;
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
