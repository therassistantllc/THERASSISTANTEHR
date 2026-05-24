-- Payer-specific handling rules surfaced from the Denials-by-RARC
-- workqueue ("When Aetna returns RARC M25, attach the treatment plan
-- and resubmit"). Until now those rules were only written as
-- audit_logs rows so they were durable but not editable. This adds a
-- real table so the admin payer-rules surface can list/edit them and
-- so the existing POST /api/billing/payer-rules endpoint can upsert
-- instead of always appending.

create table if not exists public.payer_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payer_profile_id uuid references public.payer_profiles(id) on delete set null,
  payer_name text,
  rarc_code text,
  carc_code text,
  rule text not null,
  recommended_action text,
  source text not null default 'denials_by_rarc',
  created_by_user_id uuid references auth.users(id),
  updated_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists idx_payer_rules_org
  on public.payer_rules (organization_id, updated_at desc)
  where archived_at is null;

create index if not exists idx_payer_rules_lookup
  on public.payer_rules (organization_id, rarc_code, carc_code, payer_name)
  where archived_at is null;

-- Deterministic upsert key: one active rule per
-- (org, payer-label, rarc, carc) tuple. NULLs collapse so an "any
-- payer" rule and a payer-specific rule are distinct rows.
create unique index if not exists payer_rules_unique_active
  on public.payer_rules (
    organization_id,
    coalesce(lower(payer_name), ''),
    coalesce(upper(rarc_code), ''),
    coalesce(upper(carc_code), '')
  )
  where archived_at is null;

alter table public.payer_rules enable row level security;

drop policy if exists "payer_rules_tenant" on public.payer_rules;
create policy "payer_rules_tenant" on public.payer_rules
  for all using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

create or replace function public.payer_rules_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payer_rules_set_updated_at on public.payer_rules;
create trigger payer_rules_set_updated_at
  before update on public.payer_rules
  for each row execute function public.payer_rules_touch_updated_at();

grant select, insert, update, delete on public.payer_rules
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
