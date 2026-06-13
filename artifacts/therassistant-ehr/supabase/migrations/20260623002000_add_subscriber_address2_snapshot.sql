alter table public.claim_parties_snapshot
  add column if not exists subscriber_address2 text;
