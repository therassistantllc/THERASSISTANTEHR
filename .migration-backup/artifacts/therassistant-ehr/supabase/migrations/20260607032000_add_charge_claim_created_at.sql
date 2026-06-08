-- linkChargeToClaim stamps claim_created_at when a charge is linked to a claim.

alter table public.charge_capture_items
  add column if not exists claim_created_at timestamptz;

create index if not exists idx_charge_capture_items_claim_created_at
  on public.charge_capture_items (claim_created_at)
  where claim_created_at is not null;

select pg_notify('pgrst', 'reload schema');