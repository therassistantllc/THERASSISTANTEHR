-- Migration: 20260619000000_patient_journal_entries.sql
-- Purpose: Between-session patient journaling. Adds a private table for
--          patient-authored entries (reflection / voice note / trigger /
--          coping / pattern) plus a private Storage bucket for voice-note
--          audio. Portal access goes through the service-role admin client
--          (matches portal_invites + documents pattern); the RLS policy
--          here only governs the authenticated clinician path.

create table if not exists public.patient_journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  entry_type text not null
    check (entry_type in ('reflection', 'voice_note', 'trigger', 'coping', 'pattern')),
  body jsonb not null default '{}'::jsonb,
  audio_storage_bucket text,
  audio_storage_path text,
  audio_mime_type text,
  audio_duration_seconds integer,
  tags text[] not null default '{}',
  -- Flagged when a clinician pulls this entry into a SOAP note so it can't
  -- be edited further by the patient and so the import surface can show a
  -- "already imported" badge.
  imported_into_note_id uuid references public.encounter_clinical_notes(id) on delete set null,
  imported_into_field text
    check (imported_into_field in ('subjective', 'objective', 'assessment', 'plan')),
  imported_at timestamptz,
  imported_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patient_journal_entries_chart
  on public.patient_journal_entries (organization_id, client_id, created_at desc)
  where imported_into_note_id is null or imported_into_note_id is not null;

create index if not exists idx_patient_journal_entries_imported
  on public.patient_journal_entries (imported_into_note_id)
  where imported_into_note_id is not null;

alter table public.patient_journal_entries enable row level security;

drop policy if exists patient_journal_entries_org_policy on public.patient_journal_entries;
create policy patient_journal_entries_org_policy on public.patient_journal_entries
  for all to authenticated
  using (
    organization_id::text = coalesce(
      auth.jwt() ->> 'organization_id',
      auth.jwt() -> 'app_metadata' ->> 'organization_id',
      ''
    )
  )
  with check (
    organization_id::text = coalesce(
      auth.jwt() ->> 'organization_id',
      auth.jwt() -> 'app_metadata' ->> 'organization_id',
      ''
    )
  );

-- Private Storage bucket for voice notes. Like intake-card-images, access
-- goes through the service role inside Next.js routes (portal session for
-- patients, clinician auth for staff). No public RLS policies on the bucket.
insert into storage.buckets (id, name, public)
values ('patient-journal-audio', 'patient-journal-audio', false)
on conflict (id) do update
  set public = excluded.public;

select pg_notify('pgrst', 'reload schema');
