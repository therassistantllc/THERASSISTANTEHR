-- Migration: 20260530000000_note_templates.sql
-- Purpose: Per-organization clinical note templates. Lets practices keep
--          intake / individual / family / group scaffolding pre-populated so
--          clinicians don't retype it into every draft note. Templates match
--          on appointment.appointment_type (text) or CPT/HCPCS code, with an
--          org-level default as the last fallback before blank.

create table if not exists public.note_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  service_type text,
  cpt_code text,
  default_subjective text not null default '',
  default_interventions text not null default '',
  default_plan text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists idx_note_templates_org
  on public.note_templates (organization_id, name)
  where archived_at is null;

create index if not exists idx_note_templates_match
  on public.note_templates (organization_id, lower(service_type), cpt_code)
  where archived_at is null;

-- At most one default template per organization (active rows only).
create unique index if not exists idx_note_templates_one_default
  on public.note_templates (organization_id)
  where archived_at is null and is_default = true;

alter table public.note_templates enable row level security;

drop policy if exists note_templates_org_policy on public.note_templates;
create policy note_templates_org_policy on public.note_templates
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

select pg_notify('pgrst', 'reload schema');
