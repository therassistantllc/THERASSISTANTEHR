alter table public.professional_claim_service_lines
  add column if not exists provider_credentialing_profile_id uuid references public.provider_credentialing_profiles(id) on delete set null;
