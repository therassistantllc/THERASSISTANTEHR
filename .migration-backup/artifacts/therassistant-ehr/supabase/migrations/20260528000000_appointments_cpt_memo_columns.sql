-- Add dedicated cpt_code and memo columns to appointments so the CPT
-- dropdown and memo input in the calendar drawer stop piggybacking on
-- appointment_type / reason. Backfills any existing CPT codes that were
-- stashed in appointment_type into the new cpt_code column.

alter table if exists public.appointments
  add column if not exists cpt_code text;

alter table if exists public.appointments
  add column if not exists memo text;

-- Backfill: any appointment_type that looks like a 5-digit CPT (9xxxx)
-- moves to cpt_code. Leave the original appointment_type intact so we
-- don't lose data; the API now writes the two fields independently.
update public.appointments
   set cpt_code = appointment_type
 where cpt_code is null
   and appointment_type ~ '^9[0-9]{4}$';
