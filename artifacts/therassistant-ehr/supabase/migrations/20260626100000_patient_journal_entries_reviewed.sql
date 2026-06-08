-- Migration: 20260626100000_patient_journal_entries_reviewed.sql
-- Purpose: Lightweight clinician acknowledgement on patient journal entries.
--          Not every entry belongs in a SOAP note, but patients still benefit
--          from knowing their care team saw what they wrote. The portal
--          surfaces "Reviewed by <clinician> on <date>" when set; the
--          clinician panel offers a "Mark as reviewed" action. Idempotent:
--          first review wins, subsequent calls are no-ops.

alter table public.patient_journal_entries
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_user_id uuid;

create index if not exists idx_patient_journal_entries_reviewed
  on public.patient_journal_entries (organization_id, client_id, reviewed_at desc)
  where reviewed_at is not null;

select pg_notify('pgrst', 'reload schema');
