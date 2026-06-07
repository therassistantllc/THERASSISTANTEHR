-- charge_capture_items.claim_id stores the generated professional claim id.
-- A self-referential FK blocks the app bridge when it links charges to claims.

alter table public.charge_capture_items
  drop constraint if exists charge_capture_items_claim_id_fkey;

alter table public.charge_capture_items
  add constraint charge_capture_items_claim_id_fkey
  foreign key (claim_id)
  references public.professional_claims(id)
  on delete set null;

create index if not exists idx_charge_capture_items_claim_id
  on public.charge_capture_items (claim_id)
  where claim_id is not null;

select pg_notify('pgrst', 'reload schema');