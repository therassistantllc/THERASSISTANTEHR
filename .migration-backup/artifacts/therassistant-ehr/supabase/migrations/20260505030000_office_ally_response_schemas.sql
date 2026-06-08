-- File: supabase/migrations/20260505_office_ally_response_schemas.sql
-- Purpose: Add Office Ally/API response schemas beyond base EDI transaction logging.
-- Covers: realtime health checks, API request auditing, TA1/999/277CA acknowledgments,
-- 271 benefit details, 277 status details, and 835/ERA adjudication structure.

create extension if not exists pgcrypto;

create table if not exists public.clearinghouse_health_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null,
  vendor text not null default 'office_ally',
  connection_id uuid null,
  endpoint_name text not null,
  endpoint_url text null,
  transport text not null check (transport in ('soap', 'mime', 'sftp', 'api', 'system')),
  status text not null check (status in ('healthy', 'degraded', 'down', 'unknown')),
  http_status integer null,
  latency_ms integer null,
  response_summary text null,
  raw_response text null,
  error_message text null,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.clearinghouse_api_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid null,
  vendor text not null default 'office_ally',
  operation text not null,
  transport text not null check (transport in ('soap', 'mime', 'sftp', 'api')),
  endpoint_url text null,
  http_method text null,
  http_status integer null,
  request_headers jsonb not null default '{}'::jsonb,
  response_headers jsonb not null default '{}'::jsonb,
  request_body text null,
  response_body text null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  payload_id text null,
  sender_id text null,
  receiver_id text null,
  processing_mode text null,
  core_rule_version text null,
  edi_transaction_id uuid null,
  status text not null default 'created' check (status in ('created', 'sent', 'received', 'parsed', 'failed')),
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.edi_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid null,
  claim_id uuid null,
  edi_transaction_id uuid null,
  source_file_name text null,
  acknowledgment_type text not null check (acknowledgment_type in ('TA1', '999', '277CA', 'file_summary', 'edi_status')),
  acknowledgment_status text not null check (acknowledgment_status in ('accepted', 'partially_accepted', 'rejected', 'error', 'unknown')),
  interchange_control_number text null,
  group_control_number text null,
  transaction_set_control_number text null,
  payer_id text null,
  payer_name text null,
  office_ally_file_id text null,
  office_ally_claim_id text null,
  status_code text null,
  status_message text null,
  raw_codes jsonb not null default '{}'::jsonb,
  raw_response text null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

create table if not exists public.eligibility_benefit_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  eligibility_check_id uuid not null,
  client_id uuid not null,
  payer_id text null,
  payer_name text null,
  service_type_code text null,
  service_type_description text null,
  benefit_information_code text null,
  benefit_description text null,
  coverage_level_code text null,
  insurance_type_code text null,
  plan_coverage_description text null,
  time_period_qualifier text null,
  monetary_amount numeric null,
  percent_amount numeric null,
  quantity_qualifier text null,
  quantity numeric null,
  authorization_or_certification_required boolean null,
  in_plan_network_indicator text null,
  eligibility_date_from date null,
  eligibility_date_to date null,
  messages jsonb not null default '[]'::jsonb,
  raw_eb_segment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

create table if not exists public.claim_status_response_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  claim_status_inquiry_id uuid not null,
  claim_id uuid not null,
  client_id uuid not null,
  payer_id text null,
  payer_name text null,
  status_category_code text null,
  status_code text null,
  entity_code text null,
  status_effective_date date null,
  total_charge_amount numeric null,
  paid_amount numeric null,
  check_eft_number text null,
  payer_claim_control_number text null,
  service_date_from date null,
  service_date_to date null,
  message text null,
  raw_stc_segment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

-- NOTE: The 835/ERA tables (era_claim_payments, era_service_line_payments,
-- era_adjustments) were originally drafted here with a `claim_id`-keyed
-- narrow shape. That draft was superseded by the canonical 835 redesign in
-- `20260511190000_era_835_foundation.sql`, which uses `professional_claim_id`
-- + `clp01_*..clp05_*` columns and introduces `era_posting_ledger_entries`
-- in place of the per-line / adjustment side tables. Subsequent migrations
-- (`20260515000000_ehr_billing_foundation.sql`,
--  `20260524000000_payment_posting_reversal_refunds.sql`,
--  `20260524010000_payment_bulk_action_columns.sql`) layer on the CARC/RARC,
-- check-tracking, lifecycle (reversed/voided), and bulk-action columns that
-- make up the production shape. To keep `supabase db push` reproducing the
-- canonical schema on a fresh DB — and to stop drift between repo and live —
-- the original create-tables / indexes / RLS / policies for these three
-- tables have been removed from this migration. The `drop table … cascade`
-- statements at the top of `20260511190000_era_835_foundation.sql` continue
-- to clean up any legacy rows on databases that did apply the early draft.

create index if not exists idx_clearinghouse_health_checks_vendor_endpoint_checked
  on public.clearinghouse_health_checks (vendor, endpoint_name, checked_at desc);

create index if not exists idx_clearinghouse_api_requests_org_operation_created
  on public.clearinghouse_api_requests (organization_id, operation, created_at desc);

create index if not exists idx_edi_acknowledgments_org_claim_type_received
  on public.edi_acknowledgments (organization_id, claim_id, acknowledgment_type, received_at desc)
  where archived_at is null;

create index if not exists idx_eligibility_benefit_segments_check_client
  on public.eligibility_benefit_segments (eligibility_check_id, client_id, service_type_code)
  where archived_at is null;

create index if not exists idx_claim_status_response_lines_claim_inquiry
  on public.claim_status_response_lines (claim_id, claim_status_inquiry_id, created_at desc)
  where archived_at is null;

-- ERA indexes (era_claim_payments / era_service_line_payments / era_adjustments)
-- intentionally omitted — see the canonical 835 redesign in
-- `20260511190000_era_835_foundation.sql`.

alter table public.clearinghouse_health_checks enable row level security;
alter table public.clearinghouse_api_requests enable row level security;
alter table public.edi_acknowledgments enable row level security;
alter table public.eligibility_benefit_segments enable row level security;
alter table public.claim_status_response_lines enable row level security;

-- Service role bypasses RLS. Authenticated org policies are included for future UI reads.
drop policy if exists clearinghouse_api_requests_org_policy on public.clearinghouse_api_requests;
create policy clearinghouse_api_requests_org_policy on public.clearinghouse_api_requests
  for all to authenticated
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''));

drop policy if exists edi_acknowledgments_org_policy on public.edi_acknowledgments;
create policy edi_acknowledgments_org_policy on public.edi_acknowledgments
  for all to authenticated
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''));

drop policy if exists eligibility_benefit_segments_org_policy on public.eligibility_benefit_segments;
create policy eligibility_benefit_segments_org_policy on public.eligibility_benefit_segments
  for all to authenticated
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''));

drop policy if exists claim_status_response_lines_org_policy on public.claim_status_response_lines;
create policy claim_status_response_lines_org_policy on public.claim_status_response_lines
  for all to authenticated
  using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''))
  with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', auth.jwt() -> 'app_metadata' ->> 'organization_id', ''));

-- ERA RLS policies (era_claim_payments / era_service_line_payments /
-- era_adjustments) intentionally omitted — the canonical 835 redesign in
-- `20260511190000_era_835_foundation.sql` owns those tables and policies.
