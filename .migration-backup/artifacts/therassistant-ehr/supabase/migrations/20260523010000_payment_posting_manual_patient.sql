-- ============================================================================
-- Migration: 20260523010000_payment_posting_manual_patient.sql
-- Purpose:   Payment Posting — Task #109 (manual insurance + patient payment).
--   1. Generalise era_posting_ledger_entries so it can hold ledger rows for
--      non-ERA sources (manual_insurance, patient_payment). era_claim_payment_id
--      becomes nullable; new source_type/source_id discriminator columns are
--      added; existing rows are backfilled to source_type='era_835'.
--   2. Extend insurance_manual_payments with payer/check/date/mailroom linkage
--      so paper EOBs can be reconciled identically to ERA payments.
--   3. Extend client_payments to support the full PP-3 source taxonomy
--      (stripe / cash / check / external_card / refund / unapplied_credit /
--      transferred_balance) plus per-invoice linkage.
--   4. New table client_credits for unapplied credit buckets and applications.
--   5. New table payment_transfers for paired debit/credit balance transfers
--      between invoices/claims.
-- All operations are idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── 1. era_posting_ledger_entries: generalise discriminator ─────────────────
alter table public.era_posting_ledger_entries
  alter column era_claim_payment_id drop not null;

alter table public.era_posting_ledger_entries
  add column if not exists source_type text,
  add column if not exists source_id   uuid,
  add column if not exists posted_at   timestamptz not null default now();

update public.era_posting_ledger_entries
  set source_type = 'era_835',
      source_id   = coalesce(source_id, era_claim_payment_id)
  where source_type is null;

alter table public.era_posting_ledger_entries
  alter column source_type set not null;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'era_posting_ledger_entries'
      and constraint_name = 'era_posting_ledger_source_type_check'
  ) then
    alter table public.era_posting_ledger_entries
      add constraint era_posting_ledger_source_type_check
      check (source_type in ('era_835','manual_insurance','patient_payment','recoupment','refund','reversal'));
  end if;
end$$;

create index if not exists idx_era_posting_ledger_source
  on public.era_posting_ledger_entries (organization_id, source_type, source_id)
  where archived_at is null;

create index if not exists idx_era_posting_ledger_claim_posted
  on public.era_posting_ledger_entries (organization_id, professional_claim_id, posted_at desc)
  where archived_at is null;

-- ─── 2. insurance_manual_payments: paper-EOB context ─────────────────────────
alter table public.insurance_manual_payments
  add column if not exists payer_profile_id  uuid references public.payer_profiles(id) on delete set null,
  add column if not exists check_number      text,
  add column if not exists payment_date      date,
  add column if not exists mailroom_item_id  uuid references public.mailroom_items(id) on delete set null,
  add column if not exists posted_actor_id   uuid,
  add column if not exists posting_status    text not null default 'posted'
    check (posting_status in ('posted','blocked','reversed'));

create index if not exists idx_insurance_manual_payments_payer
  on public.insurance_manual_payments (organization_id, payer_profile_id, payment_date desc)
  where archived_at is null;

-- ─── 3. client_payments: full source taxonomy + invoice linkage ──────────────
alter table public.client_payments
  drop constraint if exists client_payments_payment_method_check;

alter table public.client_payments
  add constraint client_payments_payment_method_check
  check (payment_method in (
    'cash','check','credit_card','debit_card','other',
    'stripe','external_card','refund','unapplied_credit','transferred_balance'
  ));

alter table public.client_payments
  add column if not exists patient_invoice_id    uuid references public.patient_invoices(id) on delete set null,
  add column if not exists external_payment_id   text,
  add column if not exists stripe_charge_id      text,
  add column if not exists source_label          text,
  add column if not exists posted_actor_id       uuid,
  add column if not exists posting_status        text not null default 'posted'
    check (posting_status in ('posted','blocked','reversed'));

create index if not exists idx_client_payments_invoice
  on public.client_payments (organization_id, patient_invoice_id, posted_at desc)
  where archived_at is null;

create unique index if not exists ux_client_payments_external_ref
  on public.client_payments (organization_id, payment_method, external_payment_id)
  where archived_at is null and external_payment_id is not null;

-- ─── 4. client_credits: unapplied credit bucket ──────────────────────────────
create table if not exists public.client_credits (
  id                      uuid        primary key default gen_random_uuid(),
  organization_id         uuid        not null references public.organizations(id) on delete cascade,
  client_id               uuid        not null references public.clients(id) on delete cascade,
  source_payment_id       uuid        references public.client_payments(id) on delete set null,
  initial_amount          numeric(12,2) not null check (initial_amount > 0),
  applied_amount          numeric(12,2) not null default 0 check (applied_amount >= 0),
  balance_amount          numeric(12,2) not null,
  note                    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  archived_at             timestamptz,
  constraint client_credits_balance_nonneg check (balance_amount >= 0),
  constraint client_credits_balance_le_initial check (balance_amount <= initial_amount)
);

create index if not exists idx_client_credits_client_balance
  on public.client_credits (organization_id, client_id, balance_amount desc)
  where archived_at is null;

create table if not exists public.client_credit_applications (
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references public.organizations(id) on delete cascade,
  client_credit_id      uuid        not null references public.client_credits(id) on delete cascade,
  patient_invoice_id    uuid        references public.patient_invoices(id) on delete set null,
  professional_claim_id uuid        references public.professional_claims(id) on delete set null,
  applied_amount        numeric(12,2) not null check (applied_amount > 0),
  applied_at            timestamptz not null default now(),
  applied_actor_id      uuid,
  note                  text,
  created_at            timestamptz not null default now(),
  archived_at           timestamptz
);

create index if not exists idx_client_credit_apps_credit
  on public.client_credit_applications (organization_id, client_credit_id, applied_at desc)
  where archived_at is null;

-- ─── 5. payment_transfers: paired debit/credit balance moves ─────────────────
create table if not exists public.payment_transfers (
  id                       uuid        primary key default gen_random_uuid(),
  organization_id          uuid        not null references public.organizations(id) on delete cascade,
  client_id                uuid        not null references public.clients(id) on delete cascade,
  from_invoice_id          uuid        references public.patient_invoices(id) on delete set null,
  from_claim_id            uuid        references public.professional_claims(id) on delete set null,
  to_invoice_id            uuid        references public.patient_invoices(id) on delete set null,
  to_claim_id              uuid        references public.professional_claims(id) on delete set null,
  amount                   numeric(12,2) not null check (amount > 0),
  reason                   text,
  transferred_actor_id     uuid,
  transferred_at           timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  archived_at              timestamptz
);

create index if not exists idx_payment_transfers_client
  on public.payment_transfers (organization_id, client_id, transferred_at desc)
  where archived_at is null;

select pg_notify('pgrst','reload schema');
