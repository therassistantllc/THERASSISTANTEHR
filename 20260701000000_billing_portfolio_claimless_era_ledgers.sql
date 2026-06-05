-- ============================================================================
-- Billing-company portfolio access + claimless ERA ledger bridge.
--
-- Supports billing-company operators who work across client organizations
-- without switching org context, while preserving explicit tenant boundaries.
-- Also makes old/claimless ERA rows postable to a client account ledger with
-- the full charge/payment/adjustment/patient-responsibility equation.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── 1. Billing-company portfolio delegation ────────────────────────────────
create table if not exists public.billing_company_organization_access (
  id uuid primary key default gen_random_uuid(),
  billing_company_organization_id uuid not null references public.organizations(id) on delete cascade,
  client_organization_id uuid not null references public.organizations(id) on delete cascade,
  access_status text not null default 'active'
    check (access_status in ('active', 'suspended', 'ended')),
  scopes text[] not null default array[
    'view_billing',
    'post_payments',
    'submit_claims',
    'review_denials',
    'manage_workqueue'
  ]::text[],
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint billing_company_org_access_no_self
    check (billing_company_organization_id <> client_organization_id)
);

create unique index if not exists ux_billing_company_org_access_active_pair
  on public.billing_company_organization_access (
    billing_company_organization_id,
    client_organization_id
  )
  where archived_at is null and access_status = 'active';

create index if not exists idx_billing_company_org_access_client
  on public.billing_company_organization_access (client_organization_id, access_status)
  where archived_at is null;

alter table public.billing_company_organization_access enable row level security;
drop policy if exists billing_company_org_access_policy on public.billing_company_organization_access;
create policy billing_company_org_access_policy
  on public.billing_company_organization_access
  for all to authenticated
  using (
    billing_company_organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  )
  with check (
    billing_company_organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  );

-- ─── 2. ERA/import bridge columns used by the RCM workspace ─────────────────
alter table if exists public.professional_claims
  add column if not exists date_of_service_from date,
  add column if not exists date_of_service_to date;

update public.professional_claims pc
set
  date_of_service_from = coalesce(pc.date_of_service_from, dos.date_of_service_from),
  date_of_service_to = coalesce(pc.date_of_service_to, dos.date_of_service_to)
from (
  select
    claim_id,
    min(service_date_from) as date_of_service_from,
    max(coalesce(service_date_to, service_date_from)) as date_of_service_to
  from public.professional_claim_service_lines
  group by claim_id
) dos
where pc.id = dos.claim_id
  and (pc.date_of_service_from is null or pc.date_of_service_to is null);

create index if not exists idx_professional_claims_org_dos
  on public.professional_claims (organization_id, date_of_service_from desc)
  where archived_at is null and date_of_service_from is not null;

create or replace function public.refresh_professional_claim_dos_from_service_lines(
  p_claim_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_claim_id is null then
    return;
  end if;

  update public.professional_claims pc
  set
    date_of_service_from = (
      select min(sl.service_date_from)
      from public.professional_claim_service_lines sl
      where sl.claim_id = p_claim_id
    ),
    date_of_service_to = (
      select max(coalesce(sl.service_date_to, sl.service_date_from))
      from public.professional_claim_service_lines sl
      where sl.claim_id = p_claim_id
    ),
    updated_at = now()
  where pc.id = p_claim_id;
end;
$$;

create or replace function public.trg_refresh_professional_claim_dos_from_service_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_professional_claim_dos_from_service_lines(new.claim_id);
  end if;

  if tg_op in ('DELETE', 'UPDATE') and (
    tg_op = 'DELETE' or old.claim_id is distinct from new.claim_id
  ) then
    perform public.refresh_professional_claim_dos_from_service_lines(old.claim_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refresh_professional_claim_dos_from_service_lines
  on public.professional_claim_service_lines;
create trigger trg_refresh_professional_claim_dos_from_service_lines
  after insert or update of claim_id, service_date_from, service_date_to or delete
  on public.professional_claim_service_lines
  for each row
  execute function public.trg_refresh_professional_claim_dos_from_service_lines();

alter table if exists public.era_import_batches
  add column if not exists payer_identifier text,
  add column if not exists payer_name text,
  add column if not exists eft_or_check_number text,
  add column if not exists payment_date date,
  add column if not exists payment_method_code text;

alter table if exists public.era_claim_payments
  add column if not exists payment_import_batch_id uuid references public.payment_import_batches(id) on delete set null,
  add column if not exists payment_import_item_id uuid references public.payment_import_items(id) on delete set null,
  add column if not exists payer_profile_id uuid references public.payer_profiles(id) on delete set null,
  add column if not exists insurance_policy_id uuid references public.insurance_policies(id) on delete set null,
  add column if not exists patient_account_number text,
  add column if not exists payer_name text,
  add column if not exists payer_id uuid,
  add column if not exists claim_status_code text,
  add column if not exists total_charge_amount numeric(12,2),
  add column if not exists paid_amount numeric(12,2),
  add column if not exists patient_responsibility_amount numeric(12,2),
  add column if not exists claim_filing_indicator_code text,
  add column if not exists payment_date date,
  add column if not exists check_or_eft_number text,
  add column if not exists raw_clp jsonb not null default '{}'::jsonb,
  add column if not exists match_status text,
  add column if not exists posted_status text,
  add column if not exists posted_at timestamptz,
  add column if not exists check_eft_number text,
  add column if not exists payer_trace_number text,
  add column if not exists check_issue_date date;

create unique index if not exists ux_era_claim_payments_payment_import_item
  on public.era_claim_payments (organization_id, payment_import_item_id)
  where archived_at is null and payment_import_item_id is not null;

create index if not exists idx_era_claim_payments_import_batch
  on public.era_claim_payments (organization_id, payment_import_batch_id)
  where archived_at is null and payment_import_batch_id is not null;

create table if not exists public.era_service_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  era_claim_payment_id uuid not null references public.era_claim_payments(id) on delete cascade,
  professional_claim_id uuid references public.professional_claims(id) on delete set null,
  service_line_number integer,
  service_date_from date,
  service_date_to date,
  procedure_code text,
  modifiers text[] not null default '{}'::text[],
  units numeric(12,2),
  charge_amount numeric(12,2) not null default 0,
  allowed_amount numeric(12,2),
  paid_amount numeric(12,2) not null default 0,
  deductible_amount numeric(12,2) not null default 0,
  coinsurance_amount numeric(12,2) not null default 0,
  copay_amount numeric(12,2) not null default 0,
  contractual_adjustment_amount numeric(12,2) not null default 0,
  other_adjustment_amount numeric(12,2) not null default 0,
  group_codes text[] not null default '{}'::text[],
  carc_codes text[] not null default '{}'::text[],
  rarc_codes text[] not null default '{}'::text[],
  raw_svc jsonb not null default '{}'::jsonb,
  raw_segments jsonb not null default '{}'::jsonb,
  match_status text not null default 'unmatched',
  posted_status text not null default 'unposted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists idx_era_service_lines_payment
  on public.era_service_lines (organization_id, era_claim_payment_id, service_line_number)
  where archived_at is null;

alter table public.era_service_lines enable row level security;
drop policy if exists era_service_lines_org_policy on public.era_service_lines;
create policy era_service_lines_org_policy on public.era_service_lines
  for all to authenticated
  using (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  )
  with check (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
  );

update public.era_claim_payments
set
  clp02_claim_status_code = coalesce(clp02_claim_status_code, claim_status_code),
  clp03_total_charge = case
    when coalesce(clp03_total_charge, 0) = 0 and total_charge_amount is not null then total_charge_amount
    else clp03_total_charge
  end,
  clp04_payment_amount = case
    when coalesce(clp04_payment_amount, 0) = 0 and paid_amount is not null then paid_amount
    else clp04_payment_amount
  end,
  clp05_patient_responsibility = case
    when coalesce(clp05_patient_responsibility, 0) = 0 and patient_responsibility_amount is not null then patient_responsibility_amount
    else clp05_patient_responsibility
  end,
  claim_match_status = case
    when claim_match_status = 'matched' or match_status in ('matched', 'manual_matched') then 'matched'
    when claim_match_status = 'ambiguous' then 'ambiguous'
    else 'unmatched'
  end,
  posting_status = case
    when posting_status = 'posted' or posted_status = 'posted' then 'posted'
    when professional_claim_id is not null or client_id is not null then 'ready'
    else coalesce(nullif(posting_status, ''), 'blocked')
  end,
  posted_status = coalesce(posted_status, case when posting_status = 'posted' then 'posted' else 'unposted' end),
  check_eft_number = coalesce(check_eft_number, check_or_eft_number),
  payer_trace_number = coalesce(payer_trace_number, check_or_eft_number),
  check_issue_date = coalesce(check_issue_date, payment_date)
where archived_at is null;

-- ─── 3. Full ERA ledger rows: include charge and per-CAS source segment ──────
alter table if exists public.era_posting_ledger_entries
  add column if not exists source_segment text,
  add column if not exists posted_at timestamptz not null default now();

alter table if exists public.era_posting_ledger_entries
  drop constraint if exists era_posting_ledger_entries_entry_type_check;

alter table if exists public.era_posting_ledger_entries
  add constraint era_posting_ledger_entries_entry_type_check
  check (
    entry_type in (
      'charge',
      'insurance_payment',
      'contractual_adjustment',
      'patient_responsibility',
      'other_adjustment',
      'payment'
    )
  );

drop index if exists public.idx_era_posting_ledger_entries_unique_active;
create unique index idx_era_posting_ledger_entries_unique_active
  on public.era_posting_ledger_entries (
    organization_id,
    era_claim_payment_id,
    entry_type,
    coalesce(source_segment, '')
  )
  where archived_at is null and era_claim_payment_id is not null;

-- ─── 4. Client account ledger for claimless ERA posting ─────────────────────
create table if not exists public.client_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  professional_claim_id uuid references public.professional_claims(id) on delete set null,
  era_claim_payment_id uuid references public.era_claim_payments(id) on delete set null,
  patient_invoice_id uuid references public.patient_invoices(id) on delete set null,
  source_type text not null,
  source_id uuid,
  entry_type text not null,
  description text,
  debit_amount numeric(12,2) not null default 0,
  credit_amount numeric(12,2) not null default 0,
  balance_effect numeric(12,2) not null default 0,
  group_code text,
  reason_code text,
  source_segment text,
  service_date date,
  posting_date date not null default current_date,
  reference_number text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.client_ledger_entries
  add column if not exists group_code text,
  add column if not exists reason_code text,
  add column if not exists source_segment text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_client_ledger_entries_org_client_date
  on public.client_ledger_entries (organization_id, client_id, posting_date desc)
  where archived_at is null;

create index if not exists idx_client_ledger_entries_era_payment
  on public.client_ledger_entries (organization_id, era_claim_payment_id)
  where archived_at is null and era_claim_payment_id is not null;

create unique index if not exists ux_client_ledger_entries_source_reference
  on public.client_ledger_entries (organization_id, source_type, reference_number)
  where archived_at is null and reference_number is not null;

alter table public.client_ledger_entries enable row level security;
drop policy if exists client_ledger_entries_org_policy on public.client_ledger_entries;
create policy client_ledger_entries_org_policy on public.client_ledger_entries
  for all to authenticated
  using (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
    or exists (
      select 1
      from public.billing_company_organization_access bcoa
      where bcoa.client_organization_id = client_ledger_entries.organization_id
        and bcoa.billing_company_organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
        and bcoa.access_status = 'active'
        and bcoa.archived_at is null
        and ('view_billing' = any(bcoa.scopes) or '*' = any(bcoa.scopes))
    )
  )
  with check (
    organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
    or exists (
      select 1
      from public.billing_company_organization_access bcoa
      where bcoa.client_organization_id = client_ledger_entries.organization_id
        and bcoa.billing_company_organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
        and bcoa.access_status = 'active'
        and bcoa.archived_at is null
        and ('post_payments' = any(bcoa.scopes) or '*' = any(bcoa.scopes))
    )
  );

-- ─── 5. Payment import queue compatibility view ─────────────────────────────
create or replace view public.v_era_queue_from_payment_imports as
select
  b.id,
  b.organization_id,
  b.import_source as source,
  b.source_file_name as file_name,
  jsonb_build_object(
    'importSource', b.import_source,
    'sourceFileHash', b.source_file_hash,
    'parseErrorsCount', b.parse_errors_count
  ) as parsed_summary,
  b.payment_import_status as import_status,
  coalesce(b.total_item_count, 0) as total_claims,
  coalesce(b.total_amount, 0)::numeric(12,2) as total_payment_amount,
  0::numeric(12,2) as total_patient_responsibility,
  coalesce(
    nullif(first_item.raw_item_payload ->> 'payer_identifier', ''),
    nullif(first_item.raw_item_payload ->> 'payerId', ''),
    nullif(first_item.raw_item_payload ->> 'payer_id', '')
  ) as payer_identifier,
  coalesce(
    nullif(first_item.raw_item_payload ->> 'payer_name', ''),
    nullif(first_item.raw_item_payload ->> 'payerName', ''),
    nullif(first_item.raw_item_payload ->> 'payer', ''),
    'Unknown payer'
  ) as payer_name,
  coalesce(
    nullif(first_item.raw_item_payload ->> 'check_or_eft_number', ''),
    nullif(first_item.raw_item_payload ->> 'trace_number', ''),
    b.source_file_hash
  ) as eft_or_check_number,
  first_item.payment_date,
  nullif(first_item.raw_item_payload ->> 'payment_method_code', '') as payment_method_code,
  b.imported_at,
  b.created_at,
  b.updated_at,
  b.archived_at
from public.payment_import_batches b
left join lateral (
  select i.raw_item_payload, i.payment_date
  from public.payment_import_items i
  where i.batch_id = b.id
    and i.archived_at is null
  order by i.created_at asc
  limit 1
) first_item on true
where b.archived_at is null;

select pg_notify('pgrst', 'reload schema');
