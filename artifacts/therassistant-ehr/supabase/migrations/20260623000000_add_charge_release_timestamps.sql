alter table public.professional_claims
  add column if not exists ready_for_batch_at timestamptz;

alter table public.charge_capture_items
  add column if not exists released_at timestamptz;
