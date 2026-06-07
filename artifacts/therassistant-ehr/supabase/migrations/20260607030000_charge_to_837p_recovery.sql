-- Repair charge-to-837P drift discovered in the signed encounter flow.
-- Missing active code references prevented claim draft creation, and
-- claim_status_events was referenced by app code but absent from the live schema.

create extension if not exists pgcrypto;

insert into public.diagnosis_codes (code, code_system, description, is_active)
values
  ('Z81.8', 'ICD-10-CM', 'Family history of other mental and behavioral disorders', true)
on conflict (code, code_system)
do update set
  description = excluded.description,
  is_active = true;

insert into public.procedure_codes (code, code_system, description, is_active)
values
  ('90899', 'CPT', 'Unlisted psychiatric service or procedure', true)
on conflict (code, code_system)
do update set
  description = excluded.description,
  is_active = true;

create table if not exists public.claim_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  claim_id uuid not null references public.professional_claims(id) on delete cascade,
  source text not null,
  detail jsonb not null default '{}'::jsonb,
  status text,
  status_message text,
  payer_reference_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.claim_status_events
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists detail jsonb not null default '{}'::jsonb,
  add column if not exists status text,
  add column if not exists status_message text,
  add column if not exists payer_reference_id text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_claim_status_events_claim_created
  on public.claim_status_events (claim_id, created_at desc);

create index if not exists idx_claim_status_events_org_created
  on public.claim_status_events (organization_id, created_at desc);

create index if not exists idx_claim_status_events_source_created
  on public.claim_status_events (source, created_at desc);

alter table public.claim_status_events enable row level security;

drop policy if exists claim_status_events_org_policy on public.claim_status_events;
create policy claim_status_events_org_policy
  on public.claim_status_events
  for all
  to authenticated
  using (
    organization_id::text = coalesce(
      auth.jwt() ->> 'organization_id',
      auth.jwt() -> 'app_metadata' ->> 'organization_id',
      ''
    )
    or exists (
      select 1
      from public.professional_claims pc
      where pc.id = claim_status_events.claim_id
        and pc.organization_id::text = coalesce(
          auth.jwt() ->> 'organization_id',
          auth.jwt() -> 'app_metadata' ->> 'organization_id',
          ''
        )
    )
  )
  with check (
    organization_id::text = coalesce(
      auth.jwt() ->> 'organization_id',
      auth.jwt() -> 'app_metadata' ->> 'organization_id',
      ''
    )
    or exists (
      select 1
      from public.professional_claims pc
      where pc.id = claim_status_events.claim_id
        and pc.organization_id::text = coalesce(
          auth.jwt() ->> 'organization_id',
          auth.jwt() -> 'app_metadata' ->> 'organization_id',
          ''
        )
    )
  );

grant select, insert on public.claim_status_events to authenticated;

select pg_notify('pgrst', 'reload schema');