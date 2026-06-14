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
      from public.billing_company_organization_access bcoa2
      where bcoa2.client_organization_id = client_ledger_entries.organization_id
        and bcoa2.billing_company_organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', '')
        and bcoa2.access_status = 'active'
        and bcoa2.archived_at is null
        and ('view_billing' = any(bcoa2.scopes) or '*' = any(bcoa2.scopes))
    )
  );

-- Extend claim_match_status enumeration to support patient-matched claimless posts
alter table public.era_claim_payments
  drop constraint if exists era_claim_payments_claim_match_status_check;
alter table public.era_claim_payments
  add constraint era_claim_payments_claim_match_status_check
    check (claim_match_status in ('matched','unmatched','ambiguous','patient_matched'));

-- Ensure unmatched rows with a professional claim or client are ready for posting
update public.era_claim_payments
  set posting_status = 'ready'
  where posting_status = 'blocked'
    and (professional_claim_id is not null or client_id is not null);

select pg_notify('pgrst', 'reload schema');
