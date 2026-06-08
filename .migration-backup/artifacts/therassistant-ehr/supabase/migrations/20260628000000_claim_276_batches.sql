-- 276 claim-status request batching for Claims workspace

create table if not exists public.claim_276_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_number text not null,
  batch_status text not null default 'ready_to_generate'
    check (batch_status in ('ready_to_generate', 'generated', 'downloaded', 'submitted', 'failed', 'voided')),
  batch_source text not null default 'claims_workspace'
    check (batch_source in ('claims_workspace', 'manual', 'auto')),
  payer_id text not null,
  billing_provider_npi text not null,
  billing_provider_tax_id text not null,
  claim_count integer not null default 0,
  generated_file_name text null,
  generated_file_content text null,
  generated_at timestamptz null,
  downloaded_at timestamptz null,
  submitted_at timestamptz null,
  last_generation_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);

create unique index if not exists idx_claim_276_batches_org_number
  on public.claim_276_batches (organization_id, batch_number)
  where archived_at is null;

create index if not exists idx_claim_276_batches_group
  on public.claim_276_batches (organization_id, payer_id, billing_provider_tax_id, created_at desc)
  where archived_at is null;

create table if not exists public.claim_276_batch_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.claim_276_batches(id) on delete cascade,
  professional_claim_id uuid not null references public.professional_claims(id) on delete cascade,
  trace_number text null,
  payer_claim_control_number text null,
  patient_account_number text null,
  service_date date null,
  claim_amount numeric(12,2) null,
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

create unique index if not exists idx_claim_276_batch_claims_unique_active
  on public.claim_276_batch_claims (organization_id, batch_id, professional_claim_id)
  where archived_at is null;

create index if not exists idx_claim_276_batch_claims_claim
  on public.claim_276_batch_claims (organization_id, professional_claim_id, created_at desc)
  where archived_at is null;

alter table public.claim_276_batches enable row level security;
alter table public.claim_276_batch_claims enable row level security;

drop policy if exists claim_276_batches_org_policy on public.claim_276_batches;
do $$
begin
  if to_regprocedure('public.current_organization_id()') is not null then
    execute $policy$
      create policy claim_276_batches_org_policy
        on public.claim_276_batches
        for all to authenticated
        using (organization_id = public.current_organization_id())
        with check (organization_id = public.current_organization_id())
    $policy$;
  else
    execute $policy$
      create policy claim_276_batches_org_policy
        on public.claim_276_batches
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
        )
    $policy$;
  end if;
end $$;

drop policy if exists claim_276_batch_claims_org_policy on public.claim_276_batch_claims;
do $$
begin
  if to_regprocedure('public.current_organization_id()') is not null then
    execute $policy$
      create policy claim_276_batch_claims_org_policy
        on public.claim_276_batch_claims
        for all to authenticated
        using (organization_id = public.current_organization_id())
        with check (organization_id = public.current_organization_id())
    $policy$;
  else
    execute $policy$
      create policy claim_276_batch_claims_org_policy
        on public.claim_276_batch_claims
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
        )
    $policy$;
  end if;
end $$;

drop trigger if exists trg_claim_276_batches_set_updated_at on public.claim_276_batches;
create trigger trg_claim_276_batches_set_updated_at
before update on public.claim_276_batches
for each row execute function public.set_updated_at();

select pg_notify('pgrst', 'reload schema');
