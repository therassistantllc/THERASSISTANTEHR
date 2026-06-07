ALTER TABLE public.professional_claims
  ADD COLUMN IF NOT EXISTS provider_credentialing_profile_id uuid
    REFERENCES public.provider_credentialing_profiles(id) ON DELETE SET NULL;
