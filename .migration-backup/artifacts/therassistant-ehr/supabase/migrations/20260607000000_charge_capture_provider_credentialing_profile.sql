alter table public.charge_capture_items
  add column if not exists provider_credentialing_profile_id uuid
    references public.provider_credentialing_profiles(id) on delete set null;

create index if not exists idx_charge_capture_items_provider_credentialing_profile_id
  on public.charge_capture_items (provider_credentialing_profile_id)
  where provider_credentialing_profile_id is not null;

select pg_notify('pgrst', 'reload schema');
