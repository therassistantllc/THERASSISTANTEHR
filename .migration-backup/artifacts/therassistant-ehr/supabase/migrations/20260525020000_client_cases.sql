-- ============================================================================
-- Migration: 20260525020000_client_cases.sql
-- Purpose:   Task #127 — introduce the "Case" concept on each client.
--            A Case is a named grouping of insurance coverage that applies to
--            a specific visit/set of visits. Every appointment, encounter,
--            charge, claim, and patient invoice can be tagged with the case
--            it should be billed under.
--
--            Self-pay / charity cases route encounters to patient
--            responsibility instead of generating an insurance claim.
--            Existing single-policy clients keep working: a default case is
--            auto-created at migration so nothing is orphaned.
-- All operations are idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── 1. case_type enum ───────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_case_type') then
    create type public.client_case_type as enum (
      'commercial',
      'medicaid',
      'medicare',
      'workers_comp',
      'charity',
      'self_pay',
      'other'
    );
  end if;
end $$;

-- ─── 2. client_cases table ───────────────────────────────────────────────────
create table if not exists public.client_cases (
  id                  uuid                       primary key default gen_random_uuid(),
  organization_id     uuid                       not null references public.organizations(id) on delete cascade,
  client_id           uuid                       not null references public.clients(id) on delete cascade,
  name                text                       not null,
  case_type           public.client_case_type    not null default 'commercial',
  notes               text,
  active_flag         boolean                    not null default true,
  is_default          boolean                    not null default false,
  archived_at         timestamptz,
  created_at          timestamptz                not null default now(),
  updated_at          timestamptz                not null default now(),
  created_by_user_id  uuid,
  updated_by_user_id  uuid
);

create index if not exists idx_client_cases_org_client
  on public.client_cases (organization_id, client_id)
  where archived_at is null;

-- Only one default case per client (active set only).
create unique index if not exists uq_client_cases_default_per_client
  on public.client_cases (client_id)
  where is_default = true and archived_at is null;

alter table public.client_cases enable row level security;

drop policy if exists client_cases_org_policy on public.client_cases;
create policy client_cases_org_policy
  on public.client_cases
  for all
  to authenticated
  using (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  )
  with check (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  );

-- ─── 3. client_case_policies join ────────────────────────────────────────────
create table if not exists public.client_case_policies (
  id                  uuid                                       primary key default gen_random_uuid(),
  organization_id     uuid                                       not null references public.organizations(id) on delete cascade,
  case_id             uuid                                       not null references public.client_cases(id) on delete cascade,
  policy_id           uuid                                       not null references public.insurance_policies(id) on delete cascade,
  priority            public.insurance_policy_priority           not null default 'primary',
  created_at          timestamptz                                not null default now(),
  updated_at          timestamptz                                not null default now()
);

-- Priority is unique within a case; the same policy can't be attached twice.
create unique index if not exists uq_client_case_policies_case_priority
  on public.client_case_policies (case_id, priority);
create unique index if not exists uq_client_case_policies_case_policy
  on public.client_case_policies (case_id, policy_id);

create index if not exists idx_client_case_policies_policy
  on public.client_case_policies (policy_id);

alter table public.client_case_policies enable row level security;

drop policy if exists client_case_policies_org_policy on public.client_case_policies;
create policy client_case_policies_org_policy
  on public.client_case_policies
  for all
  to authenticated
  using (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  )
  with check (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  );

-- ─── 4. Add case_id to billable artifacts ────────────────────────────────────
alter table public.appointments
  add column if not exists case_id uuid references public.client_cases(id) on delete set null;
create index if not exists idx_appointments_case_id
  on public.appointments (case_id) where case_id is not null;

alter table public.encounters
  add column if not exists case_id uuid references public.client_cases(id) on delete set null;
create index if not exists idx_encounters_case_id
  on public.encounters (case_id) where case_id is not null;

alter table public.claims
  add column if not exists case_id uuid references public.client_cases(id) on delete set null;
create index if not exists idx_claims_case_id
  on public.claims (case_id) where case_id is not null;

alter table public.professional_claims
  add column if not exists case_id uuid references public.client_cases(id) on delete set null;
create index if not exists idx_professional_claims_case_id
  on public.professional_claims (case_id) where case_id is not null;

alter table public.charge_capture_items
  add column if not exists case_id uuid references public.client_cases(id) on delete set null;
create index if not exists idx_charge_capture_items_case_id
  on public.charge_capture_items (case_id) where case_id is not null;

do $$
begin
  if to_regclass('public.patient_invoices') is not null then
    execute 'alter table public.patient_invoices add column if not exists case_id uuid references public.client_cases(id) on delete set null';
    execute 'create index if not exists idx_patient_invoices_case_id on public.patient_invoices (case_id) where case_id is not null';
  end if;
end $$;

-- ─── 5. Backfill: default case per client with insurance ─────────────────────
-- For every client that has at least one active insurance policy, create one
-- default case named after the primary payer (falling back to plan name or
-- "Primary case"), then link all the client's active policies in priority
-- order. Tag any existing appointments / encounters / claims / charges /
-- invoices that lack a case to this default.
do $$
declare
  rec record;
  v_case_id uuid;
  v_policy record;
  v_name text;
begin
  for rec in
    select distinct ip.client_id, ip.organization_id
    from public.insurance_policies ip
    where ip.archived_at is null
      and not exists (
        select 1 from public.client_cases cc
        where cc.client_id = ip.client_id
          and cc.archived_at is null
      )
  loop
    -- Derive a friendly case name from the primary (or any) policy.
    select coalesce(payer.payer_name, p.plan_name, 'Primary case')
    into v_name
    from public.insurance_policies p
    left join public.insurance_payers payer on payer.id = p.payer_id
    where p.client_id = rec.client_id
      and p.archived_at is null
    order by case p.priority
               when 'primary' then 1
               when 'secondary' then 2
               when 'tertiary' then 3
               else 4
             end,
             p.created_at asc
    limit 1;

    insert into public.client_cases (
      organization_id, client_id, name, case_type, active_flag, is_default
    ) values (
      rec.organization_id, rec.client_id, coalesce(v_name, 'Primary case'),
      'commercial', true, true
    )
    returning id into v_case_id;

    for v_policy in
      select id, priority
      from public.insurance_policies
      where client_id = rec.client_id
        and archived_at is null
      order by case priority
                 when 'primary' then 1
                 when 'secondary' then 2
                 when 'tertiary' then 3
                 else 4
               end,
               created_at asc
    loop
      insert into public.client_case_policies (
        organization_id, case_id, policy_id, priority
      ) values (
        rec.organization_id, v_case_id, v_policy.id, v_policy.priority
      )
      on conflict do nothing;
    end loop;

    -- Tag existing artifacts that don't already have a case.
    update public.appointments
      set case_id = v_case_id
      where client_id = rec.client_id and case_id is null;
    update public.encounters
      set case_id = v_case_id
      where client_id = rec.client_id and case_id is null;
    update public.claims
      set case_id = v_case_id
      where client_id = rec.client_id and case_id is null;
    update public.professional_claims
      set case_id = v_case_id
      where patient_id = rec.client_id and case_id is null;
    update public.charge_capture_items
      set case_id = v_case_id
      where client_id = rec.client_id and case_id is null;
    if to_regclass('public.patient_invoices') is not null then
      execute format(
        'update public.patient_invoices set case_id = %L where client_id = %L and case_id is null',
        v_case_id, rec.client_id
      );
    end if;
  end loop;
end $$;

-- ─── 6. Widen charge_capture_items.charge_status to include patient_responsibility ──
-- Self-pay / charity cases route charges to patient responsibility instead of
-- generating an insurance claim. The DROP+ADD pattern is required because
-- `if not exists` won't widen an existing check constraint.
do $$
begin
  if to_regclass('public.charge_capture_items') is not null then
    execute 'alter table public.charge_capture_items drop constraint if exists charge_capture_items_charge_status_check';
    execute $sql$
      alter table public.charge_capture_items
        add constraint charge_capture_items_charge_status_check
        check (charge_status in ('captured', 'ready_for_claim', 'claim_created', 'blocked', 'voided', 'patient_responsibility'))
    $sql$;
  end if;
end $$;

-- ─── 7. updated_at trigger ───────────────────────────────────────────────────
create or replace function public.tg_client_cases_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_client_cases_touch_updated_at on public.client_cases;
create trigger trg_client_cases_touch_updated_at
  before update on public.client_cases
  for each row
  execute function public.tg_client_cases_touch_updated_at();

drop trigger if exists trg_client_case_policies_touch_updated_at on public.client_case_policies;
create trigger trg_client_case_policies_touch_updated_at
  before update on public.client_case_policies
  for each row
  execute function public.tg_client_cases_touch_updated_at();

select pg_notify('pgrst', 'reload schema');
