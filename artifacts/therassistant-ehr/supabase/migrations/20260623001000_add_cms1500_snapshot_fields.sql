alter table public.claim_parties_snapshot add column if not exists billing_provider_phone text;
alter table public.claim_parties_snapshot add column if not exists insured_group_or_feca_number text;
alter table public.claim_parties_snapshot add column if not exists patient_relationship_to_insured text default 'self';
alter table public.claim_parties_snapshot add column if not exists condition_employment_related boolean default false;
alter table public.claim_parties_snapshot add column if not exists condition_auto_accident_related boolean default false;
alter table public.claim_parties_snapshot add column if not exists condition_auto_accident_state text;
alter table public.claim_parties_snapshot add column if not exists condition_other_accident_related boolean default false;
