-- sync_claim_837p_settings_from_appointment writes these 837P settings
-- when claims are linked into a batch.

alter table public.claim_parties_snapshot
  add column if not exists billing_provider_taxonomy text,
  add column if not exists submitter_id text,
  add column if not exists submitter_name text,
  add column if not exists submitter_contact_email text;

create index if not exists idx_claim_parties_snapshot_submitter_id
  on public.claim_parties_snapshot (submitter_id)
  where submitter_id is not null;

select pg_notify('pgrst', 'reload schema');