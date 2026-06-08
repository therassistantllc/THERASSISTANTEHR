-- Migration: 20260531000000_note_templates_personal.sql
-- Purpose: Let individual clinicians save their own note templates on top of
--          the org-wide library. provider_id = NULL means org-wide (visible to
--          everyone in the org); provider_id pointing at a staff_profile means
--          the template is personal to that clinician and only they see it.

alter table public.note_templates
  add column if not exists provider_id uuid references public.staff_profiles(id) on delete cascade;

-- Lookup index covering the common "for this clinician or org-wide" filter.
create index if not exists idx_note_templates_provider
  on public.note_templates (organization_id, provider_id)
  where archived_at is null;

-- The existing default-template uniqueness was org-wide. Personal templates
-- don't participate in the default-template concept (the auto-pick at check-in
-- still chooses the org default), so we keep it as "at most one org default"
-- by restricting the unique index to provider_id IS NULL.
drop index if exists public.idx_note_templates_one_default;
create unique index if not exists idx_note_templates_one_default
  on public.note_templates (organization_id)
  where archived_at is null and is_default = true and provider_id is null;

-- RLS: keep tenant isolation, AND restrict personal templates to their owner.
-- Org-wide rows (provider_id IS NULL) remain visible to everyone in the org.
drop policy if exists note_templates_org_policy on public.note_templates;
create policy note_templates_org_policy on public.note_templates
  for all to authenticated
  using (
    organization_id::text = coalesce(
      auth.jwt() ->> 'organization_id',
      auth.jwt() -> 'app_metadata' ->> 'organization_id',
      ''
    )
    and (
      provider_id is null
      or provider_id in (
        select id from public.staff_profiles where auth_user_id = auth.uid()
      )
    )
  )
  with check (
    organization_id::text = coalesce(
      auth.jwt() ->> 'organization_id',
      auth.jwt() -> 'app_metadata' ->> 'organization_id',
      ''
    )
    and (
      provider_id is null
      or provider_id in (
        select id from public.staff_profiles where auth_user_id = auth.uid()
      )
    )
  );

select pg_notify('pgrst', 'reload schema');
