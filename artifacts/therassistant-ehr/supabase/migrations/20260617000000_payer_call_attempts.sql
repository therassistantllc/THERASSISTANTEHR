-- Task #634 — Structured payer-call outcomes for reporting.
--
-- The "Call payer" panel on the No Response queue used to log calls as
-- free-text claim_notes rows ("Called payer at 800-555-1212 (Claims phone)",
-- "Left voicemail — Claims phone 800-555-1212"). That's fine for the human
-- timeline but unparseable for metrics like "average attempts before reaching
-- a rep" or "% of calls that go to voicemail".
--
-- This table is the structured counterpart. The Call panel writes BOTH a
-- claim_notes row (so the Notes tab keeps reading well) and a row here (so
-- the Billing Reports tile can aggregate by payer / disposition).

create table if not exists public.payer_call_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid not null references public.professional_claims(id) on delete cascade,
  payer_profile_id uuid references public.payer_profiles(id) on delete set null,
  -- Which contact slot on payer_profiles the rep used.
  contact_channel text not null check (contact_channel in (
    'claims_phone',
    'claims_fax',
    'provider_services',
    'other'
  )),
  number_dialed text,
  -- 'dialed' is the initial outbound (no outcome yet). The disposition
  -- buttons in the modal overwrite the row in spirit by inserting a second
  -- row referencing the same lastContact; we keep both so volume metrics
  -- count attempts honestly.
  disposition text not null check (disposition in (
    'dialed',
    'sent_fax',
    'spoke_with_rep',
    'left_voicemail',
    'no_answer'
  )),
  note_id uuid references public.claim_notes(id) on delete set null,
  acted_by_user_id uuid references auth.users(id),
  acted_by_display_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payer_call_attempts_org_created
  on public.payer_call_attempts (organization_id, created_at desc);

create index if not exists idx_payer_call_attempts_claim
  on public.payer_call_attempts (organization_id, claim_id, created_at desc);

create index if not exists idx_payer_call_attempts_payer
  on public.payer_call_attempts (organization_id, payer_profile_id, created_at desc)
  where payer_profile_id is not null;

alter table public.payer_call_attempts enable row level security;

drop policy if exists "payer_call_attempts_tenant" on public.payer_call_attempts;
create policy "payer_call_attempts_tenant" on public.payer_call_attempts
  for all using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  )
  with check (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    or organization_id in (
      select organization_id from public.staff_profiles
      where auth_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
