-- Task #111 / PP-5 — bulk action columns on payment tables.
--
-- The /api/billing/payments/bulk/{assign,defer} endpoints stamp these
-- columns on the selected payment rows. They are independent of the
-- workqueue_items.defer_until / assigned_to_user_id fields (those live
-- on AR workqueue rows; these live on the payment rows themselves so
-- the dashboard can filter / display per-payment defer + assignment).
--
-- All three columns are nullable + indexed so the dashboard can filter
-- "show only unassigned" or "show items deferred past today" without
-- scanning the whole table.

alter table public.era_claim_payments
  add column if not exists assigned_to_staff_id uuid,
  add column if not exists defer_until          date,
  add column if not exists defer_reason         text;

alter table public.insurance_manual_payments
  add column if not exists assigned_to_staff_id uuid,
  add column if not exists defer_until          date,
  add column if not exists defer_reason         text;

alter table public.client_payments
  add column if not exists assigned_to_staff_id uuid,
  add column if not exists defer_until          date,
  add column if not exists defer_reason         text;

create index if not exists era_claim_payments_assigned_idx
  on public.era_claim_payments (organization_id, assigned_to_staff_id)
  where archived_at is null and assigned_to_staff_id is not null;

create index if not exists era_claim_payments_defer_idx
  on public.era_claim_payments (organization_id, defer_until)
  where archived_at is null and defer_until is not null;

create index if not exists insurance_manual_payments_assigned_idx
  on public.insurance_manual_payments (organization_id, assigned_to_staff_id)
  where archived_at is null and assigned_to_staff_id is not null;

create index if not exists insurance_manual_payments_defer_idx
  on public.insurance_manual_payments (organization_id, defer_until)
  where archived_at is null and defer_until is not null;

create index if not exists client_payments_assigned_idx
  on public.client_payments (organization_id, assigned_to_staff_id)
  where archived_at is null and assigned_to_staff_id is not null;

create index if not exists client_payments_defer_idx
  on public.client_payments (organization_id, defer_until)
  where archived_at is null and defer_until is not null;
